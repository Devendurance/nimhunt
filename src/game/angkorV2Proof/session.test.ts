import { describe, expect, it, vi } from 'vitest'
import { createV2Blueprint } from './blueprint'
import { createInitialRun, advanceRun } from '../replay/engine'
import { hashReplayState } from '../replay/canonical'
import { V2Session } from './session'
import type { CheckpointRequest, CheckpointAcknowledgement } from '../../domain/expeditionProof'

function initial() {
  const blueprint = createV2Blueprint('2026-10-04', 'gem-runner')
  return createInitialRun({ mission: blueprint.mission, blueprint, rulesVersion: blueprint.rulesVersion, roomVersion: blueprint.roomVersion })
}
describe('V2 session checkpoint transport', () => {
  it('Practice runs all reducers without proof transport', () => {
    const session = new V2Session({ initial: initial() })
    for (let i = 0; i < 20; i++) session.dispatch({ type: 'TICK' })
    expect(session.acknowledgedSeq).toBe(20)
    expect(session.state.angkorV2!.expedition.currentStage).toBe('outer-ruins')
  })
  it('retries the identical failed batch, serializes requests and restores nonzero server checkpoints', async () => {
    let state = initial(), chain = 'initial', failures = 1, inFlight = 0, maxFlight = 0
    const requests: CheckpointRequest[] = []
    const send = vi.fn(async (request: CheckpointRequest): Promise<CheckpointAcknowledgement> => {
      requests.push(structuredClone(request)); inFlight++; maxFlight = Math.max(maxFlight, inFlight)
      await Promise.resolve(); inFlight--
      if (failures-- > 0) throw new Error('NETWORK_ERROR')
      expect(request.previousCheckpointHash).toBe(chain)
      for (const action of request.actions) state = advanceRun(state, action).state
      chain = `checkpoint-${state.seq}`
      return { runId: 'run', previousCheckpointHash: request.previousCheckpointHash, seqStart: request.actions[0].seq,
        seqEnd: state.seq, acknowledgedSeq: state.seq, checkpointHash: chain, stateHash: hashReplayState(state),
        transcriptHash: 'a'.repeat(64), batchFingerprint: 'b'.repeat(64), hp: state.run.hp, gemsCollected: state.run.gemsCollected, chestsOpened: 0, hasTempleKey: false, objectiveReached: false, missionSatisfied: false, dead: false }
    })
    const session = new V2Session({ initial: state, runId: 'run', checkpointHash: chain, send })
    for (let i = 0; i < 12; i++) session.dispatch({ type: 'TICK' })
    expect(session.canAct).toBe(false)
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    await session.flush()
    expect(requests[0]).toEqual(requests[1]); expect(maxFlight).toBe(1)
    expect(session.acknowledgedSeq).toBe(12); expect(session.canAct).toBe(true)
    const resumed = new V2Session({ initial: state, runId: 'run', checkpointHash: chain, send })
    resumed.dispatch({ type: 'TICK' }); await resumed.flush()
    expect(state.seq).toBe(13)
  })
  it('stops movement on a forged acknowledgement and never advances from an incomplete stage', async () => {
    const session = new V2Session({ initial: initial(), runId: 'run', checkpointHash: 'initial', send: async () => ({ stateHash: 'forged' } as CheckpointAcknowledgement) })
    await session.continue(); expect(session.state.seq).toBe(0)
    session.dispatch({ type: 'TICK' }); await expect(session.flush()).rejects.toThrow('MISMATCH')
    expect(session.canAct).toBe(false); expect(session.acknowledgedSeq).toBe(0)
  })
})
