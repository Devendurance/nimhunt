import type { CheckpointAcknowledgement } from '../../src/domain/expeditionProof.ts'
import { hashActionBatch, hashCheckpoint, hashReplayState, hashTranscript } from '../../src/game/replay/canonical.ts'
import { deriveCheckpointProgress } from '../../src/game/replay/checkpointProgress.ts'
import { advanceRun } from '../../src/game/replay/engine.ts'
import {
  ACTION_BATCH_VERSION,
  CHECKPOINT_VERSION,
  MAX_ACCEPTED_ACTIONS,
  MAX_CHECKPOINT_BATCH_ACTIONS,
  TIMED_HAZARD_TICK_MS,
  TRANSCRIPT_VERSION,
} from '../../src/game/replay/versions.ts'
import type {
  DurableHazardDeadline,
  ExpeditionActionBatch,
  ExpeditionCheckpoint,
  ExpeditionTranscript,
  ReplayAction,
  ReplayState,
} from '../../src/game/replay/types.ts'
import { ProofError } from './errors.ts'
import type { DurableCheckpointBatch, DurableExpeditionRun } from './types.ts'

const sameCoord = (a: { x: number; y: number }, b: { x: number; y: number }) => a.x === b.x && a.y === b.y

export type CheckpointBatchInput = {
  readonly previousCheckpointHash: string
  readonly actions: readonly ReplayAction[]
}

export type CheckpointApplyResult = {
  readonly run: DurableExpeditionRun
  readonly acknowledgement: CheckpointAcknowledgement
}

export function applyCheckpointBatch(
  run: DurableExpeditionRun,
  input: CheckpointBatchInput,
  options?: { readonly now?: Date },
): CheckpointApplyResult {
  const actions = input.actions
  if (actions.length === 0 || actions.length > MAX_CHECKPOINT_BATCH_ACTIONS) {
    throw new ProofError('MALFORMED_REQUEST')
  }
  for (const action of actions) {
    if (action.type !== 'MOVE' && action.type !== 'TICK') throw new ProofError('INVALID_ACTION')
  }

  const existing = run.batches.find(batch => batch.previousCheckpointHash === input.previousCheckpointHash)
  if (existing) {
    if (sameActions(existing.actions, actions)) {
      return { run, acknowledgement: existing.acknowledgement }
    }
    throw new ProofError('CHECKPOINT_MISMATCH')
  }

  if (input.previousCheckpointHash !== run.checkpointHash) {
    throw new ProofError('CHECKPOINT_MISMATCH')
  }

  const seqStart = actions[0]!.seq
  const seqEnd = actions[actions.length - 1]!.seq
  if (seqStart !== run.seq + 1) throw new ProofError('INVALID_SEQUENCE')
  for (let index = 0; index < actions.length; index += 1) {
    if (actions[index]!.seq !== seqStart + index) throw new ProofError('INVALID_SEQUENCE')
  }
  if (run.seq + actions.length > MAX_ACCEPTED_ACTIONS) throw new ProofError('ACTION_LIMIT_EXCEEDED')

  verifyTrustedSnapshot(run)

  const now = options?.now ?? new Date()
  let hazardDeadlines: DurableHazardDeadline[] = run.hazardDeadlines
    ? [...run.hazardDeadlines]
    : (run.state.hazardDeadlines ? [...run.state.hazardDeadlines] : [])

  let state = run.state

  // Check active deadlines before processing actions:
  // If the deadline for a collapsing boulder has passed while still in WARNING,
  // the server treats the hazard as FALLEN before accepting actions relying on open geometry.
  // Player on impact cell dies instantly (hp = 0, FAILED).
  if (hazardDeadlines.length > 0 && state.collapsingBoulders) {
    let currentBoulders = state.collapsingBoulders
    for (const deadline of hazardDeadlines) {
      if (now.getTime() >= new Date(deadline.collapseDeadlineAt).getTime()) {
        const boulder = currentBoulders.find(b => b.id === deadline.hazardId)
        if (boulder && boulder.state === 'WARNING') {
          const config = state.blueprint.timedHazards.find(h => h.id === deadline.hazardId)
          const targetTicks = boulder.targetTicks ?? config?.warningTicks ?? 4
          let nextRun = state.run
          if (config && sameCoord(state.player, { x: config.x, y: config.y })) {
            nextRun = {
              ...nextRun,
              hp: 0,
              runStatus: 'FAILED',
              missionStatus: 'FAILED',
            }
          }
          currentBoulders = currentBoulders.map(b =>
            b.id === deadline.hazardId
              ? { ...b, state: 'FALLEN' as const, elapsedTicks: targetTicks }
              : b,
          )
          state = {
            ...state,
            run: nextRun,
            collapsingBoulders: currentBoulders,
          }
        }
      }
    }
  }

  for (const action of actions) {
    const priorBoulders = state.collapsingBoulders
    const result = advanceRun(state, action)
    if (!result.accepted) {
      throw new ProofError(result.reason === 'INVALID_SEQUENCE' ? 'INVALID_SEQUENCE' : 'INVALID_ACTION')
    }
    state = result.state

    // If any collapsing boulder transitioned ARMED -> WARNING, establish authoritative server deadline
    if (state.collapsingBoulders) {
      for (const nextBoulder of state.collapsingBoulders) {
        const prior = priorBoulders?.find(b => b.id === nextBoulder.id)
        if ((!prior || prior.state === 'ARMED') && nextBoulder.state === 'WARNING') {
          if (!hazardDeadlines.some(d => d.hazardId === nextBoulder.id)) {
            const config = state.blueprint.timedHazards.find(h => h.id === nextBoulder.id)
            const warningTicks = config?.warningTicks ?? nextBoulder.targetTicks ?? 4
            const warningDurationMs = warningTicks * TIMED_HAZARD_TICK_MS
            const warningStartedAt = now.toISOString()
            const collapseDeadlineAt = new Date(now.getTime() + warningDurationMs).toISOString()
            hazardDeadlines = [
              ...hazardDeadlines,
              {
                hazardId: nextBoulder.id,
                triggerSeq: action.seq,
                warningStartedAt,
                collapseDeadlineAt,
              },
            ]
          }
        }
      }
    }
  }

  state = {
    ...state,
    hazardDeadlines,
  }

  const nextActions = [...run.actions, ...actions]
  const transcriptHash = hashTranscript(transcriptFor(run, nextActions))
  const stateHash = hashReplayState(state)
  const checkpoint = nextCheckpoint(run, state.seq, stateHash, transcriptHash)
  const batch = createBatch(run, input.previousCheckpointHash, actions, seqStart, seqEnd, transcriptHash, stateHash, checkpoint.checkpointHash)
  const acknowledgement = createAcknowledgement(run.runId, batch, state, checkpoint.checkpointHash)
  const nextRun: DurableExpeditionRun = {
    ...run,
    state,
    hazardDeadlines,
    checkpoint,
    checkpointHash: checkpoint.checkpointHash,
    seq: state.seq,
    actions: nextActions,
    batches: [...run.batches, { ...batch, acknowledgement }],
  }
  return { run: nextRun, acknowledgement }
}

