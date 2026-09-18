import { KeyPair } from '@nimiq/core'
import { describe, expect, it } from 'vitest'
import { hashBlueprint } from '../../src/game/replay/canonical.ts'
import type { MoveAction, TickAction } from '../../src/game/replay/types.ts'
import { createDailyAngkorBlueprint } from '../../src/game/world/dailyAngkorLayouts.ts'
import { serializeStartPayload, type StartExpeditionPayload } from './canonical.ts'
import { nimiqSignedMessageHash } from './crypto.ts'
import { dispatchExpeditionHttp, type ExpeditionHttpSecurity } from './http.ts'
import { createMemoryProofService } from './memoryProofStore.ts'
import { serializeRunSessionCookie } from './session.ts'

const TEST_SECURITY: ExpeditionHttpSecurity = {
  expectedOrigin: 'http://localhost:5173',
  expectedHost: 'localhost:5173',
  expectedProtocol: 'http',
  secureCookie: false,
  allowAuthorizedLocalHttpOrigins: true,
}

function moves(start: number, ...directions: MoveAction['direction'][]): MoveAction[] {
  return directions.map((direction, index) => ({ seq: start + index, type: 'MOVE', direction }))
}

function ticks(start: number, count: number): TickAction[] {
  return Array.from({ length: count }, (_, index) => ({ seq: start + index, type: 'TICK' }))
}

function fixture() {
  let current = new Date('2026-09-18T12:00:00.000Z')
  const bpSource = createDailyAngkorBlueprint('2026-09-18', 'vault-breaker', 0, undefined, hashBlueprint)
  const bp = {
    ...bpSource,
    goblins: [],
    hazards: [],
    blueprintHash: '',
  }
  bp.blueprintHash = hashBlueprint(bp)
  const service = createMemoryProofService({
    clock: { now: () => current },
    blueprints: [{ ...bp, status: 'PUBLISHED' as const }],
  })
  const keyPair = KeyPair.generate()
  const wallet = keyPair.toAddress().toUserFriendlyAddress()
  return {
    service,
    keyPair,
    wallet,
    bp,
    setNow: (value: string) => { current = new Date(value) },
    getNow: () => current,
  }
}

async function startVaultBreaker() {
  const started = fixture()
  const challenge = await started.service.issueStartChallenge(started.wallet, 'vault-breaker')
  const payload: StartExpeditionPayload = {
    version: 1,
    type: 'NIMHUNT_START_EXPEDITION',
    wallet: challenge.wallet,
    mission: 'vault-breaker',
    dayKey: challenge.dayKey,
    challenge: challenge.challenge,
    blueprintId: challenge.blueprintId,
    blueprintHash: challenge.blueprintHash,
  }
  const canonicalPayload = serializeStartPayload(payload)
  const authorized = await started.service.authorizeStart({
    payload: canonicalPayload,
    publicKey: started.keyPair.publicKey.toHex(),
    signature: started.keyPair.sign(nimiqSignedMessageHash(canonicalPayload)).toHex(),
  })
  started.service.markGameplayStarted(authorized.start.runId, authorized.session)
  const run = started.service.getRun(authorized.start.runId)
  if (!run) throw new Error('RUN_MISSING')
  return { ...started, authorized, run }
}

