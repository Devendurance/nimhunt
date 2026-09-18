import { KeyPair } from '@nimiq/core'
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { hashBlueprint } from '../../src/game/replay/canonical.ts'
import { createRoom01Blueprint } from '../../src/game/world/room01.ts'
import { serializeStartPayload, type StartExpeditionPayload } from '../expeditions/canonical.ts'
import { serializeWalletRecoveryPayload } from '../expeditions/walletRecovery.ts'
import { nimiqSignedMessageHash } from '../expeditions/crypto.ts'
import { dispatchExpeditionHttp, type ExpeditionHttpSecurity } from '../expeditions/http.ts'
import { createMemoryProofService } from '../expeditions/memoryProofStore.ts'
import { parseRunSessionCookie, parseWalletRecoverySessionCookie } from '../expeditions/session.ts'
import {
  ACTIVE_EXPEDITION_PATH,
  RECOVER_RUN_SESSION_PATH,
} from '../../src/domain/expeditionProof.ts'
import { TREASURE_BANK_PATH } from '../../src/domain/treasureBank.ts'
import { WALLET_MONTHLY_STATS_PATH } from '../../src/domain/monthlyHeroes.ts'
import {
  dispatchProductHttp,
  isOwnedProductPath,
  PRODUCT_OWNED_PATHS,
  PRODUCT_REWRITE_PARAM,
  resolveRewriteDispatchPath,
} from './productAdapter.ts'
import { dispatchTreasureBankHttp } from '../treasureBank/http.ts'
import { createMemoryTreasureBankSource } from '../treasureBank/store.ts'
import { dispatchWalletMonthlyStatsHttp } from '../monthlyHeroes/http.ts'
import { createMemoryMonthlyHeroesSource } from '../monthlyHeroes/store.ts'

const root = process.cwd()
const read = (rel: string) => readFileSync(join(root, rel), 'utf8')

type Rewrite = { source: string; destination: string }

function loadRewrites(): Rewrite[] {
  return (JSON.parse(read('vercel.json')) as { rewrites?: Rewrite[] }).rewrites ?? []
}

/**
 * Faithful Vercel rewrite simulator for the CURRENT vercel.json.
 * Exact sources only (no wildcards remain): pathname must equal the source,
 * destination carries `__nimhunt_route`, and the incoming query string is
 * merged — the only query keys the function can ever see.
 */
function simulateVercelRewrite(publicPath: string): string | null {
  const url = new URL(publicPath, 'http://localhost')
  const pathname = url.pathname
  const incomingQuery = url.searchParams.toString()
  for (const entry of loadRewrites()) {
    const { source, destination } = entry
    if (!source.startsWith('/api')) continue
    if (pathname !== source) continue
    if (incomingQuery.length === 0) return destination
    const sep = destination.includes('?') ? '&' : '?'
    return `${destination}${sep}${incomingQuery}`
  }
  return null
}

function dispatchPathFor(publicPath: string): string {
  const internal = simulateVercelRewrite(publicPath)
  expect(internal, `rewrite for ${publicPath}`).not.toBeNull()
  return resolveRewriteDispatchPath(internal as string)
}

function queryKeys(dispatchPath: string): string[] {
  const url = new URL(dispatchPath, 'http://localhost')
  return [...url.searchParams.keys()]
}

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
  const current = new Date('2026-09-09T12:00:00.000Z')
  const source = createRoom01Blueprint('2026-09-09', 'gem-runner', 'wildcard-regression-blueprint')
  const blueprint = { ...source, status: 'PUBLISHED' as const, blueprintHash: hashBlueprint(source) }
  const service = createMemoryProofService({ clock: { now: () => current }, blueprints: [blueprint] })
  const keyPair = KeyPair.generate()
  const wallet = keyPair.toAddress().toUserFriendlyAddress()
  return { service, keyPair, wallet }
}

