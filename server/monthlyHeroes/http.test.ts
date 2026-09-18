// HTTP boundary tests: wallet privacy, masking, auth, empty boards,
// query rejection, and scheduler/payout-stack independence.
import { KeyPair } from '@nimiq/core'
import { describe, expect, it } from 'vitest'
import { MONTHLY_HEROES_PATH, WALLET_MONTHLY_STATS_PATH, parseMonthlyHeroesResponse, parseWalletMonthlyStatsResponse } from '../../src/domain/monthlyHeroes.js'
import { hashBlueprint } from '../../src/game/replay/canonical.ts'
import { createRoom01Blueprint } from '../../src/game/world/room01.ts'
import { createMemoryProofService } from '../expeditions/memoryProofStore.ts'
import { serializeStartPayload } from '../expeditions/canonical.ts'
import { nimiqSignedMessageHash } from '../expeditions/crypto.ts'
import { serializeRunSessionCookie } from '../expeditions/session.js'
import type { ExpeditionHttpSecurity } from '../expeditions/http.js'
import { dispatchMonthlyHeroesHttp, dispatchWalletMonthlyStatsHttp } from './http.js'
import { createMemoryMonthlyHeroesSource } from './store.js'
import type { MonthlyRunFacts } from './service.js'

const SECURITY: ExpeditionHttpSecurity = {
  expectedOrigin: 'https://hunt.example',
  expectedHost: 'hunt.example',
  expectedProtocol: 'https',
  secureCookie: true,
}

const NOW = new Date('2026-09-18T12:00:00.000Z')

function completedRun(runId: string, wallet: string, dayKey = '2026-09-10'): MonthlyRunFacts {
  return {
    runId,
    wallet,
    mission: 'gem-runner',
    dayKey,
    startedAt: `${dayKey}T10:00:00.000Z`,
    endedAt: `${dayKey}T10:05:00.000Z`,
    gameplayStartedAt: `${dayKey}T10:00:00.000Z`,
    verified: { outcome: 'VERIFIED_ELIGIBLE', gemsCollected: 6, chestsOpened: 1, objectiveReached: false, missionSatisfied: true, finalHp: 3 },
    vaultSealed: false,
  }
}

