import { KeyPair } from '@nimiq/core'
import { describe, expect, it } from 'vitest'
import { hashBlueprint } from '../../src/game/replay/canonical.ts'
import { createRoom01Blueprint } from '../../src/game/world/room01.ts'
import type { Direction, MoveAction } from '../../src/game/replay/types.ts'
import { PREVALIDATED_ROOM_01_BOOTSTRAP_WINNING_SEQUENCES } from './room01BootstrapPrevalidation.ts'
import { serializeStartPayload, type StartExpeditionPayload } from './canonical.ts'
import { nimiqSignedMessageHash } from './crypto.ts'
import { serializeWalletRecoveryPayload } from './walletRecovery.ts'
import { dispatchExpeditionHttp, type ExpeditionHttpSecurity } from './http.ts'
import { createMemoryProofService } from './memoryProofStore.ts'
import { minimumPlausibleCompletionMs } from './riskGate.ts'
import {
  parseRunSessionCookie,
  parseWalletRecoverySessionCookie,
} from './session.ts'
import { EXPEDITION_RESULT_PATH } from '../../src/domain/expeditionProof.ts'

const SECURITY: ExpeditionHttpSecurity = {
  expectedOrigin: 'https://hunt.example',
  expectedHost: 'hunt.example',
  expectedProtocol: 'https',
  secureCookie: true,
}

function headers(overrides: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    origin: SECURITY.expectedOrigin,
    host: SECURITY.expectedHost,
    protocol: SECURITY.expectedProtocol,
    'content-type': 'application/json',
    ...overrides,
  }
}

function createFixture() {
  let current = new Date('2026-09-09T12:00:00.000Z')
  const source = createRoom01Blueprint('2026-09-09', 'gem-runner', 'result-blueprint')
  const blueprint = { ...source, status: 'PUBLISHED' as const, blueprintHash: hashBlueprint(source) }
  const service = createMemoryProofService({ clock: { now: () => current }, blueprints: [blueprint] })
  const keyPair = KeyPair.generate()
  const wallet = keyPair.toAddress().toUserFriendlyAddress()
  const otherKeyPair = KeyPair.generate()
  const otherWallet = otherKeyPair.toAddress().toUserFriendlyAddress()
  return {
    service, keyPair, wallet, otherKeyPair, otherWallet,
    clock: { now: () => current, advance: (ms: number) => { current = new Date(current.getTime() + ms) } },
  }
}

