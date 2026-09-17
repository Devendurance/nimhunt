import { KeyPair } from '@nimiq/core'
import { describe, expect, it } from 'vitest'
import { createFakeTreasury } from './fakeTreasury.ts'
import { createMemoryPayoutStore, type MemoryClaimRecord } from './store.ts'
import {
  BETA_MAX_DAILY_REWARD_LUNA,
  BETA_REWARD_AMOUNT_LUNA,
} from './types.ts'
import { runPayoutWorker, shortenPayoutId, shortenPayoutWallet } from './worker.ts'
import type { PayoutExecutionConfig } from './config.ts'

const DAY = '2026-09-18'
const AUTOMATIC: PayoutExecutionConfig = {
  network: 'mainnet',
  mainnetEnabled: true,
  automaticPayoutsEnabled: true,
  amountLuna: BETA_REWARD_AMOUNT_LUNA,
  maxDailyRewardLuna: BETA_MAX_DAILY_REWARD_LUNA,
  treasuryMinReserveLuna: 0n,
}

function wallet(): string {
  return KeyPair.generate().toAddress().toUserFriendlyAddress()
}

function claim(index: number, overrides: Partial<MemoryClaimRecord> = {}): MemoryClaimRecord {
  const id = index.toString().padStart(12, '0')
  return {
    claimId: `11111111-1111-1111-${id.slice(0, 4)}-${id.slice(4)}`,
    runId: `22222222-2222-2222-${id.slice(0, 4)}-${id.slice(4)}`,
    wallet: wallet(),
    dayKey: DAY,
    status: 'RESERVED',
    publicKey: 'pk',
    signature: 'sig',
    finalizedAt: new Date(Date.UTC(2026, 8, 18, 12, 0, index)).toISOString(),
    ...overrides,
  }
}

async function seedEligible(
  store: ReturnType<typeof createMemoryPayoutStore>,
  count: number,
  result: 'PASS' | 'REVIEW' | 'BLOCK' = 'PASS',
  start = 1,
): Promise<MemoryClaimRecord[]> {
  const seeded: MemoryClaimRecord[] = []
  for (let index = start; index < start + count; index += 1) {
    const row = claim(index)
    store.seedClaim(row)
    store.seedAssessment(row.runId, result)
    seeded.push(row)
  }
  return seeded
}

