import { describe, expect, it, vi } from 'vitest'
import { createV2Blueprint } from './blueprint'
import { createInitialRun, advanceRun } from '../replay/engine'
import { hashReplayState } from '../replay/canonical'
import { V2Session, V2_CHECKPOINT_HIGH_WATER } from './session'
import type { CheckpointRequest, CheckpointAcknowledgement } from '../../domain/expeditionProof'

function initial() {
  const blueprint = createV2Blueprint('2026-10-04', 'gem-runner')
  return createInitialRun({ mission: blueprint.mission, blueprint, rulesVersion: blueprint.rulesVersion, roomVersion: blueprint.roomVersion })
}

function acknowledgement(request: CheckpointRequest, state: ReturnType<typeof initial>, checkpointHash: string): CheckpointAcknowledgement {
  return { runId: request.runId, previousCheckpointHash: request.previousCheckpointHash, seqStart: request.actions[0].seq,
    seqEnd: request.actions.at(-1)!.seq, acknowledgedSeq: state.seq, checkpointHash, stateHash: hashReplayState(state),
    transcriptHash: 'a'.repeat(64), batchFingerprint: 'b'.repeat(64), hp: state.run.hp, gemsCollected: state.run.gemsCollected,
    chestsOpened: 0, hasTempleKey: false, objectiveReached: false, missionSatisfied: false, dead: false }
}

type TimedEvent = { at: number; type: 'MOVE' | 'TICK'; direction?: 'UP' | 'DOWN' }

/** A virtual transport lets the tests exercise real MOVE/TICK density without
 * sleeping. Each response is still an ordered server ACK for the exact batch. */
