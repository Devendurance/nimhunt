import type { CheckpointAcknowledgement, CheckpointRequest, ProductProofState } from '../../domain/expeditionProof.ts'
import { MAX_CHECKPOINT_BATCH_ACTIONS, MAX_UNACKNOWLEDGED_ACTIONS } from './versions.ts'
import type { Direction, MoveAction, ReplayAction, TickAction } from './types.ts'

export type CheckpointQueueView = {
  readonly runId: string
  readonly acknowledgedSeq: number
  readonly checkpointHash: string
  readonly unacked: readonly ReplayAction[]
  readonly inFlight: CheckpointRequest | null
  readonly proofState: ProductProofState
  readonly movementPaused: boolean
  readonly flushRequested: boolean
  readonly recordedCount: number
}

export type CheckpointQueue = {
  canAcceptMove(): boolean
  recordAcceptedMove(direction: Direction): MoveAction | null
  recordAcceptedTick(): TickAction | null
  requestFlush(): void
  nextRequest(): CheckpointRequest | null
  acknowledge(ack: CheckpointAcknowledgement): 'ok' | 'conflict'
  failTransient(): void
  failUnrecoverable(): void
  snapshot(): CheckpointQueueView
}

export function createCheckpointQueue(input: {
  readonly runId: string
  readonly checkpointHash: string
}): CheckpointQueue {
  const recorded: ReplayAction[] = []
  let acknowledgedSeq = 0
  let checkpointHash = input.checkpointHash
  let inFlight: CheckpointRequest | null = null
  let proofState: ProductProofState = 'PROOF_ACTIVE'
  let flushRequested = false

  return {
    canAcceptMove() {
      if (proofState === 'PROOF_LOST') return true
      return unackedCount() < MAX_UNACKNOWLEDGED_ACTIONS
    },

    recordAcceptedMove(direction) {
      if (proofState === 'PROOF_LOST') return null
      if (unackedCount() >= MAX_UNACKNOWLEDGED_ACTIONS) return null
      const action: MoveAction = { seq: recorded.length + 1, type: 'MOVE', direction }
      recorded.push(action)
      if (proofState === 'CHECKPOINT_SYNCED') proofState = 'PROOF_ACTIVE'
      return action
    },

    recordAcceptedTick() {
      if (proofState === 'PROOF_LOST') return null
      if (unackedCount() >= MAX_UNACKNOWLEDGED_ACTIONS) return null
      const action: TickAction = { seq: recorded.length + 1, type: 'TICK' }
      recorded.push(action)
      if (proofState === 'CHECKPOINT_SYNCED') proofState = 'PROOF_ACTIVE'
      return action
    },

    requestFlush() {
      if (proofState === 'PROOF_LOST') return
      flushRequested = true
    },

    nextRequest() {
      if (proofState === 'PROOF_LOST') return null
      if (inFlight) {
        proofState = 'CHECKPOINT_PENDING'
        return inFlight
      }
      const pending = recorded.slice(acknowledgedSeq)
      const size = batchSize(pending.length, flushRequested)
      if (size === 0) return null
      inFlight = {
        runId: input.runId,
        previousCheckpointHash: checkpointHash,
        actions: pending.slice(0, size),
      }
      proofState = 'CHECKPOINT_PENDING'
      return inFlight
    },

    acknowledge(ack) {
      if (proofState === 'PROOF_LOST' || !inFlight) return 'conflict'
      const seqStart = inFlight.actions[0]?.seq
      const seqEnd = inFlight.actions[inFlight.actions.length - 1]?.seq
      if (seqStart === undefined
        || seqEnd === undefined
        || ack.runId !== input.runId
        || ack.seqStart !== seqStart
        || ack.seqEnd !== seqEnd
        || ack.acknowledgedSeq !== seqEnd
        || ack.previousCheckpointHash !== inFlight.previousCheckpointHash) {
        return 'conflict'
      }

      acknowledgedSeq = ack.acknowledgedSeq
      checkpointHash = ack.checkpointHash
      inFlight = null
      if (acknowledgedSeq >= recorded.length) flushRequested = false
      proofState = unackedCount() === 0 ? 'CHECKPOINT_SYNCED' : 'PROOF_ACTIVE'
      return 'ok'
    },

    failTransient() {
      if (proofState === 'PROOF_LOST') return
      if (inFlight) proofState = 'CHECKPOINT_PENDING'
    },

    failUnrecoverable() {
      proofState = 'PROOF_LOST'
      inFlight = null
      flushRequested = false
    },

    snapshot() {
      const unacked = recorded.slice(acknowledgedSeq)
      return {
        runId: input.runId,
        acknowledgedSeq,
        checkpointHash,
        unacked,
        inFlight,
        proofState,
        movementPaused: proofState !== 'PROOF_LOST' && unacked.length >= MAX_UNACKNOWLEDGED_ACTIONS,
        flushRequested,
        recordedCount: recorded.length,
      }
    },
  }

  function unackedCount(): number {
    return recorded.length - acknowledgedSeq
  }
}

function batchSize(pending: number, flushRequested: boolean): number {
  if (pending >= MAX_CHECKPOINT_BATCH_ACTIONS) return MAX_CHECKPOINT_BATCH_ACTIONS
  if (flushRequested && pending > 0) return pending
  return 0
}