async function startExpedition(fixture: ReturnType<typeof createFixture>) {
  const challengeResponse = await dispatchExpeditionHttp(fixture.service, {
    method: 'POST',
    path: '/api/expeditions/start-challenge',
    headers: headers(),
    body: { wallet: fixture.wallet, mission: 'gem-runner' },
  }, SECURITY)
  expect(challengeResponse.status).toBe(200)
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
  expect(startResponse.status).toBe(200)
  return {
    runId: (startResponse.body as { runId: string }).runId,
    cookie: startResponse.headers?.['set-cookie'] ?? '',
  }
}

async function establishWalletRecovery(fixture: ReturnType<typeof createFixture>) {
  const challengeResponse = await dispatchExpeditionHttp(fixture.service, {
    method: 'POST',
    path: '/api/wallet/recover-challenge',
    headers: headers(),
    body: { wallet: fixture.wallet },
  }, SECURITY)
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
  return recovered.headers?.['set-cookie'] ?? ''
}

describe('wildcard capture regression: former failure mechanism', () => {
  it('clean active handoff returns 200 (control)', async () => {
    const fixture = createFixture()
    const { runId, cookie } = await startExpedition(fixture)
    const active = await dispatchExpeditionHttp(fixture.service, {
      method: 'GET',
      path: `${ACTIVE_EXPEDITION_PATH}?runId=${runId}`,
      headers: headers({ origin: undefined, cookie }),
    }, SECURITY)
    expect(active.status).toBe(200)
    expect(active.body).toMatchObject({ ok: true, runId })
  })

  it('a surviving capture key (`path=active`) breaks ACTIVE with 400 even holding a valid cookie', async () => {
    const fixture = createFixture()
    const { runId, cookie } = await startExpedition(fixture)
    // Shape the old wildcard rewrites could produce: capture variable merged
    // alongside the route and the legitimate query.
    const leaked = resolveRewriteDispatchPath(
      `/api/product?${PRODUCT_REWRITE_PARAM}=/api/expeditions/active&path=active&runId=${runId}`,
    )
    expect(leaked).toBe(`${ACTIVE_EXPEDITION_PATH}?path=active&runId=${runId}`)
    const active = await dispatchExpeditionHttp(fixture.service, {
      method: 'GET',
      path: leaked,
      headers: headers({ origin: undefined, cookie }),
    }, SECURITY)
    // Production signature: 400 START_CHALLENGE_INVALID (strict 1-key validator
    // fires before auth), never reaching the valid session.
    expect(active.status).toBe(400)
    expect(active.body).toEqual({ ok: false, error: 'START_CHALLENGE_INVALID' })
  })

  it('a surviving capture key breaks Treasure Bank and Monthly Stats with 400', async () => {
    const fixture = createFixture()
    const { cookie } = await startExpedition(fixture)
    const treasureSource = createMemoryTreasureBankSource()
    const monthlySource = createMemoryMonthlyHeroesSource()
    const base = {
      method: 'GET',
      host: SECURITY.expectedHost,
      protocol: SECURITY.expectedProtocol,
    } as const

    const treasureLeak = resolveRewriteDispatchPath(
      `/api/product?${PRODUCT_REWRITE_PARAM}=/api/wallet/treasure-bank&path=treasure-bank`,
    )
    const treasure = await dispatchTreasureBankHttp(fixture.service, treasureSource, {
      ...base,
      path: treasureLeak,
      headers: headers({ origin: undefined, cookie }),
    }, SECURITY)
    expect(treasure.status).toBe(400)
    expect(treasure.body).toEqual({ ok: false, error: 'MALFORMED_REQUEST' })

    const monthlyLeak = resolveRewriteDispatchPath(
      `/api/product?${PRODUCT_REWRITE_PARAM}=/api/wallet/monthly-stats&path=monthly-stats`,
    )
    const monthly = await dispatchWalletMonthlyStatsHttp(fixture.service, monthlySource, {
      ...base,
      path: monthlyLeak,
      headers: headers({ origin: undefined, cookie }),
    }, SECURITY)
    expect(monthly.status).toBe(400)
    expect(monthly.body).toEqual({ ok: false, error: 'MALFORMED_REQUEST' })
  })
})

