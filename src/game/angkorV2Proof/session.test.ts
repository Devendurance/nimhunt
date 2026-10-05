import { describe, expect, it, vi } from 'vitest'
import { createV2Blueprint } from './blueprint'
import { createInitialRun, advanceRun } from '../replay/engine'
import { hashReplayState } from '../replay/canonical'
import {
  V2Session,
  V2_CHECKPOINT_BATCH_ACTIONS,
  V2_CHECKPOINT_CATCHING_UP,
  V2_CHECKPOINT_FLUSH_THRESHOLD,
  V2_CHECKPOINT_HIGH_WATER,
} from './session'
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

function gameplayEvents(durationMs: number): TimedEvent[] {
  const events: TimedEvent[] = []
  let moveIndex = 0
  for (let at = 0; at <= durationMs; at += 145) events.push({ at, type: 'MOVE', direction: moveIndex++ % 2 ? 'DOWN' : 'UP' })
  for (let at = 0; at <= durationMs; at += 150) events.push({ at, type: 'TICK' })
  events.sort((a, b) => a.at - b.at || (a.type === 'MOVE' ? -1 : 1))
  return events
}

async function pump() {
  for (let i = 0; i < 8; i++) await Promise.resolve()
}

/** A virtual transport lets the tests exercise real MOVE/TICK density without
 * sleeping. Each response is still an ordered server ACK for the exact batch. */
async function runLatencyScenario(latencyMs: number | (() => number), durationMs = 3_000) {
  let server = initial(), chain = 'initial', now = 0
  const flights: { request: CheckpointRequest; due: number; resolve: (ack: CheckpointAcknowledgement) => void }[] = []
  const requests: CheckpointRequest[] = []; let maxFlight = 0, maxPending = 0, paused = 0
  const send = async (request: CheckpointRequest): Promise<CheckpointAcknowledgement> => {
    requests.push(structuredClone(request))
    const latency = typeof latencyMs === 'function' ? latencyMs() : latencyMs
    return new Promise(resolve => { flights.push({ request: structuredClone(request), due: now + latency, resolve }); maxFlight = Math.max(maxFlight, flights.length) })
  }
  const session = new V2Session({ initial: server, runId: 'run', checkpointHash: chain, send })
  const events = gameplayEvents(durationMs)

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
    await pump()
  }

  for (const event of events) {
    await settle(event.at)
    if (!session.canAct) paused += 1
    session.dispatch(event.type === 'MOVE' ? { type: 'MOVE', direction: event.direction! } : { type: 'TICK' })
    maxPending = Math.max(maxPending, session.pendingCount)
  }
  for (let guard = 0; guard < 400; guard++) {
    await pump()
    if (!flights.length) {
      if (session.pendingCount === 0) break
      continue
    }
    await settle(Math.min(...flights.map(f => f.due)))
  }
  await session.flush()
  return { session, server, requests, events, maxFlight, maxPending, paused }
}

function uniqueOrderedBatches(requests: CheckpointRequest[]): CheckpointRequest[] {
  const unique: CheckpointRequest[] = []
  for (const request of requests) {
    const previous = unique.at(-1)
    if (previous
      && previous.previousCheckpointHash === request.previousCheckpointHash
      && previous.actions[0]?.seq === request.actions[0]?.seq
      && previous.actions.at(-1)?.seq === request.actions.at(-1)?.seq) continue
    unique.push(request)
  }
  return unique
}

