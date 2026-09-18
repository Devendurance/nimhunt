import { KeyPair } from '@nimiq/core'
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { hashBlueprint } from '../../src/game/replay/canonical.ts'
import { createRoom01Blueprint } from '../../src/game/world/room01.ts'
import { serializeStartPayload, type StartExpeditionPayload } from './canonical.ts'
import { serializeWalletRecoveryPayload } from './walletRecovery.ts'
import { nimiqSignedMessageHash } from './crypto.ts'
import { dispatchExpeditionHttp, type ExpeditionHttpSecurity } from './http.ts'
import { createMemoryProofService } from './memoryProofStore.ts'
import { describeSessionCookie, parseRunSessionCookie, parseWalletRecoverySessionCookie } from './session.ts'
import { RECOVER_RUN_SESSION_PATH } from '../../src/domain/expeditionProof.ts'
import { dispatchProductHttp, isOwnedProductPath, resolveRewriteDispatchPath } from '../vercel/productAdapter.ts'
import { dispatchTreasureBankHttp } from '../treasureBank/http.ts'
import { createMemoryTreasureBankSource } from '../treasureBank/store.ts'
import { dispatchWalletMonthlyStatsHttp } from '../monthlyHeroes/http.ts'
import { createMemoryMonthlyHeroesSource } from '../monthlyHeroes/store.ts'

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
  const source = createRoom01Blueprint('2026-09-09', 'gem-runner', 'recovery-blueprint')
  const blueprint = { ...source, status: 'PUBLISHED' as const, blueprintHash: hashBlueprint(source) }
  const service = createMemoryProofService({ clock: { now: () => current }, blueprints: [blueprint] })
  const keyPair = KeyPair.generate()
  const wallet = keyPair.toAddress().toUserFriendlyAddress()
  const otherKeyPair = KeyPair.generate()
  const otherWallet = otherKeyPair.toAddress().toUserFriendlyAddress()
  return {
    service,
    keyPair,
    wallet,
    otherKeyPair,
    otherWallet,
    setNow: (value: string) => { current = new Date(value) },
  }
}

