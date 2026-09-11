import type { CheckpointAcknowledgement } from '../../src/domain/expeditionProof.ts'
import { hashActionBatch, hashCheckpoint, hashReplayState, hashTranscript } from '../../src/game/replay/canonical.ts'
import { deriveCheckpointProgress } from '../../src/game/replay/checkpointProgress.ts'
import { advanceRun } from '../../src/game/replay/engine.ts'
import {
  ACTION_BATCH_VERSION,
  CHECKPOINT_VERSION,
  MAX_ACCEPTED_ACTIONS,
  MAX_CHECKPOINT_BATCH_ACTIONS,
  TRANSCRIPT_VERSION,
} from '../../src/game/replay/versions.ts'
import type {
  ExpeditionActionBatch,
  ExpeditionCheckpoint,
  ExpeditionTranscript,
  MoveAction,
  ReplayState,
} from '../../src/game/replay/types.ts'
import { ProofError } from './errors.ts'
import type { DurableCheckpointBatch, DurableExpeditionRun } from './types.ts'

export type CheckpointBatchInput = {
  readonly previousCheckpointHash: string
  readonly actions: readonly MoveAction[]
}

export type CheckpointApplyResult = {
  readonly run: DurableExpeditionRun
  readonly acknowledgement: CheckpointAcknowledgement
}

export function applyCheckpointBatch(run: DurableExpeditionRun, input: CheckpointBatchInput): CheckpointApplyResult {
  const actions = input.actions
  if (actions.length === 0 || actions.length > MAX_CHECKPOINT_BATCH_ACTIONS) {
    throw new ProofError('MALFORMED_REQUEST')
  }
  for (const action of actions) {
    if (action.type !== 'MOVE') throw new ProofError('INVALID_ACTION')
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

  let state = run.state
  for (const action of actions) {
    const result = advanceRun(state, action)
    if (!result.accepted) {
      throw new ProofError(result.reason === 'INVALID_SEQUENCE' ? 'INVALID_SEQUENCE' : 'INVALID_ACTION')
    }
    state = result.state
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

function transcriptFor(run: DurableExpeditionRun, actions: readonly MoveAction[]): ExpeditionTranscript {
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
  actions: readonly MoveAction[],
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

function sameActions(left: readonly MoveAction[], right: readonly MoveAction[]): boolean {
  return left.length === right.length
    && left.every((action, index) => {
      const other = right[index]
      return other !== undefined
        && action.seq === other.seq
        && action.type === other.type
        && action.direction === other.direction
    })
}
