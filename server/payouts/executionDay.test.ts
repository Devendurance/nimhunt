import { KeyPair } from '@nimiq/core'
import { describe, expect, it } from 'vitest'
import { utcDayKey } from '../ledger/utcDay.ts'
import { createFakeTreasury } from './fakeTreasury.ts'
import { createMemoryPayoutStore, type MemoryClaimRecord } from './store.ts'
import {
  BETA_MAX_DAILY_REWARD_LUNA,
  BETA_REWARD_AMOUNT_LUNA,
} from './types.ts'
import { runPayoutWorker } from './worker.ts'
import type { PayoutExecutionConfig } from './config.ts'

const EXECUTION_DAY = utcDayKey(new Date())
const RESERVATION_YESTERDAY = utcDayKey(new Date(Date.UTC(
  Number(EXECUTION_DAY.slice(0, 4)),
  Number(EXECUTION_DAY.slice(5, 7)) - 1,
  Number(EXECUTION_DAY.slice(8, 10)) - 1,
)))
const CROSS_EXECUTION_DAY = '2026-09-17'
const CROSS_RESERVATION_DAY = '2026-09-16'
const HISTORICAL_PAYOUT_ID = 'd19bf406-2b81-4c5a-b271-da8eb7587cbd'
const HISTORICAL_TX = 'c58022f37ed7352f41c29ef9862297a9cfa8c45593456395d7a6eb7a68009ff6'
const BETA_PAYOUT_ID = '14d204b5-5ced-477b-b626-05cfdbe29e1c'
const BETA_TX = 'f93d6a1e169182f0b3400daa70e3f9557d11dda1bdfb975541c5747f0d05f4fd'
const TX = 'ab'.repeat(32)

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
    dayKey: RESERVATION_YESTERDAY,
    status: 'RESERVED',
    publicKey: 'pk',
    signature: 'sig',
    finalizedAt: new Date(Date.UTC(2026, 8, 16, 12, 0, index)).toISOString(),
    ...overrides,
  }
}

function storeAt(iso: string) {
  return createMemoryPayoutStore({ clock: { now: () => new Date(iso) } })
}

async function seedPass(
  store: ReturnType<typeof createMemoryPayoutStore>,
  index: number,
  overrides: Partial<MemoryClaimRecord> = {},
) {
  const row = claim(index, overrides)
  store.seedClaim(row)
  store.seedAssessment(row.runId, 'PASS')
  return row
}

async function confirmPayout(
  store: ReturnType<typeof createMemoryPayoutStore>,
  claimId: string,
  amountLuna = BETA_REWARD_AMOUNT_LUNA,
  txHash = TX,
) {
  await store.setAutomationEnabled(true)
  const created = await store.create({
    claimId,
    payoutId: `aaaaaaaa-aaaa-aaaa-aaaa-${claimId.slice(-12)}`,
    amountLuna,
    network: 'mainnet',
  })
  const acquired = await store.acquireAutomated({
    availableForRewardsLuna: amountLuna,
    maxDailyRewardLuna: BETA_MAX_DAILY_REWARD_LUNA,
    feeLuna: 0n,
  })
  if (!acquired.payout) throw new Error(acquired.reason ?? 'NO_WORK')
  const submitted = await store.markSubmitted(acquired.payout.payoutId, txHash)
  const confirmed = await store.markConfirmed(submitted.payoutId, txHash)
  return { created, confirmed }
}

