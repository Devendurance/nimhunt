import type {
  AbandonExpeditionResult,
  VerifyExpeditionResult,
} from '../../src/domain/expeditionProof.js'
import { CHEST_HUNTER_TARGET, GEM_RUNNER_TARGET } from '../../src/game/domain/mission.js'
import { hashBlueprint, hashReplayState, hashTranscript } from '../../src/game/replay/canonical.js'
import { createInitialRun, replayActions } from '../../src/game/replay/engine.js'
import { TRANSCRIPT_VERSION } from '../../src/game/replay/versions.js'
import type { ExpeditionTranscript, ReplayAction, ReplayState } from '../../src/game/replay/types.js'
import { ProofError } from './errors.js'
import type { DurableCheckpointBatch, DurableExpeditionRun } from './types.js'

export function reconstructActionsFromBatches(run: DurableExpeditionRun): readonly ReplayAction[] {
  const actions: ReplayAction[] = []
  let previousHash = run.initialCheckpointHash
  let expectedSeq = 1
  for (const batch of run.batches) {
    if (batch.previousCheckpointHash !== previousHash) throw new ProofError('PROOF_LOST')
    if (batch.seqStart !== expectedSeq) throw new ProofError('PROOF_LOST')
    if (batch.seqEnd !== batch.seqStart + batch.actions.length - 1) throw new ProofError('PROOF_LOST')
    for (let index = 0; index < batch.actions.length; index += 1) {
      const action = batch.actions[index]
      if (!action || action.seq !== batch.seqStart + index || (action.type !== 'MOVE' && action.type !== 'TICK')) {
        throw new ProofError('PROOF_LOST')
      }
    }
    actions.push(...batch.actions.map(action => ({ ...action })))
    previousHash = batch.checkpointHash
    expectedSeq = batch.seqEnd + 1
  }
  if (previousHash !== run.checkpointHash) throw new ProofError('PROOF_LOST')
  if (actions.length !== run.seq) throw new ProofError('PROOF_LOST')
  return actions
}

export function verifyExpeditionRun(
  run: DurableExpeditionRun,
  input: { readonly checkpointHash: string; readonly now: Date },
): { readonly run: DurableExpeditionRun; readonly result: VerifyExpeditionResult } {
  if (run.terminal?.type === 'VERIFIED') {
    if (run.terminal.result.checkpointHash !== input.checkpointHash || input.checkpointHash !== run.checkpointHash) {
      throw new ProofError('CHECKPOINT_MISMATCH')
    }
    return { run, result: run.terminal.result }
  }
  if (run.terminal) throw new ProofError('RUN_NOT_ACTIVE')

  const audit = auditTrustedRun(run, input.checkpointHash)
  const classification = classifyMission(run.mission, audit.state)
  const result = createVerifyResult(run, audit, classification, input.now)
  return {
    run: {
      ...run,
      status: result.status,
      rewardStatus: result.rewardStatus,
      terminal: { type: 'VERIFIED', result },
    },
    result,
  }
}

export function abandonExpeditionRun(
  run: DurableExpeditionRun,
  input: { readonly checkpointHash: string; readonly now: Date },
): { readonly run: DurableExpeditionRun; readonly result: AbandonExpeditionResult } {
  if (run.terminal?.type === 'ABANDONED') {
    if (run.terminal.result.checkpointHash !== input.checkpointHash || input.checkpointHash !== run.checkpointHash) {
      throw new ProofError('CHECKPOINT_MISMATCH')
    }
    return { run, result: run.terminal.result }
  }
  if (run.terminal?.type === 'VERIFIED') {
    if (run.terminal.result.outcome === 'FAILED' && run.terminal.result.checkpointHash === input.checkpointHash) {
      return {
        run,
        result: {
          runId: run.runId,
          checkpointHash: input.checkpointHash,
          outcome: 'FAILED',
          status: 'FAILED',
          rewardStatus: 'NONE',
        },
      }
    }
    throw new ProofError('RUN_NOT_ACTIVE')
  }

  const audit = auditTrustedRun(run, input.checkpointHash)
  if (audit.state.run.hp === 0) {
    const verified = verifyExpeditionRun(run, input)
    return {
      run: verified.run,
      result: {
        runId: run.runId,
        checkpointHash: input.checkpointHash,
        outcome: 'FAILED',
        status: 'FAILED',
        rewardStatus: 'NONE',
      },
    }
  }

  const result: AbandonExpeditionResult = {
    runId: run.runId,
    checkpointHash: input.checkpointHash,
    outcome: 'ABANDONED',
    status: 'ABANDONED',
    rewardStatus: 'NONE',
  }
  return {
    run: {
      ...run,
      status: 'ABANDONED',
      rewardStatus: 'NONE',
      terminal: { type: 'ABANDONED', result },
    },
    result,
  }
}

type RunAudit = {
  readonly actions: readonly ReplayAction[]
  readonly state: ReplayState
  readonly transcriptHash: string
  readonly stateHash: string
}

