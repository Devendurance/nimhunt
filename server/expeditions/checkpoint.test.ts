import { KeyPair } from '@nimiq/core'
import { describe, expect, it } from 'vitest'
import {
  ExpeditionProofApiError,
  parseActiveExpedition,
  parseCheckpointAcknowledgement,
} from '../../src/api/expeditionProof.ts'
import { createProductCheckpointSession } from '../../src/components/play/productCheckpoint.ts'
import type { CheckpointAcknowledgement, CheckpointRequest } from '../../src/domain/expeditionProof.ts'
import { hashBlueprint, hashReplayState, hashTranscript } from '../../src/game/replay/canonical.ts'
import { createRoom01Blueprint } from '../../src/game/world/room01.ts'
import type { MoveAction } from '../../src/game/replay/types.ts'
import { serializeStartPayload, type StartExpeditionPayload } from './canonical.ts'
import { applyCheckpointBatch } from './checkpoint.ts'
import { nimiqSignedMessageHash } from './crypto.ts'
import { ProofError } from './errors.ts'
import { dispatchExpeditionHttp, type ExpeditionHttpSecurity } from './http.ts'
import { createMemoryProofService } from './memoryProofStore.ts'

const SECURITY: ExpeditionHttpSecurity = {
  expectedOrigin: 'https://hunt.example',
  expectedHost: 'hunt.example',
  expectedProtocol: 'https',
  secureCookie: true,
}

function publishedBlueprint() {
  const source = createRoom01Blueprint('2026-09-09', 'gem-runner', 'checkpoint-blueprint')
  return { ...source, status: 'PUBLISHED' as const, blueprintHash: hashBlueprint(source) }
}

function fixture() {
  let current = new Date('2026-09-09T12:00:00.000Z')
  const service = createMemoryProofService({ clock: { now: () => current }, blueprints: [publishedBlueprint()] })
  const keyPair = KeyPair.generate()
  const wallet = keyPair.toAddress().toUserFriendlyAddress()
  return { service, keyPair, wallet, setNow: (value: string) => { current = new Date(value) } }
}