function expectContiguousProof(session: V2Session, server: ReturnType<typeof initial>, requests: CheckpointRequest[], events: TimedEvent[]) {
  expect(session.state.seq).toBe(events.length)
  expect(session.acknowledgedSeq).toBe(events.length)
  expect(session.pendingCount).toBe(0)
  expect(session.state).toEqual(server)
  const batches = uniqueOrderedBatches(requests)
  let next = 1
  const seen = new Set<number>()
  for (const batch of batches) {
    expect(batch.actions[0]?.seq).toBe(next)
    for (const action of batch.actions) {
      expect(seen.has(action.seq)).toBe(false)
      seen.add(action.seq)
    }
    next = batch.actions.at(-1)!.seq + 1
  }
  expect(seen.size).toBe(events.length)
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
    for (let i = 0; i < 20; i++) session.dispatch({ type: 'TICK' })
    expect(session.canAct).toBe(true)
    expect(session.isBackpressured).toBe(false)
    expect(session.pendingCount).toBe(20)
    await pump()
    await session.flush()
    expect(requests[0]).toEqual(requests[1])
    expect(requests[0]!.actions).toHaveLength(V2_CHECKPOINT_FLUSH_THRESHOLD)
    expect(requests[1]!.actions.map(action => action.seq)).toEqual(requests[0]!.actions.map(action => action.seq))
    expect(maxFlight).toBe(1)
    expect(session.acknowledgedSeq).toBe(20); expect(session.canAct).toBe(true)
    const resumed = new V2Session({ initial: state, runId: 'run', checkpointHash: chain, send })
    resumed.dispatch({ type: 'TICK' }); await resumed.flush()
    expect(state.seq).toBe(21)
  })
  it('coalesces the backlog up to 64 after ACK instead of sending fixed 16-action batches', async () => {
    let resolveFirst!: (ack: CheckpointAcknowledgement) => void
    let server = initial(), chain = 'initial'
    const requests: CheckpointRequest[] = []
    const send = vi.fn(async (request: CheckpointRequest) => {
      requests.push(structuredClone(request))
      if (requests.length === 1) return new Promise<CheckpointAcknowledgement>(resolve => { resolveFirst = resolve })
      for (const action of request.actions) server = advanceRun(server, action).state
      chain = `checkpoint-${server.seq}`
      return acknowledgement(request, server, chain)
    })
    const session = new V2Session({ initial: server, runId: 'run', checkpointHash: chain, send })
    for (let i = 0; i < V2_CHECKPOINT_FLUSH_THRESHOLD; i++) session.dispatch({ type: 'TICK' })
    await pump()
    expect(requests[0]?.actions).toHaveLength(V2_CHECKPOINT_FLUSH_THRESHOLD)
    for (let i = 0; i < 53; i++) session.dispatch({ type: 'TICK' })
    expect(session.pendingCount).toBe(V2_CHECKPOINT_FLUSH_THRESHOLD + 53)
    expect(session.canAct).toBe(true)
    for (const action of requests[0]!.actions) server = advanceRun(server, action).state
    chain = `checkpoint-${server.seq}`
    resolveFirst(acknowledgement(requests[0]!, server, chain))
    await pump()
    expect(requests[1]?.actions).toHaveLength(53)
    expect(requests[1]?.actions[0]?.seq).toBe(requests[0]!.actions.at(-1)!.seq + 1)
    await session.flush()
    expect(session.acknowledgedSeq).toBe(V2_CHECKPOINT_FLUSH_THRESHOLD + 53)
    expect(session.pendingCount).toBe(0)
  })
  it('keeps held-rate MOVE/TICK gameplay actionable through transient checkpoint latency', async () => {
    for (const latency of [100, 300, 500, 1_000, 2_000]) {
      const { session, server, requests, events, maxFlight, paused } = await runLatencyScenario(latency)
      expect(session.state.seq, `accepted sequence at ${latency}ms`).toBe(events.length)
      expect(session.canAct, `canAct at ${latency}ms`).toBe(true)
      expect(session.isBackpressured, `backpressure at ${latency}ms`).toBe(false)
      expect(paused, `paused events at ${latency}ms`).toBe(0)
      expect(session.state).toEqual(server)
      expect(maxFlight).toBe(1)
      expectContiguousProof(session, server, requests, events)
    }
  })
  it('sustains a virtual 30-second held direction while 500ms checkpoints drain', async () => {
    const { session, server, events, maxFlight, paused } = await runLatencyScenario(500, 30_000)
    expect(session.state.seq).toBe(events.length)
    expect(session.state).toEqual(server)
    expect(session.canAct).toBe(true)
    expect(session.isBackpressured).toBe(false)
    expect(paused).toBe(0)
    expect(maxFlight).toBe(1)
  })
  it('sustains 60s Reward Expedition movement without pausing at 100-4000ms RTT', async () => {
    const results: { latency: number; maxPending: number; batches: number; seq: number }[] = []
    for (const latency of [100, 500, 1_000, 2_000, 3_000, 4_000]) {
      const { session, server, requests, events, maxFlight, maxPending, paused } = await runLatencyScenario(latency, 60_000)
      expect(session.canAct, `canAct at ${latency}ms`).toBe(true)
      expect(session.isBackpressured, `backpressure at ${latency}ms`).toBe(false)
      expect(paused, `paused events at ${latency}ms`).toBe(0)
      expect(maxFlight).toBe(1)
      expect(maxPending).toBeLessThan(V2_CHECKPOINT_HIGH_WATER)
      expectContiguousProof(session, server, requests, events)
      results.push({ latency, maxPending, batches: uniqueOrderedBatches(requests).length, seq: session.state.seq })
    }
    expect(results).toHaveLength(6)
    expect(results.every(result => result.seq === results[0]!.seq)).toBe(true)
  }, 120_000)
  it('keeps movement through jittered 100/2500/400/3000/150ms transport', async () => {
    const schedule = [100, 2_500, 400, 3_000, 150]
    let index = 0
    const { session, server, requests, events, maxFlight, maxPending, paused } = await runLatencyScenario(() => schedule[index++ % schedule.length]!, 20_000)
    expect(paused).toBe(0)
    expect(session.canAct).toBe(true)
    expect(session.isBackpressured).toBe(false)
    expect(maxFlight).toBe(1)
    expect(maxPending).toBeLessThan(V2_CHECKPOINT_HIGH_WATER)
    expectContiguousProof(session, server, requests, events)
  }, 60_000)
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
    expect(session.metrics.backpressured).toBe(true)
    expect(session.metrics.inFlightSeqStart).toBe(1)
    const blockedSeq = session.state.seq
    session.dispatch({ type: 'TICK' })
    expect(session.state.seq).toBe(blockedSeq)
    expect(session.pendingCount).toBe(V2_CHECKPOINT_HIGH_WATER)

    const firstBatch = first!
    expect(firstBatch.actions.length).toBeLessThanOrEqual(V2_CHECKPOINT_BATCH_ACTIONS)
    for (const action of firstBatch.actions) server = advanceRun(server, action).state
    chain = `checkpoint-${server.seq}`
    resolveFirst(acknowledgement(firstBatch, server, chain))
    await pump()
    expect(session.pendingCount).toBe(V2_CHECKPOINT_HIGH_WATER - firstBatch.actions.length)
    expect(session.canAct).toBe(true)
    expect(session.isBackpressured).toBe(false)
    expect(send.mock.calls[1]?.[0].actions[0].seq).toBe(firstBatch.actions.at(-1)!.seq + 1)
    expect((send.mock.calls[1]?.[0].actions.length ?? 0)).toBeGreaterThan(V2_CHECKPOINT_FLUSH_THRESHOLD)
  })
  it('eventually backpressures a genuinely unusable 5000ms transport', async () => {
    const { session, server, maxPending, paused } = await runLatencyScenario(5_000, 20_000)
    expect(maxPending).toBe(V2_CHECKPOINT_HIGH_WATER)
    expect(paused).toBeGreaterThan(0)
    expect(session.pendingCount).toBeLessThanOrEqual(V2_CHECKPOINT_HIGH_WATER)
    expect(session.state).toEqual(server)
    expect(session.acknowledgedSeq).toBe(session.state.seq)
  }, 60_000)
  it('exposes catching-up without locking input below the high-water mark', () => {
    const session = new V2Session({ initial: initial(), runId: 'run', checkpointHash: 'initial', send: () => new Promise(() => undefined) })
    for (let i = 0; i < V2_CHECKPOINT_CATCHING_UP; i++) session.dispatch({ type: 'TICK' })
    expect(session.pendingCount).toBe(V2_CHECKPOINT_CATCHING_UP)
    expect(session.isCatchingUp).toBe(true)
    expect(session.isBackpressured).toBe(false)
    expect(session.canAct).toBe(true)
    expect(session.metrics.pendingCount).toBe(V2_CHECKPOINT_CATCHING_UP)
    expect(session.metrics.backpressured).toBe(false)
  })
  it('stops movement on a forged acknowledgement and never advances from an incomplete stage', async () => {
    const session = new V2Session({ initial: initial(), runId: 'run', checkpointHash: 'initial', send: async () => ({ stateHash: 'forged' } as CheckpointAcknowledgement) })
    await session.continue(); expect(session.state.seq).toBe(0)
    session.dispatch({ type: 'TICK' }); await expect(session.flush()).rejects.toThrow('MISMATCH')
    expect(session.canAct).toBe(false); expect(session.acknowledgedSeq).toBe(0)
  })
})