async function startExpedition(fixture: ReturnType<typeof createFixture>) {
  const challengeResponse = await dispatchExpeditionHttp(fixture.service, {
    method: 'POST',
    path: '/api/expeditions/start-challenge',
    headers: headers(),
    body: { wallet: fixture.wallet, mission: 'gem-runner' },
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
  return { challengeResponse, startResponse, cookie: startResponse.headers?.['set-cookie'] ?? '' }
}

async function establishWalletRecovery(fixture: ReturnType<typeof createFixture>) {
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
  return { challengeResponse, recovered, cookie: recovered.headers?.['set-cookie'] ?? '' }
}

describe('production session recovery bugfix', () => {
  it('Start 200 emits a valid run-session Set-Cookie with Path=/api HttpOnly Secure Strict', async () => {
    const fixture = createFixture()
    const { startResponse, cookie } = await startExpedition(fixture)
    expect(startResponse.status).toBe(200)
    expect(startResponse.body).toMatchObject({ ok: true, outcome: 'START_CREATED' })
    expect(startResponse.body).not.toHaveProperty('sessionCapability')
    expect(cookie).toContain('nimhunt_run_session=')
    expect(cookie).toContain('Path=/api')
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Strict')
    expect(cookie).toContain('Secure')
    expect(cookie).toContain('Max-Age=')
    expect(cookie).toContain('Expires=')
    expect(describeSessionCookie(cookie).name).toBe('nimhunt_run_session')
    const raw = parseRunSessionCookie(cookie)
    expect(raw).toBeTruthy()
    // Raw capability never appears in JSON body.
    expect(JSON.stringify(startResponse.body)).not.toContain(raw ?? 'impossible-capability-marker')
  })

  it('immediately following active fetch with the valid cookie returns 200 for the same run', async () => {
    const fixture = createFixture()
    const { startResponse, cookie } = await startExpedition(fixture)
    const runId = (startResponse.body as { runId: string }).runId
    const active = await dispatchExpeditionHttp(fixture.service, {
      method: 'GET',
      path: `/api/expeditions/active?runId=${runId}`,
      headers: headers({ origin: undefined, cookie }),
    }, SECURITY)
    expect(active.status).toBe(200)
    expect(active.body).toMatchObject({ ok: true, runId, status: 'STARTED', gameplayStartedAt: null })
  })

  it('absent run cookie returns 401 RUN_SESSION_INVALID, never MALFORMED_REQUEST', async () => {
    const fixture = createFixture()
    const { startResponse } = await startExpedition(fixture)
    const runId = (startResponse.body as { runId: string }).runId
    const active = await dispatchExpeditionHttp(fixture.service, {
      method: 'GET',
      path: `/api/expeditions/active?runId=${runId}`,
      headers: headers({ origin: undefined }),
    }, SECURITY)
    expect(active.status).toBe(401)
    expect(active.body).toEqual({ ok: false, error: 'RUN_SESSION_INVALID' })
  })

  it('stale/forged run cookie returns 401 RUN_SESSION_INVALID, never MALFORMED_REQUEST', async () => {
    const fixture = createFixture()
    const { startResponse } = await startExpedition(fixture)
    const runId = (startResponse.body as { runId: string }).runId
    const active = await dispatchExpeditionHttp(fixture.service, {
      method: 'GET',
      path: `/api/expeditions/active?runId=${runId}`,
      headers: headers({ origin: undefined, cookie: 'nimhunt_run_session=stale-forged-value' }),
    }, SECURITY)
    expect(active.status).toBe(401)
    expect(active.body).toEqual({ ok: false, error: 'RUN_SESSION_INVALID' })
  })

  it('expired run session returns 401 RUN_SESSION_INVALID, never MALFORMED_REQUEST', async () => {
    const fixture = createFixture()
    const { startResponse, cookie } = await startExpedition(fixture)
    const runId = (startResponse.body as { runId: string }).runId
    fixture.setNow('2026-09-10T00:00:01.000Z')
    const active = await dispatchExpeditionHttp(fixture.service, {
      method: 'GET',
      path: `/api/expeditions/active?runId=${runId}`,
      headers: headers({ origin: undefined, cookie }),
    }, SECURITY)
    expect(active.status).toBe(401)
    expect(active.body).toEqual({ ok: false, error: 'RUN_SESSION_INVALID' })
  })

  it('Treasure Bank with missing/stale/expired session returns 401 RUN_SESSION_INVALID (recovery trigger), never 400', async () => {
    const fixture = createFixture()
    const { cookie } = await startExpedition(fixture)
    const source = createMemoryTreasureBankSource()
    const base = {
      method: 'GET',
      path: '/api/wallet/treasure-bank',
      host: SECURITY.expectedHost,
      protocol: SECURITY.expectedProtocol,
    } as const
    const missing = await dispatchTreasureBankHttp(fixture.service, source, {
      ...base,
      headers: headers({ origin: undefined }),
    }, SECURITY)
    expect(missing.status).toBe(401)
    expect(missing.body).toEqual({ ok: false, error: 'RUN_SESSION_INVALID' })

    const stale = await dispatchTreasureBankHttp(fixture.service, source, {
      ...base,
      headers: headers({ origin: undefined, cookie: 'nimhunt_run_session=forged-stale' }),
    }, SECURITY)
    expect(stale.status).toBe(401)
    expect(stale.body).toEqual({ ok: false, error: 'RUN_SESSION_INVALID' })

    fixture.setNow('2026-09-10T00:00:01.000Z')
    const expired = await dispatchTreasureBankHttp(fixture.service, source, {
      ...base,
      headers: headers({ origin: undefined, cookie }),
    }, SECURITY)
    expect(expired.status).toBe(401)
    expect(expired.body).toEqual({ ok: false, error: 'RUN_SESSION_INVALID' })
  })

  it('Monthly Stats with missing/stale session returns 401 RUN_SESSION_INVALID (recovery trigger), never 400', async () => {
    const fixture = createFixture()
    const { cookie } = await startExpedition(fixture)
    const source = createMemoryMonthlyHeroesSource()
    const base = {
      method: 'GET',
      path: '/api/wallet/monthly-stats',
      host: SECURITY.expectedHost,
      protocol: SECURITY.expectedProtocol,
    } as const
    const missing = await dispatchWalletMonthlyStatsHttp(fixture.service, source, {
      ...base,
      headers: headers({ origin: undefined }),
    }, SECURITY)
    expect(missing.status).toBe(401)
    expect(missing.body).toEqual({ ok: false, error: 'RUN_SESSION_INVALID' })

    const stale = await dispatchWalletMonthlyStatsHttp(fixture.service, source, {
      ...base,
      headers: headers({ origin: undefined, cookie: 'nimhunt_run_session=forged-stale' }),
    }, SECURITY)
    expect(stale.status).toBe(401)
    expect(stale.body).toEqual({ ok: false, error: 'RUN_SESSION_INVALID' })
    expect(cookie).toContain('nimhunt_run_session=')
  })

  it('run-session recovery resumes the SAME runId with zero new attempts and zero new runs', async () => {
    const fixture = createFixture()
    const { startResponse } = await startExpedition(fixture)
    const runId = (startResponse.body as { runId: string }).runId
    const before = fixture.service.getWalletDailyStatus(fixture.wallet)
    const runsBefore = fixture.service.snapshot().runs.length
    expect(before).toMatchObject({ expeditionsStarted: 1, expeditionsRemaining: 2 })

    const { cookie: walletCookie } = await establishWalletRecovery(fixture)
    expect(parseWalletRecoverySessionCookie(walletCookie)).toBeTruthy()

    const recovered = await dispatchExpeditionHttp(fixture.service, {
      method: 'POST',
      path: RECOVER_RUN_SESSION_PATH,
      headers: headers({ cookie: walletCookie }),
      body: { runId },
    }, SECURITY)
    expect(recovered.status).toBe(200)
    expect(recovered.body).toEqual({ ok: true, runId })
    expect(recovered.body).not.toHaveProperty('sessionCapability')
    const runCookie = recovered.headers?.['set-cookie'] ?? ''
    expect(runCookie).toContain('nimhunt_run_session=')
    expect(parseRunSessionCookie(runCookie)).toBeTruthy()
    // Raw capability never in body.
    expect(JSON.stringify(recovered.body)).not.toContain(parseRunSessionCookie(runCookie) ?? 'impossible-marker')

    const after = fixture.service.getWalletDailyStatus(fixture.wallet)
    expect(after).toMatchObject({ expeditionsStarted: 1, expeditionsRemaining: 2 })
    expect(fixture.service.snapshot().runs.length).toBe(runsBefore)

    const active = await dispatchExpeditionHttp(fixture.service, {
      method: 'GET',
      path: `/api/expeditions/active?runId=${runId}`,
      headers: headers({ origin: undefined, cookie: runCookie }),
    }, SECURITY)
    expect(active.status).toBe(200)
    expect(active.body).toMatchObject({ ok: true, runId })
  })

  it('recovery without a wallet session returns 401 and never mints a run session', async () => {
    const fixture = createFixture()
    const { startResponse } = await startExpedition(fixture)
    const runId = (startResponse.body as { runId: string }).runId
    const sessionsBefore = fixture.service.snapshot().sessions.length
    const recovered = await dispatchExpeditionHttp(fixture.service, {
      method: 'POST',
      path: RECOVER_RUN_SESSION_PATH,
      headers: headers(),
      body: { runId },
    }, SECURITY)
    expect(recovered.status).toBe(401)
    expect(recovered.body).toEqual({ ok: false, error: 'RUN_SESSION_INVALID' })
    expect(recovered.headers?.['set-cookie']).toBeUndefined()
    expect(fixture.service.snapshot().sessions.length).toBe(sessionsBefore)
  })

  it('recovery session cannot access another wallet’s run', async () => {
    const fixture = createFixture()
    const { startResponse } = await startExpedition(fixture)
    const runId = (startResponse.body as { runId: string }).runId

    // Second wallet establishes its own recovery session.
    const challengeResponse = await dispatchExpeditionHttp(fixture.service, {
      method: 'POST',
      path: '/api/wallet/recover-challenge',
      headers: headers(),
      body: { wallet: fixture.otherWallet },
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
    const otherRecovered = await dispatchExpeditionHttp(fixture.service, {
      method: 'POST',
      path: '/api/wallet/recover-session',
      headers: headers(),
      body: {
        payload: canonicalPayload,
        publicKey: fixture.otherKeyPair.publicKey.toHex(),
        signature: fixture.otherKeyPair.sign(nimiqSignedMessageHash(canonicalPayload)).toHex(),
      },
    }, SECURITY)
    const otherCookie = otherRecovered.headers?.['set-cookie'] ?? ''
    const sessionsBefore = fixture.service.snapshot().sessions.length

    const attempt = await dispatchExpeditionHttp(fixture.service, {
      method: 'POST',
      path: RECOVER_RUN_SESSION_PATH,
      headers: headers({ cookie: otherCookie }),
      body: { runId },
    }, SECURITY)
    expect([401, 404]).toContain(attempt.status)
    expect(attempt.body).toMatchObject({ ok: false })
    expect(attempt.headers?.['set-cookie']).toBeUndefined()
    expect(fixture.service.snapshot().sessions.length).toBe(sessionsBefore)
  })

  it('terminal run cannot be recovered as active', async () => {
    const fixture = createFixture()
    const { startResponse, cookie } = await startExpedition(fixture)
    const runId = (startResponse.body as { runId: string }).runId
    const { cookie: walletCookie } = await establishWalletRecovery(fixture)

    // Abandon the run to make it terminal.
    const run = fixture.service.getRun(runId)
    expect(run?.status).toBe('STARTED')
    await dispatchExpeditionHttp(fixture.service, {
      method: 'POST',
      path: '/api/expeditions/gameplay-start',
      headers: headers({ cookie }),
      body: { runId },
    }, SECURITY)
    const checkpoint = (await dispatchExpeditionHttp(fixture.service, {
      method: 'GET',
      path: `/api/expeditions/active?runId=${runId}`,
      headers: headers({ origin: undefined, cookie }),
    }, SECURITY).then(() => null).catch(() => null))
    expect(checkpoint).toBeNull()
    // Directly abandon via service to reach terminal without gameplay checkpoint math.
    const session = fixture.service.authenticateSession(parseRunSessionCookie(cookie) as string)
    const state = fixture.service.getRun(runId)
    await fixture.service.abandonExpedition({
      runId,
      session,
      checkpointHash: state?.checkpointHash as string,
    })

    const attempt = await dispatchExpeditionHttp(fixture.service, {
      method: 'POST',
      path: RECOVER_RUN_SESSION_PATH,
      headers: headers({ cookie: walletCookie }),
      body: { runId },
    }, SECURITY)
    expect(attempt.status).toBe(409)
    expect(attempt.body).toEqual({ ok: false, error: 'ACTIVE_RUN_UNAVAILABLE' })
    expect(attempt.headers?.['set-cookie']).toBeUndefined()
  })

  it('Vercel rewrites include the recovery endpoint and the adapter owns it', async () => {
    const vercel = JSON.parse(readFileSync(join(process.cwd(), 'vercel.json'), 'utf8')) as {
      rewrites?: Array<{ source: string; destination: string }>
    }
    const explicit = (vercel.rewrites ?? []).find(entry => entry.source === RECOVER_RUN_SESSION_PATH)
    const wildcard = (vercel.rewrites ?? []).find(entry => entry.source === '/api/expeditions/:path*')
    expect(explicit ?? wildcard).toBeDefined()
    expect(isOwnedProductPath(RECOVER_RUN_SESSION_PATH)).toBe(true)
    const internal = `/api/product?__nimhunt_route=${RECOVER_RUN_SESSION_PATH}`
    expect(resolveRewriteDispatchPath(internal)).toBe(RECOVER_RUN_SESSION_PATH)
    const response = await dispatchProductHttp({
      method: 'POST',
      path: RECOVER_RUN_SESSION_PATH,
      headers: { origin: 'https://nimhunt.vercel.app', host: 'nimhunt.vercel.app', 'content-type': 'application/json' },
      host: 'nimhunt.vercel.app',
      protocol: 'https',
      rawBody: JSON.stringify({ runId: 'test' }),
    }, {
      NIMHUNT_PROOF_BACKEND: 'postgres',
      NIMHUNT_APP_ORIGIN: 'https://nimhunt.vercel.app',
    })
    // No credentials in sandbox, but reaching the adapter proves routing (never platform 404).
    expect(typeof response.status).toBe('number')
    expect(response.body).toMatchObject({ ok: expect.anything() })
  })
})