function verifyTrustedSnapshot(run: DurableExpeditionRun): void {
  if (hashReplayState(run.state) !== run.checkpoint.stateHash) throw new ProofError('PROOF_LOST')
  if (hashCheckpoint(run.checkpoint) !== run.checkpoint.checkpointHash) throw new ProofError('PROOF_LOST')
  if (run.checkpoint.checkpointHash !== run.checkpointHash) throw new ProofError('PROOF_LOST')
  if (hashTranscript(transcriptFor(run, run.actions)) !== run.checkpoint.transcriptHash) throw new ProofError('PROOF_LOST')
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

function nextCheckpoint(run: DurableExpeditionRun, seq: number, stateHash: string, transcriptHash: string): ExpeditionCheckpoint {
  const base: ExpeditionCheckpoint = {
    version: CHECKPOINT_VERSION,
    runId: run.runId,
    runChallenge: run.runChallenge,
    seq,
    previousCheckpointHash: run.checkpointHash,
    stateHash,
    transcriptHash,
    checkpointHash: '',
  }
  return { ...base, checkpointHash: hashCheckpoint(base) }
}

function createBatch(
  run: DurableExpeditionRun,
  previousCheckpointHash: string,
  actions: readonly ReplayAction[],
  seqStart: number,
  seqEnd: number,
  transcriptHash: string,
  stateHash: string,
  checkpointHash: string,
): Omit<DurableCheckpointBatch, 'acknowledgement'> {
  const canonical: ExpeditionActionBatch = {
    version: ACTION_BATCH_VERSION,
    runId: run.runId,
    previousCheckpointHash,
    seqStart,
    seqEnd,
    actions,
  }
  return {
    previousCheckpointHash,
    seqStart,
    seqEnd,
    actions,
    batchFingerprint: hashActionBatch(canonical),
    transcriptHash,
    stateHash,
    checkpointHash,
  }
}

function createAcknowledgement(
  runId: string,
  batch: Omit<DurableCheckpointBatch, 'acknowledgement'>,
  state: ReplayState,
  checkpointHash: string,
): CheckpointAcknowledgement {
  const progress = deriveCheckpointProgress(state, checkpointHash)
  return {
    runId,
    seqStart: batch.seqStart,
    seqEnd: batch.seqEnd,
    previousCheckpointHash: batch.previousCheckpointHash,
    transcriptHash: batch.transcriptHash,
    stateHash: batch.stateHash,
    batchFingerprint: batch.batchFingerprint,
    ...progress,
  }
}

function sameActions(left: readonly ReplayAction[], right: readonly ReplayAction[]): boolean {
  return left.length === right.length
    && left.every((action, index) => {
      const other = right[index]
      if (!other || action.seq !== other.seq || action.type !== other.type) return false
      if (action.type === 'MOVE' && other.type === 'MOVE') return action.direction === other.direction
      return true
    })
}