describe('monthly heroes public endpoint', () => {
  it('serves the current month with masked leaders and no internal data', async () => {
    const wallet = 'NQ32 AAAA BBBB CCCC DDDD EEEE FFFF GGGG HHHH'
    const source = createMemoryMonthlyHeroesSource()
    source.seedRun(completedRun('r1', wallet))

    const response = await dispatchMonthlyHeroesHttp(source, {
      method: 'GET',
      path: MONTHLY_HEROES_PATH,
      headers: { origin: SECURITY.expectedOrigin, host: SECURITY.expectedHost, protocol: SECURITY.expectedProtocol },
      host: SECURITY.expectedHost,
      protocol: SECURITY.expectedProtocol,
    }, SECURITY, NOW)

    expect(response.status).toBe(200)
    const parsed = parseMonthlyHeroesResponse(response.body)
    expect(parsed).not.toBeNull()
    expect(parsed?.monthKey).toBe('2026-09')
    expect(parsed?.categories).toHaveLength(6)
    const relic = parsed?.categories.find(category => category.heroId === 'relic-keeper')
    expect(relic?.leaders).toHaveLength(1)
    expect(relic?.leaders[0]).toMatchObject({ rank: 1, value: 185 })
    expect(relic?.leaders[0]?.maskedWallet).not.toContain('AAAA')
    const text = JSON.stringify(response.body)
    expect(text).not.toContain(wallet)
    expect(text).not.toMatch(/installId|runId|claimId|luna|treasury|risk|seal|snapshot|checkpoint/i)
  })

  it('returns empty leaders when nobody qualifies', async () => {
    const source = createMemoryMonthlyHeroesSource()
    const response = await dispatchMonthlyHeroesHttp(source, {
      method: 'GET',
      path: MONTHLY_HEROES_PATH,
      headers: { origin: SECURITY.expectedOrigin, host: SECURITY.expectedHost, protocol: SECURITY.expectedProtocol },
      host: SECURITY.expectedHost,
      protocol: SECURITY.expectedProtocol,
    }, SECURITY, NOW)
    expect(response.status).toBe(200)
    const parsed = parseMonthlyHeroesResponse(response.body)
    expect(parsed?.monthKey).toBe('2026-09')
    for (const category of parsed?.categories ?? []) expect(category.leaders).toEqual([])
  })

  it('rejects query overrides, wrong methods, and foreign origins', async () => {
    const source = createMemoryMonthlyHeroesSource()
    const headers = { origin: SECURITY.expectedOrigin, host: SECURITY.expectedHost, protocol: SECURITY.expectedProtocol }
    const override = await dispatchMonthlyHeroesHttp(source, {
      method: 'GET', path: `${MONTHLY_HEROES_PATH}?month=2026-01`, headers, host: SECURITY.expectedHost, protocol: SECURITY.expectedProtocol,
    }, SECURITY, NOW)
    expect(override.status).toBe(400)

    const walletParam = await dispatchMonthlyHeroesHttp(source, {
      method: 'GET', path: `${MONTHLY_HEROES_PATH}?wallet=NQ00OTHER`, headers, host: SECURITY.expectedHost, protocol: SECURITY.expectedProtocol,
    }, SECURITY, NOW)
    expect(walletParam.status).toBe(400)

    const post = await dispatchMonthlyHeroesHttp(source, {
      method: 'POST', path: MONTHLY_HEROES_PATH, headers, host: SECURITY.expectedHost, protocol: SECURITY.expectedProtocol, rawBody: '{}',
    }, SECURITY, NOW)
    expect(post.status).toBe(405)

    const evil = await dispatchMonthlyHeroesHttp(source, {
      method: 'GET', path: MONTHLY_HEROES_PATH,
      headers: { origin: 'https://evil.example', host: SECURITY.expectedHost, protocol: SECURITY.expectedProtocol },
      host: SECURITY.expectedHost, protocol: SECURITY.expectedProtocol,
    }, SECURITY, NOW)
    expect(evil.status).toBe(400)
  })

  it('is unavailable without a source, never leaking data', async () => {
    const response = await dispatchMonthlyHeroesHttp(null, {
      method: 'GET',
      path: MONTHLY_HEROES_PATH,
      headers: { origin: SECURITY.expectedOrigin, host: SECURITY.expectedHost, protocol: SECURITY.expectedProtocol },
      host: SECURITY.expectedHost,
      protocol: SECURITY.expectedProtocol,
    }, SECURITY, NOW)
    expect(response.status).toBe(503)
    expect(response.body).toEqual({ ok: false, error: 'HEROES_UNAVAILABLE' })
  })
})