describe('execution-day treasury spend', () => {
  it('keeps reservation day on a previous-day claim and stamps today as execution day', async () => {
    const store = storeAt(`${CROSS_EXECUTION_DAY}T02:18:00.000Z`)
    const ready = await seedPass(store, 1, { dayKey: CROSS_RESERVATION_DAY })
    await store.setAutomationEnabled(true)
    const created = await store.create({
      claimId: ready.claimId,
      payoutId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      amountLuna: BETA_REWARD_AMOUNT_LUNA,
      network: 'mainnet',
    })
    expect(created.payout.dayKey).toBe(CROSS_RESERVATION_DAY)
    expect(created.payout.executionDayKey).toBeNull()
    expect(created.payout.status).toBe('PENDING')
    expect(await store.getExecutionDaySpend(CROSS_EXECUTION_DAY)).toBe(0n)

    const acquired = await store.acquireAutomated({
      availableForRewardsLuna: BETA_REWARD_AMOUNT_LUNA,
      maxDailyRewardLuna: BETA_MAX_DAILY_REWARD_LUNA,
      feeLuna: 0n,
    })
    expect(acquired.payout?.dayKey).toBe(CROSS_RESERVATION_DAY)
    expect(acquired.payout?.executionDayKey).toBe(CROSS_EXECUTION_DAY)
    expect(acquired.payout?.status).toBe('PROCESSING')
    expect(await store.getExecutionDaySpend(CROSS_RESERVATION_DAY)).toBe(0n)
    expect(await store.getExecutionDaySpend(CROSS_EXECUTION_DAY)).toBe(BETA_REWARD_AMOUNT_LUNA)
  })

  it('counts same-day reservation+execution against today only', async () => {
    const store = storeAt(`${EXECUTION_DAY}T12:00:00.000Z`)
    const ready = await seedPass(store, 2, { dayKey: EXECUTION_DAY })
    await confirmPayout(store, ready.claimId)
    const payout = await store.getByClaim(ready.claimId)
    expect(payout?.dayKey).toBe(EXECUTION_DAY)
    expect(payout?.executionDayKey).toBe(EXECUTION_DAY)
    expect(payout?.status).toBe('CONFIRMED')
    expect(await store.getExecutionDaySpend(EXECUTION_DAY)).toBe(BETA_REWARD_AMOUNT_LUNA)
  })

  it('does not count PENDING as spent', async () => {
    const store = storeAt(`${EXECUTION_DAY}T12:00:00.000Z`)
    const ready = await seedPass(store, 3)
    await store.create({
      claimId: ready.claimId,
      payoutId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
      amountLuna: BETA_REWARD_AMOUNT_LUNA,
      network: 'mainnet',
    })
    expect(await store.getExecutionDaySpend(EXECUTION_DAY)).toBe(0n)
    expect((await store.getByClaim(ready.claimId))?.status).toBe('PENDING')
  })

  it('counts SUBMITTED and CONFIRMED once and FAILED_FINAL only when a tx hash exists', async () => {
    const store = storeAt(`${EXECUTION_DAY}T12:00:00.000Z`)
    const submittedClaim = await seedPass(store, 4)
    const confirmedClaim = await seedPass(store, 5)
    const failedWithTx = await seedPass(store, 6)
    const failedNoTx = await seedPass(store, 7)
    await store.setAutomationEnabled(true)

    await store.create({
      claimId: submittedClaim.claimId,
      payoutId: '11111111-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
      amountLuna: BETA_REWARD_AMOUNT_LUNA,
      network: 'mainnet',
    })
    const submittedAcquired = await store.acquireAutomated({
      availableForRewardsLuna: 50_000_000n,
      maxDailyRewardLuna: BETA_MAX_DAILY_REWARD_LUNA,
      feeLuna: 0n,
    })
    await store.markSubmitted(submittedAcquired.payout!.payoutId, `11${'ab'.repeat(31)}`)

    await confirmPayout(store, confirmedClaim.claimId, BETA_REWARD_AMOUNT_LUNA, `22${'ab'.repeat(31)}`)

    await store.create({
      claimId: failedWithTx.claimId,
      payoutId: '11111111-aaaa-aaaa-aaaa-aaaaaaaaaaa3',
      amountLuna: BETA_REWARD_AMOUNT_LUNA,
      network: 'mainnet',
    })
    const failedAcquired = await store.acquireAutomated({
      availableForRewardsLuna: 50_000_000n,
      maxDailyRewardLuna: BETA_MAX_DAILY_REWARD_LUNA,
      feeLuna: 0n,
    })
    const withHash = await store.markSubmitted(failedAcquired.payout!.payoutId, `33${'ab'.repeat(31)}`)
    await store.markFailed({
      payoutId: withHash.payoutId,
      status: 'FAILED_FINAL',
      failureCode: 'AMBIGUOUS_SUBMISSION',
      failureMessageSafe: 'Payout needs review before any retry.',
    })

    await store.create({
      claimId: failedNoTx.claimId,
      payoutId: '11111111-aaaa-aaaa-aaaa-aaaaaaaaaaa4',
      amountLuna: BETA_REWARD_AMOUNT_LUNA,
      network: 'mainnet',
    })
    const noTx = await store.acquireAutomated({
      availableForRewardsLuna: 50_000_000n,
      maxDailyRewardLuna: BETA_MAX_DAILY_REWARD_LUNA,
      feeLuna: 0n,
    })
    await store.markFailed({
      payoutId: noTx.payout!.payoutId,
      status: 'FAILED_FINAL',
      failureCode: 'AMBIGUOUS_SUBMISSION',
      failureMessageSafe: 'Payout needs review before any retry.',
    })

    expect(await store.getExecutionDaySpend(EXECUTION_DAY)).toBe(30_000_000n)
  })

  it('leaves a second payout PENDING when the execution-day cap is reached', async () => {
    const store = storeAt(`${EXECUTION_DAY}T12:00:00.000Z`)
    const first = await seedPass(store, 10, { dayKey: RESERVATION_YESTERDAY })
    const second = await seedPass(store, 11, { dayKey: EXECUTION_DAY })
    await store.setAutomationEnabled(true)
    await store.create({
      claimId: first.claimId,
      payoutId: 'dddddddd-dddd-dddd-dddd-ddddddddddd1',
      amountLuna: BETA_REWARD_AMOUNT_LUNA,
      network: 'mainnet',
    })
    await store.create({
      claimId: second.claimId,
      payoutId: 'dddddddd-dddd-dddd-dddd-ddddddddddd2',
      amountLuna: BETA_REWARD_AMOUNT_LUNA,
      network: 'mainnet',
    })
    const ok = await store.acquireAutomated({
      availableForRewardsLuna: 50_000_000n,
      maxDailyRewardLuna: BETA_REWARD_AMOUNT_LUNA,
      feeLuna: 0n,
    })
    const blocked = await store.acquireAutomated({
      availableForRewardsLuna: 50_000_000n,
      maxDailyRewardLuna: BETA_REWARD_AMOUNT_LUNA,
      feeLuna: 0n,
    })
    expect(ok.payout?.status).toBe('PROCESSING')
    expect(ok.payout?.executionDayKey).toBe(EXECUTION_DAY)
    expect(blocked.payout).toBeNull()
    expect(blocked.reason).toBe('DAILY_CAP_REACHED')
    expect((await store.getByClaim(second.claimId))?.status).toBe('PENDING')
    expect((await store.getByClaim(second.claimId))?.executionDayKey).toBeNull()
    expect(await store.getExecutionDaySpend(EXECUTION_DAY)).toBe(BETA_REWARD_AMOUNT_LUNA)
  })

  it('lets only one of two racing 10 NIM payouts commit at 680 NIM already spent', async () => {
    const store = storeAt(`${EXECUTION_DAY}T12:00:00.000Z`)
    const filled = await seedPass(store, 20)
    const left = await seedPass(store, 21)
    const right = await seedPass(store, 22)
    await confirmPayout(store, filled.claimId, 680_000_000n, `44${'ab'.repeat(31)}`)
    await store.create({
      claimId: left.claimId,
      payoutId: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee1',
      amountLuna: BETA_REWARD_AMOUNT_LUNA,
      network: 'mainnet',
    })
    await store.create({
      claimId: right.claimId,
      payoutId: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee2',
      amountLuna: BETA_REWARD_AMOUNT_LUNA,
      network: 'mainnet',
    })
    const [first, second] = await Promise.all([
      store.acquireAutomated({
        availableForRewardsLuna: 50_000_000n,
        maxDailyRewardLuna: BETA_MAX_DAILY_REWARD_LUNA,
        feeLuna: 0n,
      }),
      store.acquireAutomated({
        availableForRewardsLuna: 50_000_000n,
        maxDailyRewardLuna: BETA_MAX_DAILY_REWARD_LUNA,
        feeLuna: 0n,
      }),
    ])
    const acquired = [first, second].filter(row => row.payout)
    const blocked = [first, second].filter(row => row.reason === 'DAILY_CAP_REACHED')
    expect(acquired).toHaveLength(1)
    expect(blocked).toHaveLength(1)
    expect(await store.getExecutionDaySpend(EXECUTION_DAY)).toBe(BETA_MAX_DAILY_REWARD_LUNA)
    const pending = [
      await store.getByClaim(left.claimId),
      await store.getByClaim(right.claimId),
    ].filter(row => row?.status === 'PENDING')
    expect(pending).toHaveLength(1)
  })

  it('stops carryover plus current-day claims at 690,000,000 Luna execution spend', async () => {
    const store = storeAt(`${EXECUTION_DAY}T12:00:00.000Z`)
    await store.setAutomationEnabled(true)
    const seeded: MemoryClaimRecord[] = []
    for (let index = 1; index <= 40; index += 1) {
      seeded.push(await seedPass(store, index, { dayKey: RESERVATION_YESTERDAY }))
    }
    for (let index = 41; index <= 80; index += 1) {
      seeded.push(await seedPass(store, index, { dayKey: EXECUTION_DAY }))
    }
    const treasury = createFakeTreasury({ network: 'mainnet', balance: 1_000_000_000n })
    const first = await runPayoutWorker({ store, treasury, config: AUTOMATIC, max: 69 })
    expect(first.confirmed).toBe(69)
    expect(first.executionDay).toBe(EXECUTION_DAY)
    expect(first.executionDayCommittedLuna).toBe(BETA_MAX_DAILY_REWARD_LUNA.toString())
    expect(first.executionDayRemainingLuna).toBe('0')
    expect(treasury.submitted).toHaveLength(69)

    for (const row of seeded.slice(69)) {
      await store.create({
        claimId: row.claimId,
        payoutId: `ffffffff-ffff-ffff-ffff-${row.claimId.slice(-12)}`,
        amountLuna: BETA_REWARD_AMOUNT_LUNA,
        network: 'mainnet',
      })
    }
    const overflow = await runPayoutWorker({ store, treasury, config: AUTOMATIC, max: 5 })
    expect(overflow.dailyCapReached).toBe(true)
    expect(treasury.submitted).toHaveLength(69)
    expect(await store.getExecutionDaySpend(EXECUTION_DAY)).toBe(BETA_MAX_DAILY_REWARD_LUNA)
    expect((await store.listByStatus('PENDING', 69)).length).toBeGreaterThan(0)
    for (const row of seeded) {
      const payout = await store.getByClaim(row.claimId)
      if (payout?.status === 'CONFIRMED') {
        expect(payout.executionDayKey).toBe(EXECUTION_DAY)
        expect(payout.dayKey === RESERVATION_YESTERDAY || payout.dayKey === EXECUTION_DAY).toBe(true)
      }
    }
  })

  it('does not resend SUBMITTED after restart and still counts it once', async () => {
    const store = storeAt(`${EXECUTION_DAY}T12:00:00.000Z`)
    const ready = await seedPass(store, 90)
    await store.setAutomationEnabled(true)
    const treasury = createFakeTreasury({
      network: 'mainnet',
      balance: 50_000_000n,
      confirmationStatus: 'pending',
    })
    const first = await runPayoutWorker({ store, treasury, config: AUTOMATIC, max: 1 })
    expect(first.submitted).toBe(1)
    expect(await store.getExecutionDaySpend(EXECUTION_DAY)).toBe(BETA_REWARD_AMOUNT_LUNA)
    treasury.setSubmitMode('reject-before-broadcast')
    const restarted = await runPayoutWorker({ store, treasury, config: AUTOMATIC, max: 1 })
    expect(treasury.submitted).toHaveLength(1)
    expect(restarted.payoutsCreated).toBe(0)
    expect((await store.getByClaim(ready.claimId))?.status).toBe('SUBMITTED')
    expect(await store.getExecutionDaySpend(EXECUTION_DAY)).toBe(BETA_REWARD_AMOUNT_LUNA)
  })

  it('does not rewrite historical 0.1 NIM or 100 NIM payout identity fields', async () => {
    const store = storeAt(`${CROSS_EXECUTION_DAY}T02:18:00.000Z`)
    const historicalClaim = await seedPass(store, 100, {
      claimId: '40891624-e2c2-471f-aa9a-9674ca6200a7',
      runId: '99999999-9999-9999-9999-999999999901',
      dayKey: CROSS_RESERVATION_DAY,
    })
    const betaClaim = await seedPass(store, 101, {
      claimId: 'cd176c93-c9de-4c07-ad96-bcd1f16c14a4',
      runId: '0adef64b-3371-429f-8c71-89fb3cf1a7c6',
      dayKey: CROSS_RESERVATION_DAY,
    })
    await store.setAutomationEnabled(true)
    await store.create({
      claimId: historicalClaim.claimId,
      payoutId: HISTORICAL_PAYOUT_ID,
      amountLuna: 10_000n,
      network: 'mainnet',
    })
    const historicalAcquired = await store.acquire()
    const historicalSubmitted = await store.markSubmitted(historicalAcquired!.payoutId, HISTORICAL_TX)
    const historical = await store.markConfirmed(historicalSubmitted.payoutId, HISTORICAL_TX)

    await store.create({
      claimId: betaClaim.claimId,
      payoutId: BETA_PAYOUT_ID,
      amountLuna: BETA_REWARD_AMOUNT_LUNA,
      network: 'mainnet',
    })
    const betaAcquired = await store.acquire()
    const betaSubmitted = await store.markSubmitted(betaAcquired!.payoutId, BETA_TX)
    const beta = await store.markConfirmed(betaSubmitted.payoutId, BETA_TX)

    expect(historical).toMatchObject({
      payoutId: HISTORICAL_PAYOUT_ID,
      status: 'CONFIRMED',
      amountLuna: 10_000n,
      txHash: HISTORICAL_TX,
      dayKey: CROSS_RESERVATION_DAY,
      executionDayKey: CROSS_EXECUTION_DAY,
    })
    expect(beta).toMatchObject({
      payoutId: BETA_PAYOUT_ID,
      status: 'CONFIRMED',
      amountLuna: BETA_REWARD_AMOUNT_LUNA,
      txHash: BETA_TX,
      dayKey: CROSS_RESERVATION_DAY,
      executionDayKey: CROSS_EXECUTION_DAY,
    })
    expect(historicalClaim.status).toBe('RESERVED')
    expect(betaClaim.status).toBe('RESERVED')
  })

  it('reports execution-day accounting without calling reservation spend today', async () => {
    const store = storeAt(`${EXECUTION_DAY}T12:00:00.000Z`)
    await seedPass(store, 110)
    const report = await runPayoutWorker({
      store,
      treasury: createFakeTreasury({ network: 'mainnet', balance: 0n }),
      config: AUTOMATIC,
      max: 1,
      dryRun: true,
      mockAvailableLuna: 20_000_000n,
    })
    expect(report.dryRun).toBe(true)
    expect(report.executionDay).toBe(EXECUTION_DAY)
    expect(report.executionDayCommittedLuna).toBe('0')
    expect(report.executionDayRemainingLuna).toBe(BETA_MAX_DAILY_REWARD_LUNA.toString())
    expect(report.executionDay).not.toBe(RESERVATION_YESTERDAY)
    expect(utcDayKey(new Date(`${EXECUTION_DAY}T12:00:00.000Z`))).toBe(EXECUTION_DAY)
  })
})