async function runLatencyScenario(latencyMs: number, durationMs = 3_000) {
  let server = initial(), chain = 'initial', now = 0
  const flights: { request: CheckpointRequest; due: number; resolve: (ack: CheckpointAcknowledgement) => void }[] = []
  const requests: CheckpointRequest[] = []; let maxFlight = 0
  const send = async (request: CheckpointRequest): Promise<CheckpointAcknowledgement> => {
    requests.push(structuredClone(request))
    return new Promise(resolve => { flights.push({ request: structuredClone(request), due: now + latencyMs, resolve }); maxFlight = Math.max(maxFlight, flights.length) })
  }
  const session = new V2Session({ initial: server, runId: 'run', checkpointHash: chain, send })
  const events: TimedEvent[] = []
  let moveIndex = 0
  for (let at = 0; at <= durationMs; at += 145) events.push({ at, type: 'MOVE', direction: moveIndex++ % 2 ? 'DOWN' : 'UP' })
  for (let at = 0; at <= durationMs; at += 150) events.push({ at, type: 'TICK' })
  events.sort((a, b) => a.at - b.at || (a.type === 'MOVE' ? -1 : 1))

  const settle = async (at: number) => {
    now = at
    const due = flights.filter(f => f.due <= now)
    for (const flight of due) flights.splice(flights.indexOf(flight), 1)
    for (const flight of due) {
      expect(flight.request.previousCheckpointHash).toBe(chain)
      for (const action of flight.request.actions) server = advanceRun(server, action).state
      chain = `checkpoint-${server.seq}`
      flight.resolve(acknowledgement(flight.request, server, chain))
    }
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
  }

  for (const event of events) {
    await settle(event.at)
    session.dispatch(event.type === 'MOVE' ? { type: 'MOVE', direction: event.direction! } : { type: 'TICK' })
  }
  // Drain all ACKs and the strictly ordered follow-up batches. No real clock
  // is used, so this also catches accidental parallel requests deterministically.
  for (let guard = 0; guard < 100; guard++) {
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    if (!flights.length) {
      if (session.pendingCount === 0) break
      continue
    }
    await settle(Math.min(...flights.map(f => f.due)))
  }
  await session.flush()
  return { session, server, requests, events, maxFlight }
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
    expect(session.canAct).toBe(true)
    expect(session.isBackpressured).toBe(false)
    expect(session.pendingCount).toBe(12)
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    await session.flush()
    expect(requests[0]).toEqual(requests[1]); expect(maxFlight).toBe(1)
    expect(session.acknowledgedSeq).toBe(12); expect(session.canAct).toBe(true)
    const resumed = new V2Session({ initial: state, runId: 'run', checkpointHash: chain, send })
    resumed.dispatch({ type: 'TICK' }); await resumed.flush()
    expect(state.seq).toBe(13)
  })
  it('keeps held-rate MOVE/TICK gameplay actionable through transient checkpoint latency', async () => {
    for (const latency of [100, 300, 500, 1_000, 2_000]) {
      const { session, server, requests, events, maxFlight } = await runLatencyScenario(latency)
      expect(session.state.seq, `accepted sequence at ${latency}ms`).toBe(events.length)
      expect(session.canAct, `canAct at ${latency}ms`).toBe(true)
      expect(session.isBackpressured, `backpressure at ${latency}ms`).toBe(false)
      expect(session.state).toEqual(server)
      expect(maxFlight).toBe(1)
      expect(new Set(requests.map(request => request.actions[0].seq)).size).toBe(requests.length)
    }
  })
  it('sustains a virtual 30-second held direction while 500ms checkpoints drain', async () => {
    const { session, server, events, maxFlight } = await runLatencyScenario(500, 30_000)
    expect(session.state.seq).toBe(events.length)
    expect(session.state).toEqual(server)
    expect(session.canAct).toBe(true)
    expect(session.isBackpressured).toBe(false)
    expect(maxFlight).toBe(1)
  })
  it('bounds an unavailable transport and resumes after the first ordered ACK', async () => {
    let resolveFirst!: (ack: CheckpointAcknowledgement) => void
    let server = initial(), chain = 'initial', first: CheckpointRequest | undefined
    const send = vi.fn(async (request: CheckpointRequest) => {
      first = structuredClone(request)
      return new Promise<CheckpointAcknowledgement>(resolve => { resolveFirst = resolve })
    })
    const session = new V2Session({ initial: server, runId: 'run', checkpointHash: chain, send })
    for (let i = 0; i < V2_CHECKPOINT_HIGH_WATER; i++) session.dispatch({ type: 'TICK' })
    expect(session.pendingCount).toBe(V2_CHECKPOINT_HIGH_WATER)
    expect(session.isBackpressured).toBe(true)
    expect(session.canAct).toBe(false)
    const blockedSeq = session.state.seq
    session.dispatch({ type: 'TICK' })
    expect(session.state.seq).toBe(blockedSeq)
    expect(session.pendingCount).toBe(V2_CHECKPOINT_HIGH_WATER)

    const firstBatch = first!
    for (const action of firstBatch.actions) server = advanceRun(server, action).state
    chain = `checkpoint-${server.seq}`
    resolveFirst(acknowledgement(firstBatch, server, chain))
    for (let i = 0; i < 8; i++) await Promise.resolve()
    expect(session.pendingCount).toBe(V2_CHECKPOINT_HIGH_WATER - firstBatch.actions.length)
    expect(session.canAct).toBe(true)
    expect(session.isBackpressured).toBe(false)
    expect(send.mock.calls[1]?.[0].actions[0].seq).toBe(firstBatch.actions.at(-1)!.seq + 1)
  })
  it('stops movement on a forged acknowledgement and never advances from an incomplete stage', async () => {
    const session = new V2Session({ initial: initial(), runId: 'run', checkpointHash: 'initial', send: async () => ({ stateHash: 'forged' } as CheckpointAcknowledgement) })
    await session.continue(); expect(session.state.seq).toBe(0)
    session.dispatch({ type: 'TICK' }); await expect(session.flush()).rejects.toThrow('MISMATCH')
    expect(session.canAct).toBe(false); expect(session.acknowledgedSeq).toBe(0)
  })
})