describe('wallet monthly stats endpoint', () => {
  it('requires session auth and returns only the caller wallet', async () => {
    const walletA = await connectedWallet()
    const walletB = await connectedWallet()
    const source = createMemoryMonthlyHeroesSource()
    source.seedRun(completedRun('ra', walletA.wallet))
    source.seedRun(completedRun('rb', walletB.wallet, '2026-09-11'))

    const anon = await dispatchWalletMonthlyStatsHttp(walletA.service, source, {
      method: 'GET',
      path: WALLET_MONTHLY_STATS_PATH,
      headers: { origin: SECURITY.expectedOrigin, host: SECURITY.expectedHost, protocol: SECURITY.expectedProtocol },
    }, SECURITY, NOW)
    expect(anon.status).toBe(401)

    const own = await dispatchWalletMonthlyStatsHttp(walletA.service, source, {
      method: 'GET', path: WALLET_MONTHLY_STATS_PATH, headers: headers(walletA.cookie),
    }, SECURITY, NOW)
    expect(own.status).toBe(200)
    const parsed = parseWalletMonthlyStatsResponse(own.body)
    expect(parsed).not.toBeNull()
    expect(parsed?.monthKey).toBe('2026-09')
    expect(parsed?.stats.expeditionsStarted).toBe(1)
    expect(parsed?.stats.expeditionsCompleted).toBe(1)
    expect(parsed?.stats.points).toBe(185)
    expect(parsed?.ranks['relic-keeper']).toBe(1)
    // Wallet A cannot read wallet B: the response carries no other wallet.
    expect(JSON.stringify(own.body)).not.toContain(walletB.wallet)
  })

  it('rejects wallet query parameters', async () => {
    const wallet = await connectedWallet()
    const source = createMemoryMonthlyHeroesSource()
    const response = await dispatchWalletMonthlyStatsHttp(wallet.service, source, {
      method: 'GET', path: `${WALLET_MONTHLY_STATS_PATH}?wallet=${encodeURIComponent(wallet.wallet)}`, headers: headers(wallet.cookie),
    }, SECURITY, NOW)
    expect(response.status).toBe(400)
    expect(response.body).toEqual({ ok: false, error: 'MALFORMED_REQUEST' })
  })

  it('returns zero stats with null ranks for a quiet wallet', async () => {
    const wallet = await connectedWallet()
    const source = createMemoryMonthlyHeroesSource()
    const response = await dispatchWalletMonthlyStatsHttp(wallet.service, source, {
      method: 'GET', path: WALLET_MONTHLY_STATS_PATH, headers: headers(wallet.cookie),
    }, SECURITY, NOW)
    expect(response.status).toBe(200)
    const parsed = parseWalletMonthlyStatsResponse(response.body)
    expect(parsed?.stats.expeditionsStarted).toBe(0)
    expect(parsed?.stats.nimDelivered).toBe(0)
    for (const rank of Object.values(parsed?.ranks ?? {})) expect(rank).toBeNull()
  })

  it('counts retired months by rewardDay: September board ignores August rewards', async () => {
    const wallet = await connectedWallet()
    const source = createMemoryMonthlyHeroesSource()
    source.seedClaim({ claimId: 'aug', runId: 'r-aug', wallet: wallet.wallet, dayKey: '2026-08-31', status: 'RESERVED' })
    source.seedPayout({ claimId: 'aug', wallet: wallet.wallet, amountLuna: '10000000', status: 'CONFIRMED' })
    const response = await dispatchWalletMonthlyStatsHttp(wallet.service, source, {
      method: 'GET', path: WALLET_MONTHLY_STATS_PATH, headers: headers(wallet.cookie),
    }, SECURITY, NOW)
    const parsed = parseWalletMonthlyStatsResponse(response.body)
    expect(parsed?.stats.nimDelivered).toBe(0)
    expect(parsed?.stats.rewardsSecured).toBe(0)
  })
})

function headers(cookie: string) {
  return {
    origin: SECURITY.expectedOrigin,
    host: SECURITY.expectedHost,
    protocol: SECURITY.expectedProtocol,
    cookie,
  }
}

async function connectedWallet() {
  const keyPair = KeyPair.generate()
  const wallet = keyPair.toAddress().toUserFriendlyAddress()
  const now = new Date('2026-09-09T12:00:00.000Z')
  const blueprint = createRoom01Blueprint('2026-09-09', 'gem-runner', 'heroes-gem')
  const service = createMemoryProofService({
    clock: { now: () => now },
    blueprints: [{ ...blueprint, status: 'PUBLISHED' as const, blueprintHash: hashBlueprint(blueprint) }],
  })
  const challenge = await service.issueStartChallenge(wallet, 'gem-runner')
  const startPayload = serializeStartPayload({
    version: 1,
    type: 'NIMHUNT_START_EXPEDITION',
    wallet,
    mission: 'gem-runner',
    dayKey: challenge.dayKey,
    challenge: challenge.challenge,
    blueprintId: challenge.blueprintId,
    blueprintHash: challenge.blueprintHash,
  })
  const authorized = await service.authorizeStart({
    payload: startPayload,
    publicKey: keyPair.publicKey.toHex(),
    signature: keyPair.sign(nimiqSignedMessageHash(startPayload)).toHex(),
  })
  const cookie = serializeRunSessionCookie(
    authorized.sessionCapability,
    new Date(authorized.session.expiresAt),
    new Date(authorized.session.createdAt),
    true,
  )
  return { service, wallet, keyPair, cookie }
}
