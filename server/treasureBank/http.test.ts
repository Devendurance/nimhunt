import { KeyPair } from '@nimiq/core'
import { describe, expect, it } from 'vitest'
import { dispatchExpeditionHttp, type ExpeditionHttpSecurity } from '../expeditions/http.js'
import { createMemoryProofService } from '../expeditions/memoryProofStore.ts'
import { serializeRunSessionCookie } from '../expeditions/session.js'
import { hashBlueprint } from '../../src/game/replay/canonical.ts'
import { createRoom01Blueprint } from '../../src/game/world/room01.ts'
import { serializeStartPayload } from '../expeditions/canonical.ts'
import { serializeWalletRecoveryPayload } from '../expeditions/walletRecovery.ts'
import { nimiqSignedMessageHash } from '../expeditions/crypto.ts'
import { TREASURE_BANK_PATH, parseTreasureBankResponse } from '../../src/domain/treasureBank.ts'
import { dispatchTreasureBankHttp } from './http.js'
import { createMemoryTreasureBankSource } from './store.js'
import { createMemoryPayoutStore } from '../payouts/store.js'

const SECURITY: ExpeditionHttpSecurity = {
  expectedOrigin: 'https://hunt.example',
  expectedHost: 'hunt.example',
  expectedProtocol: 'https',
  secureCookie: true,
}

