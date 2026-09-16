import { KeyPair } from '@nimiq/core'
import { describe, expect, it } from 'vitest'
import { hashBlueprint } from '../../src/game/replay/canonical.ts'
import { createRoom01Blueprint } from '../../src/game/world/room01.ts'
import { serializeStartPayload, type StartExpeditionPayload } from './canonical.ts'
import { serializeWalletRecoveryPayload } from './walletRecovery.ts'
import { nimiqSignedMessageHash } from './crypto.ts'
import { parseStartChallengeResponse } from '../../src/api/expeditionProof.ts'
import { dispatchExpeditionHttp, type ExpeditionHttpRequest, type ExpeditionHttpSecurity } from './http.ts'
import { createMemoryProofService } from './memoryProofStore.ts'
import { describeSessionCookie, parseRunSessionCookie, parseWalletRecoverySessionCookie } from './session.ts'

const SECURITY: ExpeditionHttpSecurity = {
  expectedOrigin: 'https://hunt.example',
  expectedHost: 'hunt.example',
  expectedProtocol: 'https',
  secureCookie: true,
}

const LOCAL_SECURITY: ExpeditionHttpSecurity = {
  expectedOrigin: 'http://localhost:5173',
  expectedHost: 'localhost:5173',
  expectedProtocol: 'http',
  secureCookie: false,
  allowAuthorizedLocalHttpOrigins: true,
}

