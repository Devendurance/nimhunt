import { describe, expect, it } from 'vitest'
import { createFakeTreasury } from './fakeTreasury.ts'
import { createMemoryPayoutStore } from './store.ts'
import { preparePayoutsWithoutBroadcast, runPayoutWorker } from './worker.ts'

const CLAIM = {
  claimId: '11111111-1111-1111-1111-111111111111',
  runId: '22222222-2222-2222-2222-222222222222',
  wallet: 'NQ07 TEST RECI PIEN T000 0000 0000 0000 0000',
  dayKey: '2026-09-16',
  status: 'RESERVED',
  publicKey: 'pk',
  signature: 'sig',
  finalizedAt: '2026-09-16T12:00:00.000Z',
}

const MAINNET = {
  network: 'mainnet' as const,
  mainnetEnabled: true,
  automaticPayoutsEnabled: false,
  amountLuna: 10_000_000n,
  maxDailyRewardLuna: 690_000_000n,
  treasuryMinReserveLuna: 0n,
}

describe('payout worker mainnet guard', () => {
  it('stops before acquire/sign/broadcast when automatic payouts are disabled', async () => {
    const store = createMemoryPayoutStore()
    store.seedClaim(CLAIM)
    store.seedAssessment(CLAIM.runId, 'PASS')
    const treasury = createFakeTreasury({ network: 'mainnet' })
    const report = await runPayoutWorker({
      store,
      treasury,
      config: MAINNET,
      max: 5,
    })
    expect(report.payoutsCreated).toBe(0)
    expect(report.submitted).toBe(0)
    expect(treasury.submitted).toHaveLength(0)
    expect(await store.getByClaim(CLAIM.claimId)).toBeNull()
  })

  it('dry-run reports eligibility without creating, acquiring, or broadcasting', async () => {
    const store = createMemoryPayoutStore()
    store.seedClaim(CLAIM)
    store.seedAssessment(CLAIM.runId, 'PASS')
    const review = {
      ...CLAIM,
      claimId: '11111111-1111-1111-1111-111111111112',
      runId: '22222222-2222-2222-2222-222222222223',
    }
    store.seedClaim(review)
    store.seedAssessment(review.runId, 'REVIEW')
    const treasury = createFakeTreasury({ network: 'mainnet', balance: 50_000_000n })
    const report = await runPayoutWorker({
      store,
      treasury,
      config: { ...MAINNET, treasuryMinReserveLuna: 10_000_000n },
      max: 5,
      dryRun: true,
      mockAvailableLuna: 0n,
    })
    expect(report.dryRun).toBe(true)
    expect(report.eligibleClaims).toBe(1)
    expect(report.wouldCreate).toBe(1)
    expect(report.wouldProcess).toBe(0)
    expect(report.payoutsCreated).toBe(0)
    expect(report.reviewSkipped).toBe(1)
    expect(report.blockSkipped).toBe(0)
    expect(report.treasuryLow).toBe(true)
    expect(report.dailyCapReached).toBe(false)
    expect(treasury.submitted).toHaveLength(0)
    expect(await store.getByClaim(CLAIM.claimId)).toBeNull()
    expect((await store.listByStatus('PENDING', 69))).toHaveLength(0)
  })

  it('dry-run flags dailyCapReached without mutating pending payouts', async () => {
    const store = createMemoryPayoutStore()
    store.seedClaim(CLAIM)
    store.seedAssessment(CLAIM.runId, 'PASS')
    const created = await preparePayoutsWithoutBroadcast({
      store,
      config: MAINNET,
      claimId: CLAIM.claimId,
    })
    expect(created[0]?.status).toBe('PENDING')
    const report = await runPayoutWorker({
      store,
      treasury: createFakeTreasury({ network: 'mainnet', balance: 1_000_000_000n }),
      config: {
        ...MAINNET,
        amountLuna: 10_000_000n,
        maxDailyRewardLuna: 10_000n,
        treasuryMinReserveLuna: 10_000_000n,
      },
      max: 5,
      dryRun: true,
      mockAvailableLuna: 50_000_000n,
    })
    expect(report.dryRun).toBe(true)
    expect(report.wouldCreate).toBe(0)
    expect(report.wouldProcess).toBe(1)
    expect(report.dailyCapReached).toBe(true)
    expect(report.treasuryLow).toBe(false)
    expect((await store.get(created[0]!.payoutId)).status).toBe('PENDING')
  })

  it('creates a pending payout without acquiring or broadcasting', async () => {
    const store = createMemoryPayoutStore()
    store.seedClaim(CLAIM)
    store.seedAssessment(CLAIM.runId, 'PASS')
    const first = await preparePayoutsWithoutBroadcast({
      store,
      config: MAINNET,
      claimId: CLAIM.claimId,
    })
    const retry = await preparePayoutsWithoutBroadcast({
      store,
      config: MAINNET,
      claimId: CLAIM.claimId,
    })
    expect(first).toHaveLength(1)
    expect(retry).toHaveLength(1)
    expect(retry[0]?.payoutId).toBe(first[0]?.payoutId)
    expect(first[0]).toMatchObject({
      claimId: CLAIM.claimId,
      amountLuna: 10_000_000n,
      network: 'mainnet',
      status: 'PENDING',
      txHash: null,
      attemptCount: 0,
    })
    expect(await store.acquire()).not.toBeNull()
  })
})
