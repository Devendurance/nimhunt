import { KeyPair } from '@nimiq/core'
import { describe, expect, it } from 'vitest'
import { hashBlueprint } from '../../src/game/replay/canonical.ts'
import { createRoom01Blueprint } from '../../src/game/world/room01.ts'
import { serializeStartPayload, type StartExpeditionPayload } from './canonical.ts'
import { nimiqSignedMessageHash } from './crypto.ts'
import { dispatchExpeditionHttp, type ExpeditionHttpRequest, type ExpeditionHttpSecurity } from './http.ts'
import { createMemoryProofService } from './memoryProofStore.ts'

const SECURITY: ExpeditionHttpSecurity = {
  expectedOrigin: 'https://hunt.example',
  expectedHost: 'hunt.example',
  expectedProtocol: 'https',
  secureCookie: true,
}

function createFixture() {
  let current = new Date('2026-09-09T12:00:00.000Z')
  const source = createRoom01Blueprint('2026-09-09', 'gem-runner', 'http-blueprint')
  const blueprint = { ...source, status: 'PUBLISHED' as const, blueprintHash: hashBlueprint(source) }
  const service = createMemoryProofService({ clock: { now: () => current }, blueprints: [blueprint] })
  const keyPair = KeyPair.generate()
  const wallet = keyPair.toAddress().toUserFriendlyAddress()
  return { service, keyPair, wallet, setNow: (value: string) => { current = new Date(value) } }
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

async function startExpedition() {
  const fixture = createFixture()
  const challengeResponse = await dispatchExpeditionHttp(fixture.service, {
    method: 'POST',
    path: '/api/expeditions/start-challenge',
    headers: headers(),
    body: { wallet: fixture.wallet, mission: 'gem-runner' },
  }, SECURITY)
  const challenge = challengeResponse.body as {
    ok: true
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
  const startResponse = await dispatchExpeditionHttp(fixture.service, {
    method: 'POST',
    path: '/api/expeditions/start',
    headers: headers(),
    body: {
      payload: canonicalPayload,
      publicKey: fixture.keyPair.publicKey.toHex(),
      signature: fixture.keyPair.sign(nimiqSignedMessageHash(canonicalPayload)).toHex(),
    },
  }, SECURITY)
  return { fixture, challengeResponse, startResponse, cookie: startResponse.headers?.['set-cookie'] ?? '' }
}

describe('authenticated expedition HTTP start surface', () => {
  it('creates a normalized challenge without a cookie and sets a secure session after start', async () => {
    const { challengeResponse, startResponse, cookie } = await startExpedition()

    expect(challengeResponse.status).toBe(200)
    expect(challengeResponse.headers?.['set-cookie']).toBeUndefined()
    expect(challengeResponse.headers?.['cache-control']).toBe('no-store')
    expect(challengeResponse.headers?.['x-content-type-options']).toBe('nosniff')
    expect(challengeResponse.body).toHaveProperty('wallet')

    expect(startResponse.status).toBe(200)
    expect(startResponse.body).toMatchObject({ ok: true, outcome: 'START_CREATED' })
    expect(startResponse.body).not.toHaveProperty('sessionCapability')
    expect(cookie).toContain('Path=/api')
    expect(cookie).toContain('Max-Age=')
    expect(cookie).toContain('Expires=')
    expect(cookie).toContain('Secure')
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Strict')
  }, 15_000)

  it('returns the active blueprint only with the matching session cookie and runId', async () => {
    const { fixture, startResponse, cookie } = await startExpedition()
    const runId = (startResponse.body as { runId: string }).runId

    const active = await dispatchExpeditionHttp(fixture.service, {
      method: 'GET',
      path: `/api/expeditions/active?runId=${runId}`,
      headers: headers({ origin: undefined, cookie }),
    }, SECURITY)

    expect(active.status).toBe(200)
    expect(active.body).toMatchObject({ ok: true, runId, mission: 'gem-runner', gameplayStartedAt: null })
    expect(active.body).toHaveProperty('blueprint')
    expect(active.body).toHaveProperty('state')
    expect(active.body).toHaveProperty('checkpoint')
    expect(active.body).not.toHaveProperty('sessionCapability')
    expect(active.headers?.['set-cookie']).toBeUndefined()
  })

  it('returns wallet daily status through the proof middleware without a session cookie', async () => {
    const fixture = createFixture()
    const status = await dispatchExpeditionHttp(fixture.service, {
      method: 'POST',
      path: '/api/wallet-daily-status',
      headers: headers(),
      body: { wallet: fixture.wallet },
    }, SECURITY)

    expect(status.status).toBe(200)
    expect(status.body).toMatchObject({
      ok: true,
      dayKey: '2026-09-09',
      expeditionsStarted: 0,
      expeditionsRemaining: 3,
      rewardAlreadyReserved: false,
      nextResetAt: '2026-09-10T00:00:00.000Z',
    })
  })

  it('rejects missing, expired, forged, or mismatched session recovery', async () => {
    const { fixture, startResponse } = await startExpedition()
    const runId = (startResponse.body as { runId: string }).runId

    const missingCookie = await dispatchExpeditionHttp(fixture.service, {
      method: 'GET',
      path: `/api/expeditions/active?runId=${runId}`,
      headers: headers({ origin: undefined }),
    }, SECURITY)
    const wrongRun = await dispatchExpeditionHttp(fixture.service, {
      method: 'GET',
      path: `/api/expeditions/active?runId=other-run`,
      headers: headers({ origin: undefined, cookie: startResponse.headers?.['set-cookie'] }),
    }, SECURITY)

    expect(missingCookie.status).toBe(401)
    expect(missingCookie.body).toEqual({ ok: false, error: 'RUN_SESSION_INVALID' })
    expect(wrongRun.status).toBe(401)
    expect(wrongRun.body).toEqual({ ok: false, error: 'RUN_SESSION_INVALID' })
  })

  it('marks gameplay start once and returns a stable success for the exact retry', async () => {
    const { fixture, startResponse, cookie } = await startExpedition()
    const runId = (startResponse.body as { runId: string }).runId
    const request: ExpeditionHttpRequest = {
      method: 'POST',
      path: '/api/expeditions/gameplay-start',
      headers: headers({ cookie }),
      body: { runId },
    }

    const first = await dispatchExpeditionHttp(fixture.service, request, SECURITY)
    const retry = await dispatchExpeditionHttp(fixture.service, request, SECURITY)
    const active = await dispatchExpeditionHttp(fixture.service, {
      method: 'GET',
      path: `/api/expeditions/active?runId=${runId}`,
      headers: headers({ origin: undefined, cookie }),
    }, SECURITY)

    expect(first.body).toEqual({ ok: true, runId, outcome: 'GAMEPLAY_STARTED' })
    expect(retry.body).toEqual({ ok: true, runId, outcome: 'GAMEPLAY_ALREADY_STARTED' })
    expect(first.body).not.toHaveProperty('blueprint')
    expect(active.status).toBe(409)
    expect(active.body).toEqual({ ok: false, error: 'ACTIVE_RUN_UNAVAILABLE' })
  })

  it('rejects cross-origin mutations before authentication or state changes', async () => {
    const { fixture, startResponse, cookie } = await startExpedition()
    const runId = (startResponse.body as { runId: string }).runId
    const response = await dispatchExpeditionHttp(fixture.service, {
      method: 'POST',
      path: '/api/expeditions/gameplay-start',
      headers: headers({ origin: 'https://evil.example', cookie }),
      body: { runId },
    }, SECURITY)

    expect(response.status).toBe(400)
    expect(response.body).toEqual({ ok: false, error: 'MALFORMED_REQUEST' })
  })

  it('rejects strict body and query violations with bounded responses', async () => {
    const fixture = createFixture()
    const unknownField = await dispatchExpeditionHttp(fixture.service, {
      method: 'POST',
      path: '/api/expeditions/start-challenge',
      headers: headers(),
      body: { wallet: fixture.wallet, mission: 'gem-runner', extra: true },
    }, SECURITY)
    const nonJson = await dispatchExpeditionHttp(fixture.service, {
      method: 'POST',
      path: '/api/expeditions/start-challenge',
      headers: headers({ 'content-type': 'text/plain' }),
      rawBody: JSON.stringify({ wallet: fixture.wallet, mission: 'gem-runner' }),
    }, SECURITY)
    const oversized = await dispatchExpeditionHttp(fixture.service, {
      method: 'POST',
      path: '/api/expeditions/start-challenge',
      headers: headers(),
      rawBody: 'x'.repeat(16 * 1024 + 1),
    }, SECURITY)
    const duplicateQuery = await dispatchExpeditionHttp(fixture.service, {
      method: 'GET',
      path: '/api/expeditions/active?runId=one&runId=two',
      headers: headers({ origin: undefined }),
    }, SECURITY)

    expect(unknownField.status).toBe(400)
    expect(nonJson.status).toBe(400)
    expect(oversized.status).toBe(413)
    expect(duplicateQuery.status).toBe(400)
    expect(oversized.headers?.['cache-control']).toBe('no-store')
  })

  it('handles same-origin OPTIONS and rejects wrong methods', async () => {
    const fixture = createFixture()
    const options = await dispatchExpeditionHttp(fixture.service, {
      method: 'OPTIONS',
      path: '/api/expeditions/active',
      headers: headers(),
    }, SECURITY)
    const wrongMethod = await dispatchExpeditionHttp(fixture.service, {
      method: 'PUT',
      path: '/api/expeditions/start',
      headers: headers(),
      body: {},
    }, SECURITY)

    expect(options.status).toBe(204)
    expect(wrongMethod.status).toBe(405)
    expect(wrongMethod.body).toEqual({ ok: false, error: 'MALFORMED_REQUEST' })
    expect(fixture.service.getWalletDailyStatus(fixture.wallet).expeditionsStarted).toBe(0)
  })
})
