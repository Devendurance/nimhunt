import { describe, expect, it } from 'vitest'
import type { CheckpointAcknowledgement } from '../../domain/expeditionProof.ts'
import { createCheckpointQueue } from './checkpointQueue.ts'

const HASH_A = 'a'.repeat(64)
const HASH_B = 'b'.repeat(64)

function ack(overrides: Partial<CheckpointAcknowledgement> = {}): CheckpointAcknowledgement {
  return {
    runId: 'run-1',
    acknowledgedSeq: 8,
    seqStart: 1,
    seqEnd: 8,
    previousCheckpointHash: HASH_A,
    checkpointHash: HASH_B,
    transcriptHash: 'c'.repeat(64),
    stateHash: 'd'.repeat(64),
    batchFingerprint: 'e'.repeat(64),
    hp: 100,
    gemsCollected: 0,
    chestsOpened: 0,
    hasTempleKey: false,
    objectiveReached: false,
    missionSatisfied: false,
    dead: false,
    ...overrides,
  }
}

describe('product checkpoint queue', () => {
  it('starts accepted action sequence at 1 and ignores blocked caller omissions', () => {
    const queue = createCheckpointQueue({ runId: 'run-1', checkpointHash: HASH_A })
    const first = queue.recordAcceptedMove('LEFT')
    expect(first).toEqual({ seq: 1, type: 'MOVE', direction: 'LEFT' })
    expect(queue.snapshot().recordedCount).toBe(1)
  })

  it('batches at most 8 and sends the first 8 after eight accepted moves', () => {
    const queue = createCheckpointQueue({ runId: 'run-1', checkpointHash: HASH_A })
    for (let i = 0; i < 7; i += 1) expect(queue.nextRequest()).toBeNull()
    const directions = ['LEFT', 'RIGHT', 'LEFT', 'RIGHT', 'LEFT', 'RIGHT', 'LEFT', 'RIGHT'] as const
    for (const direction of directions) queue.recordAcceptedMove(direction)
    const request = queue.nextRequest()
    expect(request?.actions).toHaveLength(8)
    expect(request?.actions.map(action => action.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    expect(request?.previousCheckpointHash).toBe(HASH_A)
    expect(queue.nextRequest()).toEqual(request)
  })

  it('keeps accepting moves while a checkpoint is in flight until 16 unacked', () => {
    const queue = createCheckpointQueue({ runId: 'run-1', checkpointHash: HASH_A })
    for (let i = 0; i < 8; i += 1) queue.recordAcceptedMove('LEFT')
    expect(queue.nextRequest()?.actions).toHaveLength(8)
    for (let i = 0; i < 8; i += 1) {
      expect(queue.canAcceptMove()).toBe(true)
      expect(queue.recordAcceptedMove('RIGHT')).toMatchObject({ seq: 9 + i })
    }
    expect(queue.canAcceptMove()).toBe(false)
    expect(queue.recordAcceptedMove('LEFT')).toBeNull()
    expect(queue.snapshot().movementPaused).toBe(true)
    expect(queue.snapshot().unacked).toHaveLength(16)
  })

  it('removes acknowledged actions only after success and resumes movement', () => {
    const queue = createCheckpointQueue({ runId: 'run-1', checkpointHash: HASH_A })
    for (let i = 0; i < 16; i += 1) queue.recordAcceptedMove(i < 8 ? 'LEFT' : 'RIGHT')
    queue.nextRequest()
    expect(queue.acknowledge(ack())).toBe('ok')
    expect(queue.snapshot().acknowledgedSeq).toBe(8)
    expect(queue.snapshot().unacked).toHaveLength(8)
    expect(queue.snapshot().movementPaused).toBe(false)
    expect(queue.canAcceptMove()).toBe(true)
    expect(queue.snapshot().checkpointHash).toBe(HASH_B)
  })

  it('retries the exact in-flight batch after a transient failure', () => {
    const queue = createCheckpointQueue({ runId: 'run-1', checkpointHash: HASH_A })
    for (let i = 0; i < 8; i += 1) queue.recordAcceptedMove('LEFT')
    const first = queue.nextRequest()
    queue.failTransient()
    expect(queue.nextRequest()).toEqual(first)
    expect(queue.snapshot().unacked).toHaveLength(8)
  })

  it('enters PROOF_LOST on unrecoverable failure and resumes local movement without recording', () => {
    const queue = createCheckpointQueue({ runId: 'run-1', checkpointHash: HASH_A })
    queue.recordAcceptedMove('LEFT')
    queue.failUnrecoverable()
    expect(queue.snapshot().proofState).toBe('PROOF_LOST')
    expect(queue.canAcceptMove()).toBe(true)
    expect(queue.recordAcceptedMove('RIGHT')).toBeNull()
    expect(queue.nextRequest()).toBeNull()
  })

  it('flushes remaining accepted actions on terminal request', () => {
    const queue = createCheckpointQueue({ runId: 'run-1', checkpointHash: HASH_A })
    queue.recordAcceptedMove('LEFT')
    queue.recordAcceptedMove('RIGHT')
    queue.recordAcceptedMove('LEFT')
    expect(queue.nextRequest()).toBeNull()
    queue.requestFlush()
    const request = queue.nextRequest()
    expect(request?.actions.map(action => action.seq)).toEqual([1, 2, 3])
  })

  it('preserves action order across two batches', () => {
    const queue = createCheckpointQueue({ runId: 'run-1', checkpointHash: HASH_A })
    const dirs = ['LEFT', 'RIGHT', 'UP', 'DOWN', 'LEFT', 'RIGHT', 'UP', 'DOWN', 'LEFT', 'RIGHT'] as const
    for (const direction of dirs) queue.recordAcceptedMove(direction)
    const first = queue.nextRequest()
    expect(first?.actions.map(action => action.direction)).toEqual(['LEFT', 'RIGHT', 'UP', 'DOWN', 'LEFT', 'RIGHT', 'UP', 'DOWN'])
    queue.acknowledge(ack())
    queue.requestFlush()
    const second = queue.nextRequest()
    expect(second?.actions.map(action => action.direction)).toEqual(['LEFT', 'RIGHT'])
    expect(second?.previousCheckpointHash).toBe(HASH_B)
  })
})