const LAN = {
  origin: 'http://192.168.0.134:5173',
  host: '192.168.0.134:5173',
  protocol: 'http' as const,
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
    const { fixture, challengeResponse, startResponse, cookie } = await startExpedition()

    expect(challengeResponse.status).toBe(200)
    expect(challengeResponse.headers?.['set-cookie']).toBeUndefined()
    expect(challengeResponse.headers?.['cache-control']).toBe('no-store')
    expect(challengeResponse.headers?.['content-type']).toBe('application/json; charset=utf-8')
    expect(challengeResponse.headers?.['x-content-type-options']).toBe('nosniff')
    expect(Object.keys(challengeResponse.body as object).sort()).toEqual(
      ['blueprintHash', 'blueprintId', 'challenge', 'dayKey', 'expiresAt', 'ok', 'wallet'],
    )
    expect(parseStartChallengeResponse(challengeResponse.body)).toMatchObject({ wallet: expect.any(String) })

    expect(startResponse.status).toBe(200)
    expect(startResponse.body).toMatchObject({ ok: true, outcome: 'START_CREATED' })
    expect(startResponse.body).not.toHaveProperty('sessionCapability')
    const session = fixture.service.snapshot().sessions[0]
    expect(session).toBeDefined()
    const remainingSeconds = Math.floor(
      (new Date(session!.expiresAt).getTime() - new Date(session!.createdAt).getTime()) / 1_000,
    )
    expect(cookie).toContain('Path=/api')
    expect(cookie).toContain(`Max-Age=${remainingSeconds}`)
    expect(cookie).toContain(`Expires=${new Date(session!.expiresAt).toUTCString()}`)
    expect(remainingSeconds).toBeGreaterThan(0)
    expect(new Date(session!.expiresAt).getTime()).toBeLessThanOrEqual(
      new Date(session!.createdAt).getTime() + 24 * 60 * 60 * 1_000,
    )
    expect(cookie).toContain('Secure')
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Strict')
    expect(cookie).not.toMatch(/Domain=/i)
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

  it('reports two remaining after a durable start and does not consume another attempt at gameplay-start', async () => {
    const { fixture, startResponse, cookie } = await startExpedition()
    const runId = (startResponse.body as { runId: string }).runId

    const afterStart = await dispatchExpeditionHttp(fixture.service, {
      method: 'POST',
      path: '/api/wallet-daily-status',
      headers: headers(),
      body: { wallet: fixture.wallet },
    }, SECURITY)
    expect(afterStart.body).toMatchObject({
      ok: true,
      expeditionsStarted: 1,
      expeditionsRemaining: 2,
    })

    const gameplay = await dispatchExpeditionHttp(fixture.service, {
      method: 'POST',
      path: '/api/expeditions/gameplay-start',
      headers: headers({ cookie }),
      body: { runId },
    }, SECURITY)
    expect(gameplay.body).toMatchObject({ ok: true, outcome: 'GAMEPLAY_STARTED' })

    const afterGameplay = await dispatchExpeditionHttp(fixture.service, {
      method: 'POST',
      path: '/api/wallet-daily-status',
      headers: headers(),
      body: { wallet: fixture.wallet },
    }, SECURITY)
    expect(afterGameplay.body).toMatchObject({
      ok: true,
      expeditionsStarted: 1,
      expeditionsRemaining: 2,
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

  it('returns PROOF_UNAVAILABLE when origin policy or proof service is unconfigured', async () => {
    const missingOrigin = await dispatchExpeditionHttp(null, {
      method: 'POST',
      path: '/api/expeditions/start-challenge',
      headers: {
        origin: 'http://192.168.1.10:5173',
        host: '192.168.1.10:5173',
        'content-type': 'application/json',
      },
      host: '192.168.1.10:5173',
      protocol: 'http',
      body: { wallet: 'NQ00 TEST WALLET', mission: 'gem-runner' },
    }, {
      expectedOrigin: '',
      expectedHost: '',
      expectedProtocol: 'https',
      secureCookie: true,
    })
    const fixture = createFixture()
    const unavailable = await dispatchExpeditionHttp(null, {
      method: 'POST',
      path: '/api/expeditions/start-challenge',
      headers: headers(),
      body: { wallet: fixture.wallet, mission: 'gem-runner' },
    }, SECURITY)

    expect(missingOrigin.status).toBe(503)
    expect(missingOrigin.body).toEqual({ ok: false, error: 'PROOF_UNAVAILABLE' })
    expect(unavailable.status).toBe(503)
    expect(unavailable.body).toEqual({ ok: false, error: 'PROOF_UNAVAILABLE' })
  })

  it('returns INVALID_WALLET without creating a challenge, run, or session', async () => {
    const fixture = createFixture()
    const response = await dispatchExpeditionHttp(fixture.service, {
      method: 'POST',
      path: '/api/expeditions/start-challenge',
      headers: headers(),
      body: { wallet: 'NQ00 NOT A WALLET', mission: 'gem-runner' },
    }, SECURITY)

    expect(response.status).toBe(400)
    expect(response.body).toEqual({ ok: false, error: 'INVALID_WALLET' })
    expect(fixture.service.snapshot()).toMatchObject({ challenges: [], runs: [], sessions: [] })
    expect(fixture.service.getWalletDailyStatus(fixture.wallet).expeditionsStarted).toBe(0)
  })

  it('accepts a LAN development origin alias and yields a client-parseable start-challenge body', async () => {
    const fixture = createFixture()
    const security: ExpeditionHttpSecurity = {
      expectedOrigin: 'http://localhost:5173',
      expectedHost: 'localhost:5173',
      expectedProtocol: 'http',
      secureCookie: false,
      allowAuthorizedLocalHttpOrigins: true,
    }
    const response = await dispatchExpeditionHttp(fixture.service, {
      method: 'POST',
      path: '/api/expeditions/start-challenge',
      headers: {
        origin: 'http://192.168.1.10:5173',
        host: '192.168.1.10:5173',
        protocol: 'http',
        'content-type': 'application/json',
      },
      host: '192.168.1.10:5173',
      protocol: 'http',
      body: { wallet: fixture.wallet, mission: 'gem-runner' },
    }, security)
    const parsed = parseStartChallengeResponse(response.body)

    expect(response.status).toBe(200)
    expect(response.headers?.['content-type']).toBe('application/json; charset=utf-8')
    expect(Object.keys(response.body as object).sort()).toEqual(
      ['blueprintHash', 'blueprintId', 'challenge', 'dayKey', 'expiresAt', 'ok', 'wallet'],
    )
    expect(parsed).toMatchObject({
      wallet: fixture.wallet,
      blueprintId: 'http-blueprint',
      dayKey: '2026-09-09',
    })
    expect(serializeStartPayload({
      version: 1,
      type: 'NIMHUNT_START_EXPEDITION',
      wallet: parsed!.wallet,
      mission: 'gem-runner',
      dayKey: parsed!.dayKey,
      challenge: parsed!.challenge,
      blueprintId: parsed!.blueprintId,
      blueprintHash: parsed!.blueprintHash,
    })).toContain('NIMHUNT_START_EXPEDITION')
    expect(fixture.service.snapshot().challenges).toHaveLength(1)
    expect(fixture.service.snapshot()).toMatchObject({ runs: [], sessions: [] })
    expect(fixture.service.getWalletDailyStatus(fixture.wallet).expeditionsStarted).toBe(0)
  })

  it('omits Secure on local-LAN HTTP start cookies while keeping persistent expiry', async () => {
    const fixture = createFixture()
    const security: ExpeditionHttpSecurity = {
      expectedOrigin: 'http://localhost:5173',
      expectedHost: 'localhost:5173',
      expectedProtocol: 'http',
      secureCookie: false,
      allowAuthorizedLocalHttpOrigins: true,
    }
    const challengeResponse = await dispatchExpeditionHttp(fixture.service, {
      method: 'POST',
      path: '/api/expeditions/start-challenge',
      headers: {
        origin: 'http://192.168.1.10:5173',
        host: '192.168.1.10:5173',
        protocol: 'http',
        'content-type': 'application/json',
      },
      host: '192.168.1.10:5173',
      protocol: 'http',
      body: { wallet: fixture.wallet, mission: 'gem-runner' },
    }, security)
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
    const startResponse = await dispatchExpeditionHttp(fixture.service, {
      method: 'POST',
      path: '/api/expeditions/start',
      headers: {
        origin: 'http://192.168.1.10:5173',
        host: '192.168.1.10:5173',
        protocol: 'http',
        'content-type': 'application/json',
      },
      host: '192.168.1.10:5173',
      protocol: 'http',
      body: {
        payload: canonicalPayload,
        publicKey: fixture.keyPair.publicKey.toHex(),
        signature: fixture.keyPair.sign(nimiqSignedMessageHash(canonicalPayload)).toHex(),
      },
    }, security)
    const cookie = startResponse.headers?.['set-cookie'] ?? ''
    const session = fixture.service.snapshot().sessions[0]

    expect(startResponse.status).toBe(200)
    expect(cookie).toContain('Path=/api')
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Strict')
    expect(cookie).toContain(`Expires=${new Date(session!.expiresAt).toUTCString()}`)
    expect(cookie).toContain('Max-Age=')
    expect(cookie).not.toContain('Secure')
  }, 15_000)
})

describe('wallet recovery session HTTP', () => {
  it('issues a recovery challenge without consuming attempts or creating a run', async () => {
    const fixture = createFixture()
    const response = await dispatchExpeditionHttp(fixture.service, {
      method: 'POST',
      path: '/api/wallet/recover-challenge',
      headers: headers(),
      body: { wallet: fixture.wallet },
    }, SECURITY)

    expect(response.status).toBe(200)
    expect(response.headers?.['set-cookie']).toBeUndefined()
    expect(response.body).toMatchObject({
      ok: true,
      wallet: fixture.wallet,
      purpose: 'reward/daily-state recovery',
    })
    expect(Object.keys(response.body as object).sort()).toEqual(
      ['challenge', 'expiresAt', 'issuedAt', 'ok', 'purpose', 'wallet'],
    )
    expect(fixture.service.snapshot()).toMatchObject({ runs: [], sessions: [] })
    expect(fixture.service.getWalletDailyStatus(fixture.wallet).expeditionsStarted).toBe(0)
  })

  it('establishes a wallet recovery cookie from a valid NIMHUNT_RECOVER_SESSION_V1 signature', async () => {
    const fixture = createFixture()
    const challengeResponse = await dispatchExpeditionHttp(fixture.service, {
      method: 'POST',
      path: '/api/wallet/recover-challenge',
      headers: headers(),
      body: { wallet: fixture.wallet },
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
        publicKey: fixture.keyPair.publicKey.toHex(),
        signature: fixture.keyPair.sign(nimiqSignedMessageHash(canonicalPayload)).toHex(),
      },
    }, SECURITY)

    expect(recovered.status).toBe(200)
    expect(recovered.body).toEqual({ ok: true })
    expect(recovered.body).not.toHaveProperty('sessionCapability')
    const cookie = recovered.headers?.['set-cookie'] ?? ''
    expect(cookie).toContain('nimhunt_wallet_session=')
    expect(cookie).toContain('Path=/api')
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Strict')
    expect(describeSessionCookie(cookie)).toEqual({
      header: 'yes',
      name: 'nimhunt_wallet_session',
      secure: 'yes',
      sameSite: 'Strict',
      path: '/api',
      maxAgePresent: 'yes',
    })
    expect(parseRunSessionCookie(cookie)).toBeNull()
    expect(parseWalletRecoverySessionCookie(cookie)).toBeTruthy()
    expect(fixture.service.snapshot()).toMatchObject({ runs: [], sessions: [] })
    expect(fixture.service.getWalletDailyStatus(fixture.wallet).expeditionsStarted).toBe(0)
  })

  it('rejects a wrong-wallet signature, expired challenge, and replay', async () => {
    const fixture = createFixture()
    const other = KeyPair.generate()
    const challengeResponse = await dispatchExpeditionHttp(fixture.service, {
      method: 'POST',
      path: '/api/wallet/recover-challenge',
      headers: headers(),
      body: { wallet: fixture.wallet },
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

    const wrongWallet = await dispatchExpeditionHttp(fixture.service, {
      method: 'POST',
      path: '/api/wallet/recover-session',
      headers: headers(),
      body: {
        payload: canonicalPayload,
        publicKey: other.publicKey.toHex(),
        signature: other.sign(nimiqSignedMessageHash(canonicalPayload)).toHex(),
      },
    }, SECURITY)
    expect(wrongWallet.status).toBe(400)
    expect(wrongWallet.body).toEqual({ ok: false, error: 'ADDRESS_MISMATCH' })
    expect(fixture.service.getWalletDailyStatus(fixture.wallet).expeditionsStarted).toBe(0)

    fixture.setNow('2026-09-09T12:10:00.000Z')
    const expired = await dispatchExpeditionHttp(fixture.service, {
      method: 'POST',
      path: '/api/wallet/recover-session',
      headers: headers(),
      body: {
        payload: canonicalPayload,
        publicKey: fixture.keyPair.publicKey.toHex(),
        signature: fixture.keyPair.sign(nimiqSignedMessageHash(canonicalPayload)).toHex(),
      },
    }, SECURITY)
    expect(expired.status).toBe(409)
    expect(expired.body).toEqual({ ok: false, error: 'RECOVERY_CHALLENGE_EXPIRED' })

    fixture.setNow('2026-09-09T12:01:00.000Z')
    const first = await dispatchExpeditionHttp(fixture.service, {
      method: 'POST',
      path: '/api/wallet/recover-session',
      headers: headers(),
      body: {
        payload: canonicalPayload,
        publicKey: fixture.keyPair.publicKey.toHex(),
        signature: fixture.keyPair.sign(nimiqSignedMessageHash(canonicalPayload)).toHex(),
      },
    }, SECURITY)
    const replay = await dispatchExpeditionHttp(fixture.service, {
      method: 'POST',
      path: '/api/wallet/recover-session',
      headers: headers(),
      body: {
        payload: canonicalPayload,
        publicKey: fixture.keyPair.publicKey.toHex(),
        signature: fixture.keyPair.sign(nimiqSignedMessageHash(canonicalPayload)).toHex(),
      },
    }, SECURITY)
    expect(first.status).toBe(200)
    expect(replay.status).toBe(400)
    expect(replay.body).toEqual({ ok: false, error: 'RECOVERY_CHALLENGE_INVALID' })
    expect(fixture.service.snapshot().runs).toEqual([])
  })

  it('does not let a recovery session start an expedition without NIMHUNT_START_EXPEDITION', async () => {
    const fixture = createFixture()
    const challengeResponse = await dispatchExpeditionHttp(fixture.service, {
      method: 'POST',
      path: '/api/wallet/recover-challenge',
      headers: headers(),
      body: { wallet: fixture.wallet },
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
        publicKey: fixture.keyPair.publicKey.toHex(),
        signature: fixture.keyPair.sign(nimiqSignedMessageHash(canonicalPayload)).toHex(),
      },
    }, SECURITY)
    const cookie = recovered.headers?.['set-cookie'] ?? ''

    const active = await dispatchExpeditionHttp(fixture.service, {
      method: 'GET',
      path: '/api/expeditions/active?runId=missing',
      headers: headers({ origin: undefined, cookie }),
    }, SECURITY)
    expect(active.status).toBe(401)
    expect(active.body).toEqual({ ok: false, error: 'RUN_SESSION_INVALID' })
    expect(fixture.service.getWalletDailyStatus(fixture.wallet).expeditionsStarted).toBe(0)
    expect(fixture.service.snapshot().runs).toEqual([])
  })

  it('accepts LAN recovery verify and omits Secure only for explicit HTTP dev', async () => {
    const fixture = createFixture()
    const recovered = await recoverWalletSession(fixture, LOCAL_SECURITY, LAN)
    const cookie = recovered.headers?.['set-cookie'] ?? ''

    expect(recovered.status).toBe(200)
    expect(recovered.body).toEqual({ ok: true })
    expect(describeSessionCookie(cookie)).toEqual({
      header: 'yes',
      name: 'nimhunt_wallet_session',
      secure: 'no',
      sameSite: 'Strict',
      path: '/api',
      maxAgePresent: 'yes',
    })
    expect(cookie).toContain('HttpOnly')
    expect(cookie).not.toMatch(/Domain=/i)
    expect(parseWalletRecoverySessionCookie(cookie)).toBeTruthy()
    expect(parseRunSessionCookie(cookie)).toBeNull()
  })

  it('rejects arbitrary LAN or host spoofing on recovery verify', async () => {
    const fixture = createFixture()
    const body = { payload: 'x', publicKey: 'y', signature: 'z' }
    const spoofedPublic = await dispatchExpeditionHttp(fixture.service, {
      method: 'POST',
      path: '/api/wallet/recover-session',
      headers: {
        origin: 'http://203.0.113.10:5173',
        host: '203.0.113.10:5173',
        protocol: 'http',
        'content-type': 'application/json',
      },
      host: '203.0.113.10:5173',
      protocol: 'http',
      body,
    }, LOCAL_SECURITY)
    const spoofedPort = await dispatchExpeditionHttp(fixture.service, {
      method: 'POST',
      path: '/api/wallet/recover-session',
      headers: {
        origin: 'http://192.168.0.134:9999',
        host: '192.168.0.134:9999',
        protocol: 'http',
        'content-type': 'application/json',
      },
      host: '192.168.0.134:9999',
      protocol: 'http',
      body,
    }, LOCAL_SECURITY)
    const spoofedOrigin = await dispatchExpeditionHttp(fixture.service, {
      method: 'POST',
      path: '/api/wallet/recover-session',
      headers: {
        origin: 'http://evil.example',
        host: LAN.host,
        protocol: 'http',
        'content-type': 'application/json',
      },
      host: LAN.host,
      protocol: 'http',
      body,
    }, LOCAL_SECURITY)
    const productionLan = await dispatchExpeditionHttp(fixture.service, {
      method: 'POST',
      path: '/api/wallet/recover-session',
      headers: {
        origin: LAN.origin,
        host: LAN.host,
        protocol: 'http',
        'content-type': 'application/json',
      },
      host: LAN.host,
      protocol: 'http',
      body,
    }, SECURITY)

    expect(spoofedPublic).toMatchObject({ status: 400, body: { ok: false, error: 'MALFORMED_REQUEST' } })
    expect(spoofedPort).toMatchObject({ status: 400, body: { ok: false, error: 'MALFORMED_REQUEST' } })
    expect(spoofedOrigin).toMatchObject({ status: 400, body: { ok: false, error: 'MALFORMED_REQUEST' } })
    expect(productionLan).toMatchObject({ status: 400, body: { ok: false, error: 'MALFORMED_REQUEST' } })
    expect(spoofedPublic.headers?.['set-cookie']).toBeUndefined()
    expect(spoofedPort.headers?.['set-cookie']).toBeUndefined()
    expect(spoofedOrigin.headers?.['set-cookie']).toBeUndefined()
    expect(productionLan.headers?.['set-cookie']).toBeUndefined()
  })
})

async function recoverWalletSession(
  fixture: ReturnType<typeof createFixture>,
  security: ExpeditionHttpSecurity,
  requestHost: { origin: string; host: string; protocol: 'http' | 'https' },
) {
  const requestHeaders = {
    origin: requestHost.origin,
    host: requestHost.host,
    protocol: requestHost.protocol,
    'content-type': 'application/json',
  }
  const challengeResponse = await dispatchExpeditionHttp(fixture.service, {
    method: 'POST',
    path: '/api/wallet/recover-challenge',
    headers: requestHeaders,
    host: requestHost.host,
    protocol: requestHost.protocol,
    body: { wallet: fixture.wallet },
  }, security)
  expect(challengeResponse.status).toBe(200)
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
  return dispatchExpeditionHttp(fixture.service, {
    method: 'POST',
    path: '/api/wallet/recover-session',
    headers: requestHeaders,
    host: requestHost.host,
    protocol: requestHost.protocol,
    body: {
      payload: canonicalPayload,
      publicKey: fixture.keyPair.publicKey.toHex(),
      signature: fixture.keyPair.sign(nimiqSignedMessageHash(canonicalPayload)).toHex(),
    },
  }, security)
}