describe('1. Deadline Retry Idempotency', () => {
  it('exact retry establishes no duplicate deadline, preserves original T0 and deadline, and cannot extend the warning window', async () => {
    const { service, authorized, run, setNow } = await startVaultBreaker()
    const T0 = '2026-09-18T12:00:00.000Z'
    const originalDeadline = '2026-09-18T12:00:03.000Z'

    // 1. Move triggers ARMED -> WARNING at T0
    const triggerBatch = moves(1, 'RIGHT', 'RIGHT', 'UP', 'UP')
    const ack1 = await service.appendCheckpoint({
      runId: run.runId,
      session: authorized.session,
      previousCheckpointHash: run.checkpointHash,
      actions: triggerBatch,
    })
    expect(ack1.acknowledgedSeq).toBe(4)

    const runAfterTrigger = service.getRun(run.runId)!
    expect(runAfterTrigger.hazardDeadlines).toHaveLength(1)
    expect(runAfterTrigger.hazardDeadlines![0]!.warningStartedAt).toBe(T0)
    expect(runAfterTrigger.hazardDeadlines![0]!.collapseDeadlineAt).toBe(originalDeadline)
    expect(runAfterTrigger.hazardDeadlines![0]!.triggerSeq).toBe(4)

    // 2. Retry the EXACT SAME checkpoint/batch immediately
    const ackRetry1 = await service.appendCheckpoint({
      runId: run.runId,
      session: authorized.session,
      previousCheckpointHash: run.checkpointHash,
      actions: triggerBatch,
    })

    // Assertions for immediate exact retry:
    expect(ackRetry1.checkpointHash).toBe(ack1.checkpointHash)
    expect(ackRetry1.acknowledgedSeq).toBe(ack1.acknowledgedSeq)
    const runAfterRetry1 = service.getRun(run.runId)!
    expect(runAfterRetry1.hazardDeadlines).toHaveLength(1) // no duplicate deadline created
    expect(runAfterRetry1.hazardDeadlines![0]!.warningStartedAt).toBe(T0)
    expect(runAfterRetry1.hazardDeadlines![0]!.collapseDeadlineAt).toBe(originalDeadline)
    expect(runAfterRetry1.state.collapsingBoulders?.[0]?.state).toBe('WARNING')
    expect(runAfterRetry1.checkpointHash).toBe(ack1.checkpointHash)

    // 3. Later retry occurring after real time has elapsed (10 seconds later)
    setNow('2026-09-18T12:00:10.000Z')
    const ackRetryLater = await service.appendCheckpoint({
      runId: run.runId,
      session: authorized.session,
      previousCheckpointHash: run.checkpointHash,
      actions: triggerBatch,
    })

    // Assertions for later retry:
    expect(ackRetryLater.checkpointHash).toBe(ack1.checkpointHash)
    const runAfterLaterRetry = service.getRun(run.runId)!
    expect(runAfterLaterRetry.hazardDeadlines).toHaveLength(1)
    expect(runAfterLaterRetry.hazardDeadlines![0]!.warningStartedAt).toBe(T0) // still exactly original T0
    expect(runAfterLaterRetry.hazardDeadlines![0]!.collapseDeadlineAt).toBe(originalDeadline) // still original deadline!

    // 4. Assert retry cannot extend the warning window:
    // Malicious client now attempts to submit seq 5 moving into impact cell (6,2) at T0 + 10s:
    const exploitBatch = moves(5, 'RIGHT', 'DOWN')
    await expect(service.appendCheckpoint({
      runId: run.runId,
      session: authorized.session,
      previousCheckpointHash: ack1.checkpointHash,
      actions: exploitBatch,
    })).rejects.toThrow('INVALID_ACTION')
  })
})