describe('explicit rewrites emit zero capture keys', () => {
  it('vercel.json has no wildcard/capture variables on any /api route', () => {
    for (const entry of loadRewrites()) {
      if (!entry.source.startsWith('/api')) continue
      expect(entry.source).not.toContain(':')
      expect(entry.source).not.toContain('*')
      expect(entry.destination).not.toContain(':')
      expect(entry.destination).not.toContain('*')
    }
  })

  it('every owned product path has an exact rewrite to the stable function', () => {
    const rewrites = loadRewrites()
    for (const owned of PRODUCT_OWNED_PATHS) {
      const entry = rewrites.find(rewrite => rewrite.source === owned)
      expect(entry, `explicit rewrite for ${owned}`).toBeDefined()
      expect(entry?.destination).toBe(`/api/product?${PRODUCT_REWRITE_PARAM}=${owned}`)
    }
    expect(isOwnedProductPath('/api/internal/payout-cycle')).toBe(false)
  })

  it('ACTIVE receives exactly one runId and nothing else', () => {
    const dispatchPath = dispatchPathFor('/api/expeditions/active?runId=abc123')
    expect(dispatchPath).toBe('/api/expeditions/active?runId=abc123')
    expect(queryKeys(dispatchPath)).toEqual(['runId'])
  })

  it('Treasure Bank and Monthly Stats receive zero query keys', () => {
    for (const publicPath of [TREASURE_BANK_PATH, WALLET_MONTHLY_STATS_PATH]) {
      const dispatchPath = dispatchPathFor(publicPath)
      expect(dispatchPath).toBe(publicPath)
      expect(queryKeys(dispatchPath)).toEqual([])
    }
  })

  it('payout claimId survives exactly, with and without the optional key', () => {
    expect(dispatchPathFor('/api/rewards/claim/payout?claimId=test'))
      .toBe('/api/rewards/claim/payout?claimId=test')
    expect(queryKeys(dispatchPathFor('/api/rewards/claim/payout?claimId=test'))).toEqual(['claimId'])
    expect(dispatchPathFor('/api/rewards/claim/payout')).toBe('/api/rewards/claim/payout')
    expect(queryKeys(dispatchPathFor('/api/rewards/claim/payout'))).toEqual([])
  })

  it('no simulated rewrite output contains route-capture-like keys', () => {
    const suspects = ['path', 'slug', 'wildcard', 'capture', 'rest']
    const samples = [
      '/api/expeditions/active?runId=abc',
      '/api/expeditions/result?runId=abc',
      '/api/expeditions/session/recover',
      '/api/rewards/claim/payout?claimId=test',
      '/api/wallet/treasure-bank',
      '/api/wallet/monthly-stats',
      '/api/monthly-heroes',
      '/api/expeditions/checkpoint',
    ]
    for (const sample of samples) {
      const keys = queryKeys(dispatchPathFor(sample))
      for (const suspect of suspects) {
        expect(keys, `${sample} must not contain ${suspect}`).not.toContain(suspect)
      }
    }
  })
})