async function startPlaying() {
  const started = fixture()
  const challenge = await started.service.issueStartChallenge(started.wallet, 'gem-runner')
  const payload: StartExpeditionPayload = {
    version: 1,
    type: 'NIMHUNT_START_EXPEDITION',
    wallet: challenge.wallet,
    mission: 'gem-runner',
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

function moves(start: number, ...directions: MoveAction['direction'][]): MoveAction[] {
  return directions.map((direction, index) => ({ seq: start + index, type: 'MOVE', direction }))
}

function headers(cookie: string, overrides: Record<string, string | undefined> = {}) {
  return {
    origin: SECURITY.expectedOrigin,
    host: SECURITY.expectedHost,
    protocol: SECURITY.expectedProtocol,
    'content-type': 'application/json',
    cookie,
    ...overrides,
  }
}

describe('server-acknowledged checkpoint append', () => {
  it('accepts the first MOVE at seq 1 and derives progress from replay', async () => {
    const { service, authorized, run } = await startPlaying()
    const ack = await service.appendCheckpoint({
      runId: run.runId,
      session: authorized.session,
      previousCheckpointHash: run.checkpointHash,
      actions: moves(1, 'LEFT'),
    })
    const next = service.getRun(run.runId)

    expect(ack.acknowledgedSeq).toBe(1)
    expect(ack.seqStart).toBe(1)
    expect(ack.seqEnd).toBe(1)
    expect(ack.previousCheckpointHash).toBe(run.checkpointHash)
    expect(ack.gemsCollected).toBe(1)
    expect(ack.hp).toBe(100)
    expect(ack.dead).toBe(false)
    expect(ack.missionSatisfied).toBe(false)
    expect(next?.seq).toBe(1)
    expect(next?.state.player).toEqual({ x: 2, y: 3 })
    expect(next?.checkpoint.stateHash).toBe(hashReplayState(next!.state))
    expect(next?.checkpoint.transcriptHash).toBe(hashTranscript({
      version: 1,
      runId: run.runId,
      wallet: run.wallet,
      mission: run.mission,
      rulesVersion: run.blueprint.rulesVersion,
      roomVersion: run.blueprint.roomVersion,
      blueprintVersion: run.blueprint.blueprintVersion,
      blueprintId: run.blueprint.blueprintId,
      blueprintHash: run.blueprint.blueprintHash,
      actions: moves(1, 'LEFT'),
    }))
  }, 15_000)

  it('rejects blocked movement without appending', async () => {
    const { service, authorized, run } = await startPlaying()
    await expect(service.appendCheckpoint({
      runId: run.runId,
      session: authorized.session,
      previousCheckpointHash: run.checkpointHash,
      actions: moves(1, 'UP'),
    })).rejects.toMatchObject({ code: 'INVALID_ACTION' })
    expect(service.getRun(run.runId)?.seq).toBe(0)
    expect(service.getRun(run.runId)?.batches).toEqual([])
  }, 15_000)

  it('enforces max 8 actions per request and 256 total', async () => {
    const { service, authorized, run } = await startPlaying()
    const nine = Array.from({ length: 9 }, (_, index) => ({ seq: index + 1, type: 'MOVE' as const, direction: 'LEFT' as const }))
    await expect(service.appendCheckpoint({
      runId: run.runId,
      session: authorized.session,
      previousCheckpointHash: run.checkpointHash,
      actions: nine,
    })).rejects.toMatchObject({ code: 'MALFORMED_REQUEST' })

    const overLimit = { ...run, seq: 256, actions: Array.from({ length: 256 }, (_, index) => ({ seq: index + 1, type: 'MOVE' as const, direction: 'LEFT' as const })) }
    expect(() => applyCheckpointBatch(overLimit, {
      previousCheckpointHash: overLimit.checkpointHash,
      actions: moves(257, 'LEFT'),
    })).toThrow(ProofError)
    try {
      applyCheckpointBatch(overLimit, { previousCheckpointHash: overLimit.checkpointHash, actions: moves(257, 'LEFT') })
    } catch (error) {
      expect(error).toMatchObject({ code: 'ACTION_LIMIT_EXCEEDED' })
    }
  }, 15_000)

  it('returns the same acknowledgement for an exact batch retry and rejects a different stale batch', async () => {
    const { service, authorized, run } = await startPlaying()
    const actions = moves(1, 'LEFT', 'LEFT')
    const first = await service.appendCheckpoint({
      runId: run.runId,
      session: authorized.session,
      previousCheckpointHash: run.checkpointHash,
      actions,
    })
    const retry = await service.appendCheckpoint({
      runId: run.runId,
      session: authorized.session,
      previousCheckpointHash: run.checkpointHash,
      actions,
    })
    expect(retry).toEqual(first)
    expect(service.getRun(run.runId)?.batches).toHaveLength(1)

    await expect(service.appendCheckpoint({
      runId: run.runId,
      session: authorized.session,
      previousCheckpointHash: run.checkpointHash,
      actions: moves(1, 'RIGHT'),
    })).rejects.toMatchObject({ code: 'CHECKPOINT_MISMATCH' })
    expect(service.getRun(run.runId)?.seq).toBe(2)
  }, 15_000)

  it('serializes concurrent same-checkpoint requests', async () => {
    const { service, authorized, run } = await startPlaying()
    const actions = moves(1, 'LEFT')
    const request = {
      runId: run.runId,
      session: authorized.session,
      previousCheckpointHash: run.checkpointHash,
      actions,
    }
    const [first, second] = await Promise.all([
      service.appendCheckpoint(request),
      service.appendCheckpoint(request),
    ])
    expect(second).toEqual(first)
    expect(service.getRun(run.runId)?.batches).toHaveLength(1)
    expect(service.getRun(run.runId)?.seq).toBe(1)
  }, 15_000)

  it('keeps cumulative transcriptHash stable across independent recomputation', async () => {
    const { service, authorized, run } = await startPlaying()
    await service.appendCheckpoint({
      runId: run.runId,
      session: authorized.session,
      previousCheckpointHash: run.checkpointHash,
      actions: moves(1, 'LEFT', 'LEFT', 'RIGHT'),
    })
    const afterFirst = service.getRun(run.runId)!
    await service.appendCheckpoint({
      runId: run.runId,
      session: authorized.session,
      previousCheckpointHash: afterFirst.checkpointHash,
      actions: moves(4, 'RIGHT'),
    })
    const stored = service.getRun(run.runId)!
    expect(stored.checkpoint.transcriptHash).toBe(hashTranscript({
      version: 1,
      runId: run.runId,
      wallet: run.wallet,
      mission: run.mission,
      rulesVersion: run.blueprint.rulesVersion,
      roomVersion: run.blueprint.roomVersion,
      blueprintVersion: run.blueprint.blueprintVersion,
      blueprintId: run.blueprint.blueprintId,
      blueprintHash: run.blueprint.blueprintHash,
      actions: moves(1, 'LEFT', 'LEFT', 'RIGHT', 'RIGHT'),
    }))
  }, 15_000)

  it('fails closed when the trusted snapshot hash does not match', async () => {
    const { run } = await startPlaying()
    const corrupted = {
      ...run,
      state: { ...run.state, seq: 9 },
    }
    expect(() => applyCheckpointBatch(corrupted, {
      previousCheckpointHash: run.checkpointHash,
      actions: moves(1, 'LEFT'),
    })).toThrow(ProofError)
    try {
      applyCheckpointBatch(corrupted, { previousCheckpointHash: run.checkpointHash, actions: moves(1, 'LEFT') })
    } catch (error) {
      expect(error).toMatchObject({ code: 'PROOF_LOST' })
    }
  }, 15_000)

  it('rejects client-derived outcome fields and extra action keys over HTTP', async () => {
    const { service, cookie, run } = await startViaHttp()
    const extra = await dispatchExpeditionHttp(service, {
      method: 'POST',
      path: '/api/expeditions/checkpoint',
      headers: headers(cookie),
      body: {
        runId: run.runId,
        previousCheckpointHash: run.checkpointHash,
        actions: moves(1, 'LEFT'),
        hp: 1,
        gemsCollected: 99,
      },
    }, SECURITY)
    const extraAction = await dispatchExpeditionHttp(service, {
      method: 'POST',
      path: '/api/expeditions/checkpoint',
      headers: headers(cookie),
      body: {
        runId: run.runId,
        previousCheckpointHash: run.checkpointHash,
        actions: [{ seq: 1, type: 'MOVE', direction: 'LEFT', hp: 1 }],
      },
    }, SECURITY)

    expect(extra.status).toBe(400)
    expect(extra.body).toEqual({ ok: false, error: 'MALFORMED_REQUEST' })
    expect(extraAction.status).toBe(400)
    expect(extraAction.body).toEqual({ ok: false, error: 'MALFORMED_REQUEST' })
    expect(service.getRun(run.runId)?.seq).toBe(0)
  }, 15_000)

  it('acknowledges two product batches through the real client checkpoint session', async () => {
    const started = await startAuthenticatedProductRun()
    expect(started.active.checkpoint.checkpointHash).toBe(started.run.checkpointHash)
    expect(started.active.checkpoint.seq).toBe(0)
    expect(started.active.state.seq).toBe(0)
    expect(started.service.getWalletDailyStatus(started.wallet).expeditionsRemaining).toBe(2)

    const acks: CheckpointAcknowledgement[] = []
    const requests: CheckpointRequest[] = []
    const session = createProductCheckpointSession(started.active, {
      retryDelayMs: 0,
      submit: async request => {
        requests.push(request)
        const ack = await submitProductCheckpoint(started.service, started.cookie, request)
        acks.push(ack)
        return ack
      },
    })

    const firstBatch = ['LEFT', 'RIGHT', 'LEFT', 'RIGHT', 'LEFT', 'RIGHT', 'LEFT', 'RIGHT'] as const
    for (const direction of firstBatch) session.recordAcceptedMove(direction)
    await session.flushPending()

    expect(requests[0]?.previousCheckpointHash).toBe(started.active.checkpoint.checkpointHash)
    expect(requests[0]?.actions.map(action => action.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    expect(requests[0]?.actions.every(action => action.type === 'MOVE')).toBe(true)
    expect(acks[0]?.acknowledgedSeq).toBe(8)
    expect(session.snapshot()).toMatchObject({ proofLost: false, movementPaused: false })
    expect(session.canAcceptMove()).toBe(true)
    expect(started.service.getRun(started.run.runId)?.seq).toBe(8)
    expect(started.service.getRun(started.run.runId)?.status).toBe('STARTED')
    expect(started.service.getWalletDailyStatus(started.wallet).expeditionsRemaining).toBe(2)

    const secondBatch = ['LEFT', 'RIGHT', 'LEFT', 'RIGHT', 'LEFT', 'RIGHT', 'LEFT', 'RIGHT'] as const
    for (const direction of secondBatch) session.recordAcceptedMove(direction)
    await session.flushPending()

    expect(requests[1]?.previousCheckpointHash).toBe(acks[0]?.checkpointHash)
    expect(requests[1]?.actions.map(action => action.seq)).toEqual([9, 10, 11, 12, 13, 14, 15, 16])
    expect(acks[1]?.acknowledgedSeq).toBe(16)
    expect(session.snapshot()).toMatchObject({ proofLost: false, movementPaused: false, proofState: 'CHECKPOINT_SYNCED' })
    expect(session.canAcceptMove()).toBe(true)
    expect(started.service.getRun(started.run.runId)?.seq).toBe(16)
    expect(started.service.getWalletDailyStatus(started.wallet).expeditionsRemaining).toBe(2)
    session.stop()
  }, 15_000)

  it('acknowledges an 8-move product checkpoint over the authenticated HTTP surface', async () => {
    const { service, cookie, run } = await startViaHttp()
    const actions = moves(1, 'LEFT', 'RIGHT', 'LEFT', 'RIGHT', 'LEFT', 'RIGHT', 'LEFT', 'RIGHT')
    const response = await dispatchExpeditionHttp(service, {
      method: 'POST',
      path: '/api/expeditions/checkpoint',
      headers: headers(cookie),
      body: {
        runId: run.runId,
        previousCheckpointHash: run.checkpointHash,
        actions,
      },
    }, SECURITY)
    const crossOrigin = await dispatchExpeditionHttp(service, {
      method: 'POST',
      path: '/api/expeditions/checkpoint',
      headers: headers(cookie, { origin: 'https://evil.example' }),
      body: {
        runId: run.runId,
        previousCheckpointHash: run.checkpointHash,
        actions: moves(1, 'LEFT'),
      },
    }, SECURITY)

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({
      ok: true,
      runId: run.runId,
      acknowledgedSeq: 8,
      seqStart: 1,
      seqEnd: 8,
      dead: false,
      missionSatisfied: false,
    })
    expect(response.body).not.toHaveProperty('player')
    expect(response.body).not.toHaveProperty('goblins')
    expect(crossOrigin.status).toBe(400)
    expect(crossOrigin.body).toEqual({ ok: false, error: 'MALFORMED_REQUEST' })
    expect(service.getRun(run.runId)?.seq).toBe(8)
  }, 15_000)

  it('requires the gameplay-start marker and the authenticated session cookie', async () => {
    const started = fixture()
    const challenge = await started.service.issueStartChallenge(started.wallet, 'gem-runner')
    const payload: StartExpeditionPayload = {
      version: 1,
      type: 'NIMHUNT_START_EXPEDITION',
      wallet: challenge.wallet,
      mission: 'gem-runner',
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
    const run = started.service.getRun(authorized.start.runId)!
    await expect(started.service.appendCheckpoint({
      runId: run.runId,
      session: authorized.session,
      previousCheckpointHash: run.checkpointHash,
      actions: moves(1, 'LEFT'),
    })).rejects.toMatchObject({ code: 'RUN_NOT_ACTIVE' })
  }, 15_000)
})

async function startViaHttp() {
  const started = await startExpeditionHttp()
  await dispatchExpeditionHttp(started.service, {
    method: 'POST',
    path: '/api/expeditions/gameplay-start',
    headers: headers(started.cookie),
    body: { runId: started.run.runId },
  }, SECURITY)
  return started
}

async function startAuthenticatedProductRun() {
  const started = await startExpeditionHttp()
  const activeResponse = await dispatchExpeditionHttp(started.service, {
    method: 'GET',
    path: `/api/expeditions/active?runId=${encodeURIComponent(started.run.runId)}`,
    headers: headers(started.cookie),
  }, SECURITY)
  const active = parseActiveExpedition(activeResponse.body)
  if (!active) throw new Error('ACTIVE_PARSE_FAILED')
  const gameplayStart = await dispatchExpeditionHttp(started.service, {
    method: 'POST',
    path: '/api/expeditions/gameplay-start',
    headers: headers(started.cookie),
    body: { runId: started.run.runId },
  }, SECURITY)
  if (gameplayStart.status !== 200) throw new Error('GAMEPLAY_START_FAILED')
  return { ...started, active }
}

async function submitProductCheckpoint(
  service: ReturnType<typeof createMemoryProofService>,
  cookie: string,
  request: CheckpointRequest,
): Promise<CheckpointAcknowledgement> {
  const response = await dispatchExpeditionHttp(service, {
    method: 'POST',
    path: '/api/expeditions/checkpoint',
    headers: headers(cookie),
    rawBody: JSON.stringify(request),
  }, SECURITY)
  if (response.status !== 200) {
    const body = response.body
    const code = typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string'
      ? body.error
      : 'MALFORMED_RESPONSE'
    throw new ExpeditionProofApiError(code as ConstructorParameters<typeof ExpeditionProofApiError>[0])
  }
  const parsed = parseCheckpointAcknowledgement(response.body)
  if (!parsed) throw new ExpeditionProofApiError('MALFORMED_RESPONSE')
  return parsed
}

async function startExpeditionHttp() {
  const started = fixture()
  const challengeResponse = await dispatchExpeditionHttp(started.service, {
    method: 'POST',
    path: '/api/expeditions/start-challenge',
    headers: {
      origin: SECURITY.expectedOrigin,
      host: SECURITY.expectedHost,
      protocol: SECURITY.expectedProtocol,
      'content-type': 'application/json',
    },
    body: { wallet: started.wallet, mission: 'gem-runner' },
  }, SECURITY)
  const challenge = challengeResponse.body as {
    wallet: string
    challenge: string
    dayKey: string
    blueprintId: string
    blueprintHash: string
  }
  const payload: StartExpeditionPayload = {
    version: 1,
    type: 'NIMHUNT_START_EXPEDITION',
    wallet: challenge.wallet,
    mission: 'gem-runner',
    dayKey: challenge.dayKey,
    challenge: challenge.challenge,
    blueprintId: challenge.blueprintId,
    blueprintHash: challenge.blueprintHash,
  }
  const canonicalPayload = serializeStartPayload(payload)
  const startResponse = await dispatchExpeditionHttp(started.service, {
    method: 'POST',
    path: '/api/expeditions/start',
    headers: {
      origin: SECURITY.expectedOrigin,
      host: SECURITY.expectedHost,
      protocol: SECURITY.expectedProtocol,
      'content-type': 'application/json',
    },
    body: {
      payload: canonicalPayload,
      publicKey: started.keyPair.publicKey.toHex(),
      signature: started.keyPair.sign(nimiqSignedMessageHash(canonicalPayload)).toHex(),
    },
  }, SECURITY)
  const cookie = startResponse.headers?.['set-cookie'] ?? ''
  const runId = (startResponse.body as { runId: string }).runId
  const run = started.service.getRun(runId)
  if (!run) throw new Error('RUN_MISSING')
  return { ...started, cookie, run }
}