describe('automatic payout pipeline', () => {
  it('discovers PASS/RESERVED claims, creates one payout, and confirms 100 NIM', async () => {
    const store = createMemoryPayoutStore()
    await store.setAutomationEnabled(true)
    const [ready] = await seedEligible(store, 1)
    const treasury = createFakeTreasury({ network: 'mainnet', balance: 20_000_000n })
    const logs: Record<string, unknown>[] = []
    const report = await runPayoutWorker({
      store,
      treasury,
      config: AUTOMATIC,
      max: 5,
      log: event => logs.push(event),
    })
    expect(report.eligibleClaims).toBe(1)
    expect(report.payoutsCreated).toBe(1)
    expect(report.submitted).toBe(1)
    expect(report.confirmed).toBe(1)
    expect(report.reviewSkipped).toBe(0)
    expect(report.blockSkipped).toBe(0)
    expect(report.errors).toEqual([])
    const payout = await store.getByClaim(ready!.claimId)
    expect(payout).toMatchObject({
      amountLuna: 10_000_000n,
      network: 'mainnet',
      status: 'CONFIRMED',
    })
    expect(treasury.submitted).toHaveLength(1)
    expect(treasury.submitted[0]?.amountLuna).toBe(10_000_000n)
    expect(JSON.stringify(logs)).not.toMatch(/mnemonic|private key|capability|signature/i)
    expect(JSON.stringify(logs)).toContain(shortenPayoutId(payout!.payoutId))
    expect(JSON.stringify(logs)).toContain(shortenPayoutWallet(ready!.wallet))
    expect(JSON.stringify(logs)).not.toContain(payout!.payoutId)
  })

  it('skips REVIEW and BLOCK and never creates payouts for them', async () => {
    const store = createMemoryPayoutStore()
    await store.setAutomationEnabled(true)
    await seedEligible(store, 1, 'PASS', 1)
    await seedEligible(store, 2, 'REVIEW', 10)
    await seedEligible(store, 2, 'BLOCK', 20)
    const treasury = createFakeTreasury({ network: 'mainnet', balance: 50_000_000n })
    const report = await runPayoutWorker({ store, treasury, config: AUTOMATIC, max: 5 })
    expect(report.eligibleClaims).toBe(1)
    expect(report.payoutsCreated).toBe(1)
    expect(report.reviewSkipped).toBe(2)
    expect(report.blockSkipped).toBe(2)
    expect(treasury.submitted).toHaveLength(1)
    expect(await store.listUnpaidReservedClaims(69)).toEqual([])
  })

  it('is idempotent: a second discovery cycle creates nothing twice', async () => {
    const store = createMemoryPayoutStore()
    await store.setAutomationEnabled(true)
    await seedEligible(store, 1)
    const treasury = createFakeTreasury({ network: 'mainnet', balance: 50_000_000n })
    const first = await runPayoutWorker({ store, treasury, config: AUTOMATIC, max: 5 })
    const second = await runPayoutWorker({ store, treasury, config: AUTOMATIC, max: 5 })
    expect(first.payoutsCreated).toBe(1)
    expect(second.payoutsCreated).toBe(0)
    expect(second.eligibleClaims).toBe(0)
    expect(treasury.submitted).toHaveLength(1)
  })

  it('pays oldest eligible claim first, then stable claim id', async () => {
    const store = createMemoryPayoutStore()
    await store.setAutomationEnabled(true)
    const later = claim(2, { finalizedAt: '2026-09-18T12:02:00.000Z' })
    const earlier = claim(1, { finalizedAt: '2026-09-18T12:01:00.000Z' })
    store.seedClaim(later)
    store.seedAssessment(later.runId, 'PASS')
    store.seedClaim(earlier)
    store.seedAssessment(earlier.runId, 'PASS')
    const treasury = createFakeTreasury({ network: 'mainnet', balance: 50_000_000n })
    await runPayoutWorker({ store, treasury, config: AUTOMATIC, max: 1 })
    expect(treasury.submitted[0]?.recipient).toBe(earlier.wallet)
    const remaining = await store.listUnpaidReservedClaims(69)
    expect(remaining).toEqual([expect.objectContaining({ claimId: later.claimId })] )
  })

  it('stops on the env kill switch and still reconciles SUBMITTED', async () => {
    const store = createMemoryPayoutStore()
    await store.setAutomationEnabled(true)
    const [ready] = await seedEligible(store, 1)
    await store.create({
      claimId: ready!.claimId,
      payoutId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      amountLuna: BETA_REWARD_AMOUNT_LUNA,
      network: 'mainnet',
    })
    const acquired = await store.acquire()
    const hash = 'ab'.repeat(32)
    const submitted = await store.markSubmitted(acquired!.payoutId, hash)
    const treasury = createFakeTreasury({ network: 'mainnet', balance: 50_000_000n })
    treasury.seedTransaction({
      txHash: hash,
      sender: treasury.address(),
      recipient: ready!.wallet,
      amountLuna: BETA_REWARD_AMOUNT_LUNA,
      network: 'mainnet',
      extraData: submitted.payoutId,
      status: 'confirmed',
      confirmations: 1,
    })
    const report = await runPayoutWorker({
      store,
      treasury,
      config: { ...AUTOMATIC, automaticPayoutsEnabled: false },
      max: 5,
    })
    expect(treasury.submitted).toHaveLength(0)
    expect(report.confirmed).toBe(1)
    expect((await store.get(submitted.payoutId)).status).toBe('CONFIRMED')
  })

  it('stops on the DB kill switch even when env automation is on', async () => {
    const store = createMemoryPayoutStore()
    await store.setAutomationEnabled(false)
    await seedEligible(store, 1)
    const treasury = createFakeTreasury({ network: 'mainnet', balance: 50_000_000n })
    const report = await runPayoutWorker({ store, treasury, config: AUTOMATIC, max: 5 })
    expect(report.payoutsCreated).toBe(0)
    expect(treasury.submitted).toHaveLength(0)
  })

  it('leaves remaining payouts PENDING when the daily cap is reached', async () => {
    const store = createMemoryPayoutStore()
    await store.setAutomationEnabled(true)
    await seedEligible(store, 69)
    const extra = claim(70)
    store.seedClaim(extra)
    store.seedAssessment(extra.runId, 'PASS')
    const treasury = createFakeTreasury({ network: 'mainnet', balance: 1_000_000_000n })
    await runPayoutWorker({ store, treasury, config: AUTOMATIC, max: 69 })
    await store.create({
      claimId: extra.claimId,
      payoutId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
      amountLuna: BETA_REWARD_AMOUNT_LUNA,
      network: 'mainnet',
    })
    const report = await runPayoutWorker({ store, treasury, config: AUTOMATIC, max: 5 })
    expect(report.dailyCapReached).toBe(true)
    expect(treasury.submitted).toHaveLength(69)
    expect((await store.getByClaim(extra.claimId))?.status).toBe('PENDING')
  })

  it('does not acquire when treasury cannot cover the next payout plus reserve', async () => {
    const store = createMemoryPayoutStore()
    await store.setAutomationEnabled(true)
    await seedEligible(store, 2)
    const treasury = createFakeTreasury({
      network: 'mainnet',
      balance: 15_000_000n,
    })
    const report = await runPayoutWorker({
      store,
      treasury,
      config: { ...AUTOMATIC, treasuryMinReserveLuna: 10_000_000n },
      max: 5,
    })
    expect(report.treasuryLow).toBe(true)
    expect(treasury.submitted).toHaveLength(0)
    expect(await store.listByStatus('PENDING', 69)).toHaveLength(2)
  })

  it('does not resend SUBMITTED after a worker restart', async () => {
    const store = createMemoryPayoutStore()
    await store.setAutomationEnabled(true)
    await seedEligible(store, 1)
    const treasury = createFakeTreasury({
      network: 'mainnet',
      balance: 50_000_000n,
      confirmationStatus: 'pending',
    })
    const first = await runPayoutWorker({ store, treasury, config: AUTOMATIC, max: 5 })
    expect(first.submitted).toBe(1)
    expect(first.confirmed).toBe(0)
    treasury.setSubmitMode('reject-before-broadcast')
    const restarted = await runPayoutWorker({ store, treasury, config: AUTOMATIC, max: 5 })
    expect(treasury.submitted).toHaveLength(1)
    expect(restarted.payoutsCreated).toBe(0)
    expect((await store.listByStatus('SUBMITTED', 69))[0]?.status).toBe('SUBMITTED')
  })

  it('recovers crash-after-broadcast through the existing hash instead of a second transfer', async () => {
    const store = createMemoryPayoutStore()
    await store.setAutomationEnabled(true)
    await seedEligible(store, 1)
    const treasury = createFakeTreasury({
      network: 'mainnet',
      balance: 50_000_000n,
      submitMode: 'crash-after-broadcast',
    })
    const report = await runPayoutWorker({ store, treasury, config: AUTOMATIC, max: 5 })
    expect(report.submitted).toBe(1)
    expect(treasury.submitted).toHaveLength(1)
    const again = await runPayoutWorker({ store, treasury, config: AUTOMATIC, max: 5 })
    expect(again.payoutsCreated).toBe(0)
    expect(treasury.submitted).toHaveLength(1)
  })

  it('confirms 69 mock payouts at 10,000,000 Luna and leaves #70 unfunded', async () => {
    const store = createMemoryPayoutStore()
    await store.setAutomationEnabled(true)
    await seedEligible(store, 69)
    const extra = claim(70)
    store.seedClaim(extra)
    store.seedAssessment(extra.runId, 'PASS')
    const treasury = createFakeTreasury({
      network: 'mainnet',
      balance: 1_000_000_000n,
    })
    const report = await runPayoutWorker({ store, treasury, config: AUTOMATIC, max: 69 })
    expect(report.eligibleClaims).toBe(69)
    expect(report.payoutsCreated).toBe(69)
    expect(report.confirmed).toBe(69)
    expect(report.dailyCapReached).toBe(false)
    expect(treasury.submitted).toHaveLength(69)
    expect(treasury.submitted.reduce((sum, row) => sum + row.amountLuna, 0n)).toBe(BETA_MAX_DAILY_REWARD_LUNA)
    expect(await store.getByClaim(extra.claimId)).toBeNull()

    await store.create({
      claimId: extra.claimId,
      payoutId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      amountLuna: BETA_REWARD_AMOUNT_LUNA,
      network: 'mainnet',
    })
    const overflow = await runPayoutWorker({ store, treasury, config: AUTOMATIC, max: 5 })
    expect(overflow.dailyCapReached).toBe(true)
    expect(treasury.submitted).toHaveLength(69)
    expect((await store.getByClaim(extra.claimId))?.status).toBe('PENDING')
  })

  it('dry-run never acquires even when env and DB automation are on', async () => {
    const store = createMemoryPayoutStore()
    await store.setAutomationEnabled(true)
    await seedEligible(store, 2)
    const treasury = createFakeTreasury({ network: 'mainnet', balance: 50_000_000n })
    const report = await runPayoutWorker({
      store,
      treasury,
      config: { ...AUTOMATIC, treasuryMinReserveLuna: 10_000_000n },
      max: 5,
      dryRun: true,
      mockAvailableLuna: 5_000_000n,
    })
    expect(report.dryRun).toBe(true)
    expect(report.eligibleClaims).toBe(2)
    expect(report.wouldCreate).toBe(2)
    expect(report.payoutsCreated).toBe(0)
    expect(report.treasuryLow).toBe(true)
    expect(treasury.submitted).toHaveLength(0)
    expect(await store.listByStatus('PENDING', 69)).toHaveLength(0)
    expect(await store.listByStatus('PROCESSING', 69)).toHaveLength(0)
  })

  it('dry-run treasury guard passes when mocked balance covers reward plus 100 NIM reserve', async () => {
    const store = createMemoryPayoutStore()
    await store.setAutomationEnabled(true)
    await seedEligible(store, 1)
    const report = await runPayoutWorker({
      store,
      treasury: createFakeTreasury({ network: 'mainnet', balance: 0n }),
      config: { ...AUTOMATIC, treasuryMinReserveLuna: 10_000_000n },
      max: 5,
      dryRun: true,
      mockAvailableLuna: 20_000_000n,
    })
    expect(report.treasuryLow).toBe(false)
    expect(report.wouldCreate).toBe(1)
    expect(report.payoutsCreated).toBe(0)
  })

  it('stops after N payouts when treasury cannot cover the next one', async () => {
    const store = createMemoryPayoutStore()
    await store.setAutomationEnabled(true)
    await seedEligible(store, 5)
    const treasury = createFakeTreasury({
      network: 'mainnet',
      balance: 30_000_000n,
    })
    const report = await runPayoutWorker({
      store,
      treasury,
      config: { ...AUTOMATIC, treasuryMinReserveLuna: 0n },
      max: 5,
    })
    expect(report.treasuryLow).toBe(true)
    expect(treasury.submitted).toHaveLength(3)
    expect(await store.listByStatus('PENDING', 69)).toHaveLength(2)
  })
})