describe('2. Deadline Client-Tamper Resistance', () => {
  it('rejects HTTP requests containing client-injected top-level deadline metadata', async () => {
    const { service, authorized, run } = await startVaultBreaker()

    const cookieHeader = serializeRunSessionCookie(
      authorized.sessionCapability,
      new Date(authorized.session.expiresAt),
      new Date(authorized.session.createdAt),
      false,
    )

    // Attempt 1: Injecting collapseDeadlineAt at top level
    const response1 = await dispatchExpeditionHttp(service, {
      method: 'POST',
      path: '/api/expeditions/checkpoint',
      headers: {
        origin: TEST_SECURITY.expectedOrigin,
        host: TEST_SECURITY.expectedHost,
        protocol: TEST_SECURITY.expectedProtocol,
        'content-type': 'application/json',
        cookie: cookieHeader,
      },
      body: {
        runId: run.runId,
        previousCheckpointHash: run.checkpointHash,
        actions: moves(1, 'RIGHT'),
        collapseDeadlineAt: '2099-01-01T00:00:00.000Z',
      },
    }, TEST_SECURITY)

    expect(response1.status).toBe(400)
    expect(response1.body).toEqual({ ok: false, error: 'MALFORMED_REQUEST' })

    // Attempt 2: Injecting hazardDeadlines array at top level
    const response2 = await dispatchExpeditionHttp(service, {
      method: 'POST',
      path: '/api/expeditions/checkpoint',
      headers: {
        origin: TEST_SECURITY.expectedOrigin,
        host: TEST_SECURITY.expectedHost,
        protocol: TEST_SECURITY.expectedProtocol,
        'content-type': 'application/json',
        cookie: cookieHeader,
      },
      body: {
        runId: run.runId,
        previousCheckpointHash: run.checkpointHash,
        actions: moves(1, 'RIGHT'),
        hazardDeadlines: [{
          hazardId: 'vb1-collapsing-boulder-1',
          triggerSeq: 1,
          warningStartedAt: '2099-01-01T00:00:00.000Z',
          collapseDeadlineAt: '2099-01-01T00:00:00.000Z',
        }],
      },
    }, TEST_SECURITY)

    expect(response2.status).toBe(400)
    expect(response2.body).toEqual({ ok: false, error: 'MALFORMED_REQUEST' })
  })

  it('rejects HTTP requests containing client-injected fields inside actions', async () => {
    const { service, authorized, run } = await startVaultBreaker()

    const cookieHeader = serializeRunSessionCookie(
      authorized.sessionCapability,
      new Date(authorized.session.expiresAt),
      new Date(authorized.session.createdAt),
      false,
    )

    // Attempt: Injected deadline properties inside action object
    const response = await dispatchExpeditionHttp(service, {
      method: 'POST',
      path: '/api/expeditions/checkpoint',
      headers: {
        origin: TEST_SECURITY.expectedOrigin,
        host: TEST_SECURITY.expectedHost,
        protocol: TEST_SECURITY.expectedProtocol,
        'content-type': 'application/json',
        cookie: cookieHeader,
      },
      body: {
        runId: run.runId,
        previousCheckpointHash: run.checkpointHash,
        actions: [
          {
            seq: 1,
            type: 'MOVE',
            direction: 'RIGHT',
            warningStartedAt: '2099-01-01T00:00:00.000Z',
            collapseDeadlineAt: '2099-01-01T00:00:00.000Z',
            triggerSeq: 999,
          },
        ],
      },
    }, TEST_SECURITY)

    expect(response.status).toBe(400)
    expect(response.body).toEqual({ ok: false, error: 'MALFORMED_REQUEST' })
  })

  it('proves authoritative values originate exclusively from server clock and cannot be moved by client', async () => {
    const { service, authorized, run } = await startVaultBreaker()

    // Pass actions to service.appendCheckpoint with cast to any containing forged fields
    const forgedBatch = [
      { seq: 1, type: 'MOVE', direction: 'RIGHT', collapseDeadlineAt: '2099-01-01T00:00:00.000Z' },
      { seq: 2, type: 'MOVE', direction: 'RIGHT', warningStartedAt: '2099-01-01T00:00:00.000Z' },
      { seq: 3, type: 'MOVE', direction: 'UP' },
      { seq: 4, type: 'MOVE', direction: 'UP', collapseDeadlineAt: '2099-01-01T00:00:00.000Z' },
    ] as unknown as MoveAction[]

    const ack = await service.appendCheckpoint({
      runId: run.runId,
      session: authorized.session,
      previousCheckpointHash: run.checkpointHash,
      actions: forgedBatch,
    })
    expect(ack.acknowledgedSeq).toBe(4)

    // Server established deadline using server clock (12:00:00.000Z), ignoring all forged client fields
    const runAfterAppend = service.getRun(run.runId)!
    expect(runAfterAppend.hazardDeadlines).toBeDefined()
    expect(runAfterAppend.hazardDeadlines![0]!.warningStartedAt).toBe('2026-09-18T12:00:00.000Z')
    expect(runAfterAppend.hazardDeadlines![0]!.collapseDeadlineAt).toBe('2026-09-18T12:00:03.000Z')
    expect(runAfterAppend.hazardDeadlines![0]!.triggerSeq).toBe(4)
  })

  it('prevents client from resetting a FALLEN hazard back to WARNING or ARMED', async () => {
    const { service, authorized, run, setNow } = await startVaultBreaker()

    // Step 1: Trigger ARMED -> WARNING at seq 4
    const triggerBatch = moves(1, 'RIGHT', 'RIGHT', 'UP', 'UP')
    const ack1 = await service.appendCheckpoint({
      runId: run.runId,
      session: authorized.session,
      previousCheckpointHash: run.checkpointHash,
      actions: triggerBatch,
    })

    // Step 2: 4 ticks collapse hazard to FALLEN at seq 8
    setNow('2026-09-18T12:00:01.000Z')
    const ack2 = await service.appendCheckpoint({
      runId: run.runId,
      session: authorized.session,
      previousCheckpointHash: ack1.checkpointHash,
      actions: ticks(5, 4),
    })
    const stateAfterTicks = service.getRun(run.runId)!.state
    expect(stateAfterTicks.collapsingBoulders?.[0]?.state).toBe('FALLEN')

    // Step 3: Malicious client attempts to step back onto trigger cell (5,1) or re-trigger:
    // Move left to (4,1), then back right to (5,1)
    setNow('2026-09-18T12:00:02.000Z')
    const ack3 = await service.appendCheckpoint({
      runId: run.runId,
      session: authorized.session,
      previousCheckpointHash: ack2.checkpointHash,
      actions: moves(9, 'LEFT', 'RIGHT'),
    })

    // State MUST remain FALLEN and cannot be reset to WARNING or ARMED
    const stateAfterReentry = service.getRun(run.runId)!.state
    expect(stateAfterReentry.collapsingBoulders?.[0]?.state).toBe('FALLEN')

    // And movement into impact cell (6,2) remains permanently blocked
    const tryEnterFallen = moves(11, 'RIGHT', 'DOWN')
    await expect(service.appendCheckpoint({
      runId: run.runId,
      session: authorized.session,
      previousCheckpointHash: ack3.checkpointHash,
      actions: tryEnterFallen,
    })).rejects.toThrow('INVALID_ACTION')
  })
})