async function startRun(fixture: ReturnType<typeof createFixture>, keyPair = fixture.keyPair, wallet = fixture.wallet) {
  const challengeResponse = await dispatchExpeditionHttp(fixture.service, {
    method: 'POST',
    path: '/api/expeditions/start-challenge',
    headers: headers(),
    body: { wallet, mission: 'gem-runner' },
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
  return dispatchExpeditionHttp(fixture.service, {
    method: 'POST',
    path: '/api/expeditions/start',
    headers: headers(),
    body: {
      payload: canonicalPayload,
      publicKey: keyPair.publicKey.toHex(),
      signature: keyPair.sign(nimiqSignedMessageHash(canonicalPayload)).toHex(),
    },
  }, SECURITY)
}

function decodeSequence(encoded: string): Direction[] {
  return [...encoded].map(character => {
    if (character === 'U') return 'UP'
    if (character === 'D') return 'DOWN'
    if (character === 'L') return 'LEFT'
    if (character === 'R') return 'RIGHT'
    throw new Error(`INVALID_SEQUENCE_CHAR:${character}`)
  })
}

async function verifyRunHttp(fixture: ReturnType<typeof createFixture>, runId: string, cookie: string) {
  const directions = decodeSequence(PREVALIDATED_ROOM_01_BOOTSTRAP_WINNING_SEQUENCES['gem-runner'])
  for (let index = 0; index < directions.length; index += 8) {
    const current = fixture.service.getRun(runId)
    if (!current) throw new Error('RUN_MISSING')
    const checkpoint = await dispatchExpeditionHttp(fixture.service, {
      method: 'POST',
      path: '/api/expeditions/checkpoint',
      headers: headers({ cookie }),
      body: {
        runId,
        previousCheckpointHash: current.checkpointHash,
        actions: directions.slice(index, index + 8).map((direction, offset) => ({
          seq: index + offset + 1,
          type: 'MOVE',
          direction,
        } satisfies MoveAction)),
      },
    }, SECURITY)
    expect(checkpoint.status).toBe(200)
  }
  const finished = fixture.service.getRun(runId)
  if (!finished) throw new Error('RUN_MISSING')
  fixture.clock.advance((minimumPlausibleCompletionMs(finished.seq) ?? 0) + 1_000)
  const verified = await dispatchExpeditionHttp(fixture.service, {
    method: 'POST',
    path: '/api/expeditions/verify',
    headers: headers({ cookie }),
    body: { runId, checkpointHash: finished.checkpointHash },
  }, SECURITY)
  expect(verified.status).toBe(200)
  return verified.body as { outcome: string }
}

async function establishWalletRecovery(
  fixture: ReturnType<typeof createFixture>,
  keyPair = fixture.keyPair,
  wallet = fixture.wallet,
) {
  const challengeResponse = await dispatchExpeditionHttp(fixture.service, {
    method: 'POST',
    path: '/api/wallet/recover-challenge',
    headers: headers(),
    body: { wallet },
  }, SECURITY)
  const challenge = challengeResponse.body as {
    wallet: string
    challenge: string
    issuedAt: string
    expiresAt: string
    purpose: 'reward/daily-state recovery'
  }
  const canonicalPayload = serializeWalletRecoveryPayload({
    version: 1,
    type: 'NIMHUNT_RECOVER_SESSION_V1',
    wallet: challenge.wallet,
    challenge: challenge.challenge,
    issuedAt: challenge.issuedAt,
    expiresAt: challenge.expiresAt,
    purpose: challenge.purpose,
  })
  const recovered = await dispatchExpeditionHttp(fixture.service, {
    method: 'POST',
    path: '/api/wallet/recover-session',
    headers: headers(),
    body: {
      payload: canonicalPayload,
      publicKey: keyPair.publicKey.toHex(),
      signature: keyPair.sign(nimiqSignedMessageHash(canonicalPayload)).toHex(),
    },
  }, SECURITY)
  return recovered.headers?.['set-cookie'] ?? ''
}

function resultPath(runId: string) {
  return `${EXPEDITION_RESULT_PATH}?runId=${encodeURIComponent(runId)}`
}

describe('verified terminal result recovery', () => {
  it('requires auth and never returns MALFORMED_REQUEST for a missing session', async () => {
    const fixture = createFixture()
    const started = await startRun(fixture)
    const runId = (started.body as { runId: string }).runId
    const response = await dispatchExpeditionHttp(fixture.service, {
      method: 'GET',
      path: resultPath(runId),
      headers: headers({ origin: undefined }),
    }, SECURITY)
    expect(response.status).toBe(401)
    expect(response.body).toEqual({ ok: false, error: 'RUN_SESSION_INVALID' })
  })

  it('restores the VERIFIED terminal contract with no sensitive internals', async () => {
    const fixture = createFixture()
    const started = await startRun(fixture)
    const runId = (started.body as { runId: string }).runId
    const cookie = started.headers?.['set-cookie'] ?? ''
    await dispatchExpeditionHttp(fixture.service, {
      method: 'POST',
      path: '/api/expeditions/gameplay-start',
      headers: headers({ cookie }),
      body: { runId },
    }, SECURITY)
    await verifyRunHttp(fixture, runId, cookie)
    const walletCookie = await establishWalletRecovery(fixture)

    const response = await dispatchExpeditionHttp(fixture.service, {
      method: 'GET',
      path: resultPath(runId),
      headers: headers({ origin: undefined, cookie: walletCookie }),
    }, SECURITY)
    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ ok: true, runId, outcome: 'VERIFIED_ELIGIBLE', status: 'COMPLETED' })
    const text = JSON.stringify(response.body)
    expect(response.body).not.toHaveProperty('sessionCapability')
    for (const forbidden of ['runChallenge', 'sessionHash', 'session_hash', 'reason_codes', 'reasonCodes', 'signature', 'canonicalPayload']) {
      expect(text).not.toContain(forbidden)
    }
    const walletRaw = parseWalletRecoverySessionCookie(walletCookie)
    if (walletRaw) expect(text).not.toContain(walletRaw)
  }, 15_000)

  it('wallet A cannot recover wallet B result (fail closed, same as unknown)', async () => {
    const fixture = createFixture()
    const started = await startRun(fixture)
    const runId = (started.body as { runId: string }).runId
    const cookie = started.headers?.['set-cookie'] ?? ''
    await dispatchExpeditionHttp(fixture.service, {
      method: 'POST',
      path: '/api/expeditions/gameplay-start',
      headers: headers({ cookie }),
      body: { runId },
    }, SECURITY)
    await verifyRunHttp(fixture, runId, cookie)
    const otherCookie = await establishWalletRecovery(fixture, fixture.otherKeyPair, fixture.otherWallet)

    const foreign = await dispatchExpeditionHttp(fixture.service, {
      method: 'GET',
      path: resultPath(runId),
      headers: headers({ origin: undefined, cookie: otherCookie }),
    }, SECURITY)
    expect(foreign.status).toBe(404)
    expect(foreign.body).toEqual({ ok: false, error: 'RUN_NOT_FOUND' })

    const unknown = await dispatchExpeditionHttp(fixture.service, {
      method: 'GET',
      path: resultPath('00000000-0000-4000-8000-000000000000'),
      headers: headers({ origin: undefined, cookie: otherCookie }),
    }, SECURITY)
    expect(unknown.status).toBe(404)
    expect(unknown.body).toEqual({ ok: false, error: 'RUN_NOT_FOUND' })
  }, 15_000)

  it('non-terminal and abandoned runs cannot masquerade as verified terminals', async () => {
    const fixture = createFixture()
    const started = await startRun(fixture)
    const runId = (started.body as { runId: string }).runId
    const cookie = started.headers?.['set-cookie'] ?? ''
    const walletCookie = await establishWalletRecovery(fixture)

    const pending = await dispatchExpeditionHttp(fixture.service, {
      method: 'GET',
      path: resultPath(runId),
      headers: headers({ origin: undefined, cookie: walletCookie }),
    }, SECURITY)
    expect(pending.status).toBe(409)
    expect(pending.body).toEqual({ ok: false, error: 'ACTIVE_RUN_UNAVAILABLE' })

    const run = fixture.service.getRun(runId)
    if (!run) throw new Error('RUN_MISSING')
    const raw = parseRunSessionCookie(cookie)
    if (!raw) throw new Error('COOKIE_MISSING')
    await dispatchExpeditionHttp(fixture.service, {
      method: 'POST',
      path: '/api/expeditions/gameplay-start',
      headers: headers({ cookie }),
      body: { runId },
    }, SECURITY)
    const playing = fixture.service.getRun(runId)
    if (!playing) throw new Error('RUN_MISSING')
    await fixture.service.abandonExpedition({
      runId,
      session: fixture.service.authenticateSession(raw),
      checkpointHash: playing.checkpointHash,
    })
    const abandoned = await dispatchExpeditionHttp(fixture.service, {
      method: 'GET',
      path: resultPath(runId),
      headers: headers({ origin: undefined, cookie: walletCookie }),
    }, SECURITY)
    expect(abandoned.status).toBe(409)
    expect(abandoned.body).toEqual({ ok: false, error: 'ACTIVE_RUN_UNAVAILABLE' })
  })

  it('accepts a run session bound to the same run, rejects one bound elsewhere', async () => {
    const fixture = createFixture()
    const started = await startRun(fixture)
    const runId = (started.body as { runId: string }).runId
    const cookie = started.headers?.['set-cookie'] ?? ''
    await dispatchExpeditionHttp(fixture.service, {
      method: 'POST',
      path: '/api/expeditions/gameplay-start',
      headers: headers({ cookie }),
      body: { runId },
    }, SECURITY)
    await verifyRunHttp(fixture, runId, cookie)

    const same = await dispatchExpeditionHttp(fixture.service, {
      method: 'GET',
      path: resultPath(runId),
      headers: headers({ origin: undefined, cookie }),
    }, SECURITY)
    expect(same.status).toBe(200)
    expect(same.body).toMatchObject({ ok: true, runId })

    const stillNotActive = await dispatchExpeditionHttp(fixture.service, {
      method: 'GET',
      path: `${'/api/expeditions/active'}?runId=${encodeURIComponent(runId)}`,
      headers: headers({ origin: undefined, cookie }),
    }, SECURITY)
    expect(stillNotActive.status).toBe(409)
    expect(stillNotActive.body).toEqual({ ok: false, error: 'ACTIVE_RUN_UNAVAILABLE' })

    const other = await startRun(fixture)
    const otherCookie = other.headers?.['set-cookie'] ?? ''
    const crossed = await dispatchExpeditionHttp(fixture.service, {
      method: 'GET',
      path: resultPath(runId),
      headers: headers({ origin: undefined, cookie: otherCookie }),
    }, SECURITY)
    expect(crossed.status).toBe(401)
    expect(crossed.body).toEqual({ ok: false, error: 'RUN_SESSION_INVALID' })
  }, 15_000)

  it('production story: stranded run present, verified run recovers and prepares with zero new attempts or runs', async () => {
    const fixture = createFixture()
    await startRun(fixture)
    const attemptsBefore = fixture.service.getWalletDailyStatus(fixture.wallet)
    expect(attemptsBefore).toMatchObject({ expeditionsStarted: 1 })
    const runsBefore = fixture.service.snapshot().runs.length

    const started = await startRun(fixture)
    const runId = (started.body as { runId: string }).runId
    const cookie = started.headers?.['set-cookie'] ?? ''
    await dispatchExpeditionHttp(fixture.service, {
      method: 'POST',
      path: '/api/expeditions/gameplay-start',
      headers: headers({ cookie }),
      body: { runId },
    }, SECURITY)
    await verifyRunHttp(fixture, runId, cookie)
    const walletCookie = await establishWalletRecovery(fixture)

    const restored = await dispatchExpeditionHttp(fixture.service, {
      method: 'GET',
      path: resultPath(runId),
      headers: headers({ origin: undefined, cookie: walletCookie }),
    }, SECURITY)
    expect(restored.status).toBe(200)
    expect(restored.body).toMatchObject({ ok: true, runId, outcome: 'VERIFIED_ELIGIBLE' })

    const recovered = await dispatchExpeditionHttp(fixture.service, {
      method: 'POST',
      path: '/api/expeditions/session/recover',
      headers: headers({ cookie: walletCookie }),
      body: { runId },
    }, SECURITY)
    expect(recovered.status).toBe(200)
    const runCookie = recovered.headers?.['set-cookie'] ?? ''
    const prepared = await dispatchExpeditionHttp(fixture.service, {
      method: 'POST',
      path: '/api/rewards/claim/prepare',
      headers: headers({ cookie: runCookie }),
      body: { runId },
    }, SECURITY)
    expect(prepared.status).toBe(200)
    expect(prepared.body).toMatchObject({ ok: true, outcome: 'PREPARED' })

    expect(fixture.service.getWalletDailyStatus(fixture.wallet).expeditionsStarted)
      .toBe(attemptsBefore.expeditionsStarted + 1)
    expect(fixture.service.snapshot().runs.length).toBe(runsBefore + 1)
    const runRaw = parseRunSessionCookie(runCookie)
    if (runRaw) expect(JSON.stringify(prepared.body)).not.toContain(runRaw)
  }, 20_000)
})