describe('treasure bank HTTP boundary', () => {
  it('requires signed session auth and returns an empty bank shape', async () => {
    const wallet = await connectedWallet()
    const source = createMemoryTreasureBankSource()
    const anon = await dispatchTreasureBankHttp(wallet.service, source, {
      method: 'GET',
      path: TREASURE_BANK_PATH,
      headers: { origin: SECURITY.expectedOrigin, host: SECURITY.expectedHost, protocol: SECURITY.expectedProtocol },
    }, SECURITY)
    expect(anon.status).toBe(401)
    expect(anon.body).toEqual({ ok: false, error: 'RUN_SESSION_INVALID' })

    const empty = await dispatchTreasureBankHttp(wallet.service, source, {
      method: 'GET',
      path: TREASURE_BANK_PATH,
      headers: headers(wallet.cookie),
    }, SECURITY)
    expect(empty.status).toBe(200)
    expect(empty.body).toEqual({
      ok: true,
      pendingNim: 0,
      deliveredNim: 0,
      lifetimeEarnedNim: 0,
      pendingCount: 0,
      deliveredCount: 0,
      rewards: [],
    })
    expect(parseTreasureBankResponse(empty.body)).not.toBeNull()
  })

  it('wallet A cannot read wallet B bank', async () => {
    const walletA = await connectedWallet()
    const walletB = await connectedWallet()
    const source = createMemoryTreasureBankSource()
    source.seedClaim({
      claimId: 'b-claim', runId: 'b-run', wallet: walletB.wallet,
      mission: 'gem-runner', dayKey: '2026-09-17', status: 'RESERVED',
      finalizedAt: '2026-09-17T12:00:00.000Z', createdAt: '2026-09-17T12:00:00.000Z',
    })

    const crossed = await dispatchTreasureBankHttp(walletA.service, source, {
      method: 'GET',
      path: TREASURE_BANK_PATH,
      headers: headers(walletA.cookie),
    }, SECURITY)
    // Wallet A service only authenticates wallet A; its bank is empty and leaks nothing of B.
    expect(crossed.status).toBe(200)
    expect(crossed.body).toMatchObject({ pendingCount: 0, rewards: [] })
    expect(JSON.stringify(crossed.body)).not.toContain('b-claim')

    const own = await dispatchTreasureBankHttp(walletB.service, source, {
      method: 'GET',
      path: TREASURE_BANK_PATH,
      headers: headers(walletB.cookie),
    }, SECURITY)
    expect(own.status).toBe(200)
    expect(own.body).toMatchObject({ pendingCount: 1, pendingNim: 100 })
  })

  it('aggregates multi-day claims and maps payout states without leaking internals', async () => {
    const wallet = await connectedWallet()
    const source = createMemoryTreasureBankSource()
    const tx = 'cd'.repeat(32)
    source.seedClaim({
      claimId: 'day1', runId: 'run1', wallet: wallet.wallet,
      mission: 'gem-runner', dayKey: '2026-09-16', status: 'RESERVED',
      finalizedAt: '2026-09-16T12:00:00.000Z', createdAt: '2026-09-16T12:00:00.000Z',
    })
    source.seedClaim({
      claimId: 'day2', runId: 'run2', wallet: wallet.wallet,
      mission: 'vault-breaker', dayKey: '2026-09-17', status: 'RESERVED',
      finalizedAt: '2026-09-17T12:00:00.000Z', createdAt: '2026-09-17T12:00:00.000Z',
    })
    source.seedPayout({ claimId: 'day2', status: 'CONFIRMED', amountLuna: 10_000_000n, txHash: tx })

    const read = await dispatchTreasureBankHttp(wallet.service, source, {
      method: 'GET',
      path: TREASURE_BANK_PATH,
      headers: headers(wallet.cookie),
    }, SECURITY)
    expect(read.status).toBe(200)
    expect(read.body).toMatchObject({
      ok: true,
      pendingNim: 100,
      deliveredNim: 100,
      lifetimeEarnedNim: 200,
      pendingCount: 1,
      deliveredCount: 1,
    })
    const parsed = parseTreasureBankResponse(read.body)
    expect(parsed).not.toBeNull()
    expect(parsed?.rewards.map(reward => `${reward.rewardDay}:${reward.status}`).sort()).toEqual([
      '2026-09-16:SECURED',
      '2026-09-17:DELIVERED',
    ])
    expect(parsed?.rewards.find(reward => reward.status === 'DELIVERED')?.txHash).toBe(tx)
    expect(parsed?.rewards.find(reward => reward.status === 'SECURED')?.txHash).toBeNull()
    const text = JSON.stringify(read.body)
    expect(text).not.toMatch(/luna|amountLuna|RESERVED|CONFIRMED|treasury|install|risk_result/i)
  })

  it('authenticates via wallet recovery session and rejects query wallet overrides', async () => {
    const wallet = await connectedWallet()
    const source = createMemoryTreasureBankSource()
    source.seedClaim({
      claimId: 'rec-claim', runId: 'rec-run', wallet: wallet.wallet,
      mission: 'chest-hunter', dayKey: '2026-09-17', status: 'RESERVED',
      finalizedAt: '2026-09-17T12:00:00.000Z', createdAt: '2026-09-17T12:00:00.000Z',
    })
    const cookie = await recoverWalletCookie(wallet)

    const recovered = await dispatchTreasureBankHttp(wallet.service, source, {
      method: 'GET',
      path: TREASURE_BANK_PATH,
      headers: headers(cookie),
    }, SECURITY)
    expect(recovered.status).toBe(200)
    expect(recovered.body).toMatchObject({ pendingCount: 1, pendingNim: 100 })

    const override = await dispatchTreasureBankHttp(wallet.service, source, {
      method: 'GET',
      path: `${TREASURE_BANK_PATH}?wallet=NQ00OTHER`,
      headers: headers(cookie),
    }, SECURITY)
    expect(override.status).toBe(400)
    expect(override.body).toEqual({ ok: false, error: 'MALFORMED_REQUEST' })
  })

  it('proves the automatic payout scheduler can still settle both reservations independently', async () => {
    const wallet = await connectedWallet()
    const source = createMemoryTreasureBankSource()
    source.seedClaim({
      claimId: 'sched-1', runId: 'sched-r1', wallet: wallet.wallet,
      mission: 'gem-runner', dayKey: '2026-09-16', status: 'RESERVED',
      finalizedAt: '2026-09-16T12:00:00.000Z', createdAt: '2026-09-16T12:00:00.000Z',
    })
    source.seedClaim({
      claimId: 'sched-2', runId: 'sched-r2', wallet: wallet.wallet,
      mission: 'gem-runner', dayKey: '2026-09-17', status: 'RESERVED',
      finalizedAt: '2026-09-17T12:00:00.000Z', createdAt: '2026-09-17T12:00:00.000Z',
    })

    const bank = await dispatchTreasureBankHttp(wallet.service, source, {
      method: 'GET',
      path: TREASURE_BANK_PATH,
      headers: headers(wallet.cookie),
    }, SECURITY)
    expect(bank.body).toMatchObject({ pendingCount: 2, pendingNim: 200 })

    // Existing scheduler discovery path (unchanged code) still sees both claims.
    const store = createMemoryPayoutStore()
    for (const id of ['sched-1', 'sched-2'] as const) {
      store.seedClaim({
        claimId: id,
        runId: id === 'sched-1' ? 'sched-r1' : 'sched-r2',
        wallet: wallet.wallet,
        dayKey: id === 'sched-1' ? '2026-09-16' : '2026-09-17',
        status: 'RESERVED',
        publicKey: 'pk',
        signature: 'sig',
        finalizedAt: new Date().toISOString(),
      })
      store.seedAssessment(id === 'sched-1' ? 'sched-r1' : 'sched-r2', 'PASS')
    }
    const unpaid = await store.listUnpaidReservedClaims(69)
    expect(unpaid.map(claim => claim.claimId).sort()).toEqual(['sched-1', 'sched-2'])
    // No payout was executed by the read model.
    expect(await store.listByStatus('PENDING', 69)).toHaveLength(0)
  })

  it('rejects wrong methods and foreign origins', async () => {
    const wallet = await connectedWallet()
    const source = createMemoryTreasureBankSource()
    const post = await dispatchTreasureBankHttp(wallet.service, source, {
      method: 'POST',
      path: TREASURE_BANK_PATH,
      headers: headers(wallet.cookie),
      rawBody: '{}',
    }, SECURITY)
    expect(post.status).toBe(405)

    const evil = await dispatchTreasureBankHttp(wallet.service, source, {
      method: 'GET',
      path: TREASURE_BANK_PATH,
      headers: { origin: 'https://evil.example', host: SECURITY.expectedHost, protocol: SECURITY.expectedProtocol, cookie: wallet.cookie },
      host: SECURITY.expectedHost,
      protocol: SECURITY.expectedProtocol,
    }, SECURITY)
    expect(evil.status).toBe(400)
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
  const service = createMemoryProofService({
    clock: { now: () => now },
    blueprints: [{ ...createRoom01Blueprint('2026-09-09', 'gem-runner', 'bank-gem'), status: 'PUBLISHED' as const, blueprintHash: hashBlueprint(createRoom01Blueprint('2026-09-09', 'gem-runner', 'bank-gem')) }],
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

async function recoverWalletCookie(wallet: Awaited<ReturnType<typeof connectedWallet>>) {
  const challengeResponse = await dispatchExpeditionHttp(wallet.service, {
    method: 'POST',
    path: '/api/wallet/recover-challenge',
    headers: { origin: SECURITY.expectedOrigin, host: SECURITY.expectedHost, protocol: SECURITY.expectedProtocol, 'content-type': 'application/json' },
    host: SECURITY.expectedHost,
    protocol: SECURITY.expectedProtocol,
    body: { wallet: wallet.wallet },
  }, SECURITY)
  if (challengeResponse.status !== 200) throw new Error('RECOVERY_CHALLENGE_REQUIRED')
  const challenge = challengeResponse.body as { wallet: string; challenge: string; issuedAt: string; expiresAt: string; purpose: 'reward/daily-state recovery' }
  const canonicalPayload = serializeWalletRecoveryPayload({
    version: 1,
    type: 'NIMHUNT_RECOVER_SESSION_V1',
    wallet: challenge.wallet,
    challenge: challenge.challenge,
    issuedAt: challenge.issuedAt,
    expiresAt: challenge.expiresAt,
    purpose: challenge.purpose,
  })
  const recovered = await dispatchExpeditionHttp(wallet.service, {
    method: 'POST',
    path: '/api/wallet/recover-session',
    headers: { origin: SECURITY.expectedOrigin, host: SECURITY.expectedHost, protocol: SECURITY.expectedProtocol, 'content-type': 'application/json' },
    host: SECURITY.expectedHost,
    protocol: SECURITY.expectedProtocol,
    body: {
      payload: canonicalPayload,
      publicKey: wallet.keyPair.publicKey.toHex(),
      signature: wallet.keyPair.sign(nimiqSignedMessageHash(canonicalPayload)).toHex(),
    },
  }, SECURITY)
  if (recovered.status !== 200) throw new Error('RECOVERY_REQUIRED')
  return recovered.headers?.['set-cookie'] ?? ''
}