describe('3. Authoritative Deadline Enforcement & Replay Invariants', () => {
  it('rejects move into impact cell when ticks are withheld and deadline has passed', async () => {
    const { service, authorized, run, setNow } = await startVaultBreaker()

    const triggerBatch = moves(1, 'RIGHT', 'RIGHT', 'UP', 'UP')
    const ack1 = await service.appendCheckpoint({
      runId: run.runId,
      session: authorized.session,
      previousCheckpointHash: run.checkpointHash,
      actions: triggerBatch,
    })
    expect(ack1.acknowledgedSeq).toBe(4)

    const stateAfterTrigger = service.getRun(run.runId)!.state
    expect(stateAfterTrigger.collapsingBoulders?.[0]?.state).toBe('WARNING')
    expect(stateAfterTrigger.collapsingBoulders?.[0]?.elapsedTicks).toBe(0)

    // Wait 15 real seconds
    setNow('2026-09-18T12:00:15.000Z')

    // Move into impact cell (6,2) 15 seconds later
    const exploitBatch = moves(5, 'RIGHT', 'DOWN')

    await expect(service.appendCheckpoint({
      runId: run.runId,
      session: authorized.session,
      previousCheckpointHash: ack1.checkpointHash,
      actions: exploitBatch,
    })).rejects.toThrow('INVALID_ACTION')

    const runAfterExploit = service.getRun(run.runId)!
    expect(runAfterExploit.state.player).toEqual({ x: 5, y: 1 })
    expect(runAfterExploit.seq).toBe(4)
  })

  it('crushes player instantly if standing on impact cell when deadline expires', async () => {
    const { service, authorized, run, setNow } = await startVaultBreaker()

    const fastMoves = moves(1, 'RIGHT', 'RIGHT', 'UP', 'UP', 'RIGHT', 'DOWN')
    const ack1 = await service.appendCheckpoint({
      runId: run.runId,
      session: authorized.session,
      previousCheckpointHash: run.checkpointHash,
      actions: fastMoves,
    })
    expect(ack1.acknowledgedSeq).toBe(6)

    const stateAtImpact = service.getRun(run.runId)!.state
    expect(stateAtImpact.player).toEqual({ x: 6, y: 2 })
    expect(stateAtImpact.collapsingBoulders?.[0]?.state).toBe('WARNING')

    setNow('2026-09-18T12:00:15.000Z')

    const tryMove = moves(7, 'DOWN')
    await expect(service.appendCheckpoint({
      runId: run.runId,
      session: authorized.session,
      previousCheckpointHash: ack1.checkpointHash,
      actions: tryMove,
    })).rejects.toThrow('INVALID_ACTION')
  })

  it('rejects late TICK actions submitted after collapse deadline', async () => {
    const { service, authorized, run, setNow } = await startVaultBreaker()

    const triggerBatch = moves(1, 'RIGHT', 'RIGHT', 'UP', 'UP')
    const ack1 = await service.appendCheckpoint({
      runId: run.runId,
      session: authorized.session,
      previousCheckpointHash: run.checkpointHash,
      actions: triggerBatch,
    })
    expect(ack1.acknowledgedSeq).toBe(4)

    setNow('2026-09-18T12:00:15.000Z')

    const lateTicks = ticks(5, 4)
    await expect(service.appendCheckpoint({
      runId: run.runId,
      session: authorized.session,
      previousCheckpointHash: ack1.checkpointHash,
      actions: lateTicks,
    })).rejects.toThrow('INVALID_ACTION')
  })

  it('fails closed during final verification if ticks were withheld', async () => {
    const { service, authorized, run, setNow } = await startVaultBreaker()

    const triggerBatch = moves(1, 'RIGHT', 'RIGHT', 'UP', 'UP')
    const ack1 = await service.appendCheckpoint({
      runId: run.runId,
      session: authorized.session,
      previousCheckpointHash: run.checkpointHash,
      actions: triggerBatch,
    })

    setNow('2026-09-18T12:00:01.000Z')
    const runAway = moves(5, 'LEFT', 'LEFT')
    const ack2 = await service.appendCheckpoint({
      runId: run.runId,
      session: authorized.session,
      previousCheckpointHash: ack1.checkpointHash,
      actions: runAway,
    })

    setNow('2026-09-18T12:00:15.000Z')

    await expect(service.verifyExpedition({
      runId: run.runId,
      session: authorized.session,
      checkpointHash: ack2.checkpointHash,
    })).rejects.toThrow('PROOF_LOST')
  })

  it('accepts legitimate timely run where ticks arrive before deadline and collapse occurs', async () => {
    const { service, authorized, run, setNow } = await startVaultBreaker()

    const triggerBatch = moves(1, 'RIGHT', 'RIGHT', 'UP', 'UP')
    const ack1 = await service.appendCheckpoint({
      runId: run.runId,
      session: authorized.session,
      previousCheckpointHash: run.checkpointHash,
      actions: triggerBatch,
    })

    setNow('2026-09-18T12:00:00.750Z')
    const tickBatch1 = ticks(5, 2)
    const ack2 = await service.appendCheckpoint({
      runId: run.runId,
      session: authorized.session,
      previousCheckpointHash: ack1.checkpointHash,
      actions: tickBatch1,
    })

    setNow('2026-09-18T12:00:02.250Z')
    const tickBatch2 = ticks(7, 2)
    const ack3 = await service.appendCheckpoint({
      runId: run.runId,
      session: authorized.session,
      previousCheckpointHash: ack2.checkpointHash,
      actions: tickBatch2,
    })

    const stateFallen = service.getRun(run.runId)!.state
    expect(stateFallen.collapsingBoulders?.[0]?.state).toBe('FALLEN')
    expect(stateFallen.collapsingBoulders?.[0]?.elapsedTicks).toBe(4)

    setNow('2026-09-18T12:00:05.000Z')
    const safeMoves = moves(9, 'LEFT', 'LEFT')
    const ack4 = await service.appendCheckpoint({
      runId: run.runId,
      session: authorized.session,
      previousCheckpointHash: ack3.checkpointHash,
      actions: safeMoves,
    })
    expect(ack4.acknowledgedSeq).toBe(10)
  })
})