describe('session recovery preserved through rewritten dispatch paths', () => {
  it('missing active run cookie via rewritten path is 401 RUN_SESSION_INVALID (preflight gate)', async () => {
    const fixture = createFixture()
    const { runId } = await startExpedition(fixture)
    const dispatchPath = dispatchPathFor(`/api/expeditions/active?runId=${runId}`)
    const active = await dispatchExpeditionHttp(fixture.service, {
      method: 'GET',
      path: dispatchPath,
      headers: headers({ origin: undefined }),
    }, SECURITY)
    expect(active.status).toBe(401)
    expect(active.body).toEqual({ ok: false, error: 'RUN_SESSION_INVALID' })
  })

  it('missing treasure session via rewritten path is 401 RUN_SESSION_INVALID (preflight gate)', async () => {
    const fixture = createFixture()
    await startExpedition(fixture)
    const dispatchPath = dispatchPathFor(TREASURE_BANK_PATH)
    const treasure = await dispatchTreasureBankHttp(
      fixture.service,
      createMemoryTreasureBankSource(),
      {
        method: 'GET',
        path: dispatchPath,
        headers: headers({ origin: undefined }),
        host: SECURITY.expectedHost,
        protocol: SECURITY.expectedProtocol,
      },
      SECURITY,
    )
    expect(treasure.status).toBe(401)
    expect(treasure.body).toEqual({ ok: false, error: 'RUN_SESSION_INVALID' })
  })

  it('wallet recovery then run-session recovery resumes the same run through rewritten paths', async () => {
    const fixture = createFixture()
    const { runId } = await startExpedition(fixture)
    const attemptsBefore = fixture.service.getWalletDailyStatus(fixture.wallet)
    expect(attemptsBefore).toMatchObject({ expeditionsStarted: 1, expeditionsRemaining: 2 })

    const walletCookie = await establishWalletRecovery(fixture)
    expect(parseWalletRecoverySessionCookie(walletCookie)).toBeTruthy()

    const recoverPath = dispatchPathFor(RECOVER_RUN_SESSION_PATH)
    expect(queryKeys(recoverPath)).toEqual([])
    const recovered = await dispatchExpeditionHttp(fixture.service, {
      method: 'POST',
      path: recoverPath,
      headers: headers({ cookie: walletCookie }),
      body: { runId },
    }, SECURITY)
    expect(recovered.status).toBe(200)
    expect(recovered.body).toEqual({ ok: true, runId })
    expect(recovered.body).not.toHaveProperty('sessionCapability')
    const runCookie = recovered.headers?.['set-cookie'] ?? ''
    expect(parseRunSessionCookie(runCookie)).toBeTruthy()

    const activePath = dispatchPathFor(
      `${ACTIVE_EXPEDITION_PATH}?runId=${runId}`,
    )
    const active = await dispatchExpeditionHttp(fixture.service, {
      method: 'GET',
      path: activePath,
      headers: headers({ origin: undefined, cookie: runCookie }),
    }, SECURITY)
    expect(active.status).toBe(200)
    expect(active.body).toMatchObject({ ok: true, runId })

    // No second Start happened: attempts and run count are unchanged.
    expect(fixture.service.getWalletDailyStatus(fixture.wallet)).toMatchObject({
      expeditionsStarted: 1,
      expeditionsRemaining: 2,
    })
    expect(JSON.stringify(recovered.body)).not.toContain(parseRunSessionCookie(runCookie) ?? 'no-capability')
  })
})

describe('fail-closed routing preserved', () => {
  it('unknown routes match no rewrite and the adapter stays JSON 404', async () => {
    expect(simulateVercelRewrite('/api/expeditions/unknown')).toBeNull()
    expect(simulateVercelRewrite('/api/wallet/unknown')).toBeNull()
    expect(simulateVercelRewrite('/api/rewards/unknown')).toBeNull()
    for (const unknown of ['/api/expeditions/unknown', '/api/wallet/unknown', '/api/rewards/unknown']) {
      const response = await dispatchProductHttp({ method: 'GET', path: unknown }, {
        NIMHUNT_PROOF_BACKEND: 'postgres',
        NIMHUNT_APP_ORIGIN: 'https://nimhunt.vercel.app',
      })
      expect(response.status).toBe(404)
      expect(response.body).toEqual({ ok: false, error: 'MALFORMED_REQUEST' })
    }
  })

  it('payout-cycle never enters the product adapter', async () => {
    expect(simulateVercelRewrite('/api/internal/payout-cycle')).toBeNull()
    expect(simulateVercelRewrite('/api/internal/payout-cycle?foo=bar')).toBeNull()
    const response = await dispatchProductHttp({
      method: 'GET',
      path: '/api/internal/payout-cycle',
      headers: { authorization: 'Bearer wrong' },
    }, {
      NIMHUNT_PROOF_BACKEND: 'postgres',
      NIMHUNT_APP_ORIGIN: 'https://nimhunt.vercel.app',
    })
    expect(response.status).toBe(404)
    expect(response.body).toEqual({ ok: false, error: 'MALFORMED_REQUEST' })
  })
})