function auditTrustedRun(run: DurableExpeditionRun, checkpointHash: string): RunAudit {
  if (run.status !== 'STARTED' || run.rewardStatus !== 'NONE' || run.terminal) {
    throw new ProofError('RUN_NOT_ACTIVE')
  }
  if (!run.gameplayStartedAt) throw new ProofError('RUN_NOT_ACTIVE')
  if (checkpointHash !== run.checkpointHash) throw new ProofError('CHECKPOINT_MISMATCH')
  if (hashBlueprint(run.blueprint) !== run.blueprint.blueprintHash) throw new ProofError('PROOF_LOST')

  const actions = reconstructActionsFromBatches(run)
  const initial = createInitialRun({
    mission: run.blueprint.mission,
    rulesVersion: run.blueprint.rulesVersion,
    roomVersion: run.blueprint.roomVersion,
    blueprint: run.blueprint,
  })
  if (hashReplayState(initial) !== run.initialStateHash) throw new ProofError('PROOF_LOST')
  if (hashTranscript(transcriptFor(run, [])) !== run.initialTranscriptHash) throw new ProofError('PROOF_LOST')

  let state: ReplayState
  try {
    state = replayActions({
      mission: run.blueprint.mission,
      rulesVersion: run.blueprint.rulesVersion,
      roomVersion: run.blueprint.roomVersion,
      blueprint: run.blueprint,
    }, actions)
  } catch {
    throw new ProofError('PROOF_LOST')
  }

  const transcriptHash = hashTranscript(transcriptFor(run, actions))
  const stateHash = hashReplayState(state)
  if (transcriptHash !== run.checkpoint.transcriptHash) throw new ProofError('PROOF_LOST')
  if (stateHash !== run.checkpoint.stateHash) throw new ProofError('PROOF_LOST')
  if (state.seq !== run.seq || state.seq !== run.checkpoint.seq) throw new ProofError('PROOF_LOST')
  if (hashReplayState(run.state) !== stateHash) throw new ProofError('PROOF_LOST')

  // Verify authoritative hazard deadlines if timed hazards were triggered
  if (state.collapsingBoulders && state.collapsingBoulders.length > 0) {
    for (const boulder of state.collapsingBoulders) {
      if (boulder.state === 'WARNING' || boulder.state === 'FALLEN') {
        const deadline = run.hazardDeadlines?.find(d => d.hazardId === boulder.id)
        if (!deadline || boulder.state !== 'FALLEN') {
          throw new ProofError('PROOF_LOST')
        }
      }
    }
  }
  if (run.hazardDeadlines && run.hazardDeadlines.length > 0) {
    for (const deadline of run.hazardDeadlines) {
      const boulder = state.collapsingBoulders?.find(b => b.id === deadline.hazardId)
      if (!boulder || boulder.state !== 'FALLEN') {
        throw new ProofError('PROOF_LOST')
      }
    }
  }

  return { actions, state, transcriptHash, stateHash }
}

function classifyMission(mission: DurableExpeditionRun['mission'], state: ReplayState): Pick<VerifyExpeditionResult, 'outcome' | 'status' | 'rewardStatus' | 'missionSatisfied'> {
  const hp = state.run.hp
  if (hp === 0) {
    return { outcome: 'FAILED', status: 'FAILED', rewardStatus: 'NONE', missionSatisfied: false }
  }
  if (mission === 'gem-runner' && state.run.gemsCollected >= GEM_RUNNER_TARGET) {
    if (state.run.missionStatus !== 'COMPLETE' || state.run.runStatus !== 'MISSION_COMPLETE') throw new ProofError('PROOF_LOST')
    return { outcome: 'VERIFIED_ELIGIBLE', status: 'COMPLETED', rewardStatus: 'ELIGIBLE', missionSatisfied: true }
  }
  if (mission === 'chest-hunter' && state.run.chestsOpened >= CHEST_HUNTER_TARGET) {
    if (state.run.missionStatus !== 'COMPLETE' || state.run.runStatus !== 'MISSION_COMPLETE') throw new ProofError('PROOF_LOST')
    return { outcome: 'VERIFIED_ELIGIBLE', status: 'COMPLETED', rewardStatus: 'ELIGIBLE', missionSatisfied: true }
  }
  if (mission === 'vault-breaker' && state.puzzle.objectiveReached) {
    if (state.run.missionStatus !== 'IN_PROGRESS' || state.run.runStatus !== 'PLAYING') throw new ProofError('PROOF_LOST')
    return { outcome: 'VAULT_GAMEPLAY_VERIFIED', status: 'STARTED', rewardStatus: 'NONE', missionSatisfied: false }
  }
  throw new ProofError('RUN_INCOMPLETE')
}

function createVerifyResult(
  run: DurableExpeditionRun,
  audit: RunAudit,
  classification: Pick<VerifyExpeditionResult, 'outcome' | 'status' | 'rewardStatus' | 'missionSatisfied'>,
  now: Date,
): VerifyExpeditionResult {
  return {
    runId: run.runId,
    checkpointHash: run.checkpointHash,
    outcome: classification.outcome,
    status: classification.status,
    rewardStatus: classification.rewardStatus,
    finalHp: audit.state.run.hp,
    gemsCollected: audit.state.run.gemsCollected,
    chestsOpened: audit.state.run.chestsOpened,
    objectiveReached: audit.state.puzzle.objectiveReached,
    hasTempleKey: audit.state.puzzle.hasTempleKey,
    missionSatisfied: classification.missionSatisfied,
    finalSeq: audit.state.seq,
    transcriptHash: audit.transcriptHash,
    stateHash: audit.stateHash,
    verifiedAt: now.toISOString(),
  }
}

function transcriptFor(run: DurableExpeditionRun, actions: readonly ReplayAction[]): ExpeditionTranscript {
  return {
    version: TRANSCRIPT_VERSION,
    runId: run.runId,
    wallet: run.wallet,
    mission: run.mission,
    rulesVersion: run.blueprint.rulesVersion,
    roomVersion: run.blueprint.roomVersion,
    blueprintVersion: run.blueprint.blueprintVersion,
    blueprintId: run.blueprint.blueprintId,
    blueprintHash: run.blueprint.blueprintHash,
    actions,
  }
}

export function batchFingerprintList(batches: readonly DurableCheckpointBatch[]): readonly string[] {
  return batches.map(batch => batch.batchFingerprint)
}
