import { KeyPair } from '@nimiq/core'
import { describe, expect, it } from 'vitest'
import { PayoutError } from './errors.ts'
import { createFakeTreasury } from './fakeTreasury.ts'
import { createPayoutService } from './service.ts'
import { createMemoryPayoutStore, type MemoryClaimRecord } from './store.ts'
import type { PayoutExecutionConfig } from './config.ts'

const AMOUNT = 100_000n
const CONFIG: PayoutExecutionConfig = {
  network: 'testnet',
  mainnetEnabled: false,
  amountLuna: AMOUNT,
}

function reservedClaim(overrides: Partial<MemoryClaimRecord> = {}): MemoryClaimRecord {
  const wallet = KeyPair.generate().toAddress().toUserFriendlyAddress()
  return {
    claimId: '11111111-1111-1111-1111-111111111111',
    runId: '22222222-2222-2222-2222-222222222222',
    wallet,
    dayKey: '2026-09-16',
    status: 'RESERVED',
    publicKey: 'pk',
    signature: 'sig',
    finalizedAt: '2026-09-16T12:00:00.000Z',
    ...overrides,
  }
}

function harness(claim = reservedClaim()) {
  const store = createMemoryPayoutStore()
  store.seedClaim(claim)
  store.seedSession('session', {
    runId: claim.runId,
    expiresAt: '2099-01-01T00:00:00.000Z',
    revokedAt: null,
  })
  const treasury = createFakeTreasury({ address: 'NQ07 TEST TREA SURY 0000 0000 0000 0000 0000' })
  const service = createPayoutService({ store, treasury, config: CONFIG })
  return { store, treasury, service, claim }
}

describe('payout service', () => {
  it('creates one payout per reserved claim and retries return the same payout', async () => {
    const { service, claim } = harness()
    const first = await service.ensureForReservedClaim(claim.claimId)
    const second = await service.ensureForReservedClaim(claim.claimId)
    expect(first.payoutId).toBe(second.payoutId)
    expect(first.amountLuna).toBe(AMOUNT)
    expect(first.wallet).toBe(claim.wallet)
    expect(first.status).toBe('PENDING')
  })

  it('rejects non-reserved claims and does not create a payout', async () => {
    for (const status of ['PREPARED', 'SOLD_OUT', 'ALREADY_REWARDED', 'EXPIRED'] as const) {
      const claim = reservedClaim({
        claimId: `33333333-3333-3333-3333-33333333333${status.length}`,
        status,
        publicKey: status === 'PREPARED' ? null : 'pk',
        signature: status === 'PREPARED' ? null : 'sig',
        finalizedAt: status === 'PREPARED' ? null : '2026-09-16T12:00:00.000Z',
      })
      const { service } = harness(claim)
      await expect(service.ensureForReservedClaim(claim.claimId)).rejects.toMatchObject({ code: 'CLAIM_NOT_ELIGIBLE' })
    }
  })

  it('stores the configured luna amount immutably', async () => {
    const { service, store, claim } = harness()
    const created = await service.ensureForReservedClaim(claim.claimId)
    const later = createPayoutService({
      store,
      treasury: createFakeTreasury(),
      config: { ...CONFIG, amountLuna: 200_000n },
    })
    const retried = await later.ensureForReservedClaim(claim.claimId)
    expect(retried.payoutId).toBe(created.payoutId)
    expect(retried.amountLuna).toBe(AMOUNT)
  })

  it('lets only one worker acquire a payout', async () => {
    const { service, store, treasury, claim } = harness()
    await service.ensureForReservedClaim(claim.claimId)
    const [first, second] = await Promise.all([store.acquire(), store.acquire()])
    const acquired = [first, second].filter(Boolean)
    expect(acquired).toHaveLength(1)
    expect(acquired[0]?.status).toBe('PROCESSING')
    expect(acquired[0]?.attemptCount).toBe(1)
    expect(treasury.submitted).toHaveLength(0)
  })

  it('submits the exact recipient and luna amount once, then confirms', async () => {
    const { service, treasury, claim } = harness()
    await service.ensureForReservedClaim(claim.claimId)
    const submitted = await service.executeNext()
    expect(submitted?.status).toBe('SUBMITTED')
    expect(treasury.submitted).toHaveLength(1)
    expect(treasury.submitted[0]?.recipient).toBe(claim.wallet)
    expect(treasury.submitted[0]?.amountLuna).toBe(AMOUNT)
    expect(treasury.submitted[0]?.payoutId).toBe(submitted?.payoutId)
    const confirmed = await service.reconcile(submitted!)
    expect(confirmed?.status).toBe('CONFIRMED')
    const again = await service.executeNext()
    expect(again).toBeNull()
    expect(treasury.submitted).toHaveLength(1)
  })

  it('does not resend after SUBMITTED, even across restart', async () => {
    const { service, store, treasury, claim } = harness()
    await service.ensureForReservedClaim(claim.claimId)
    const submitted = await service.executeNext()
    expect(submitted?.status).toBe('SUBMITTED')
    const restarted = createPayoutService({ store, treasury, config: CONFIG })
    expect(await restarted.executeNext()).toBeNull()
    const reconciled = await restarted.reconcile(submitted!)
    expect(reconciled?.status).toBe('CONFIRMED')
    expect(treasury.submitted).toHaveLength(1)
  })

  it('marks an ambiguous crash after broadcast as FAILED_FINAL instead of resending', async () => {
    const claim = reservedClaim()
    const store = createMemoryPayoutStore()
    store.seedClaim(claim)
    const treasury = createFakeTreasury({
      submitMode: 'crash-after-broadcast',
      address: 'NQ07 TEST TREA SURY 0000 0000 0000 0000 0000',
    })
    const service = createPayoutService({ store, treasury, config: CONFIG })
    await service.ensureForReservedClaim(claim.claimId)
    const result = await service.executeNext()
    expect(result?.status).toBe('SUBMITTED')
    expect(treasury.submitted).toHaveLength(1)
    expect(await service.executeNext()).toBeNull()
    expect(treasury.submitted).toHaveLength(1)
  })

  it('retries only when broadcast never happened', async () => {
    const claim = reservedClaim()
    const store = createMemoryPayoutStore()
    store.seedClaim(claim)
    const treasury = createFakeTreasury({ submitMode: 'reject-before-broadcast' })
    const service = createPayoutService({ store, treasury, config: CONFIG })
    await service.ensureForReservedClaim(claim.claimId)
    const failed = await service.executeNext()
    expect(failed?.status).toBe('FAILED_RETRYABLE')
    expect(treasury.submitted).toHaveLength(0)
    treasury.setSubmitMode('broadcast')
    const submitted = await service.executeNext()
    expect(submitted?.status).toBe('SUBMITTED')
    expect(treasury.submitted).toHaveLength(1)
  })

  it('does not automatically resend when a submitted transaction is ambiguous', async () => {
    const { service, treasury, claim } = harness()
    await service.ensureForReservedClaim(claim.claimId)
    const submitted = await service.executeNext()
    treasury.setTransactionStatus(submitted!.txHash!, 'unknown')
    const reconciled = await service.reconcile(submitted!)
    expect(reconciled?.status).toBe('SUBMITTED')
    expect(await service.executeNext()).toBeNull()
    expect(treasury.submitted).toHaveLength(1)
  })

  it('fails closed for mainnet without the enable flag', () => {
    expect(() => createPayoutService({
      store: createMemoryPayoutStore(),
      treasury: createFakeTreasury({ network: 'mainnet' }),
      config: { network: 'mainnet', mainnetEnabled: false, amountLuna: AMOUNT },
    })).toThrow(PayoutError)
  })
})
