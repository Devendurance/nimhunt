import { describe, expect, it } from 'vitest'
import { createRewardPolicy } from '../rewards/policy.ts'
import { createFakeTreasury } from './fakeTreasury.ts'
import { createMemoryPayoutStore, type MemoryClaimRecord } from './store.ts'
import { BETA_MAX_DAILY_REWARD_LUNA, BETA_REWARD_AMOUNT_LUNA } from './types.ts'
import { runPayoutWorker } from './worker.ts'
import type { PayoutExecutionConfig } from './config.ts'

const EVENT_AMOUNT = 1_449_275n
const EVENT_CAP = 100_000_000n
const POLICY = createRewardPolicy({
  NIMHUNT_REWARD_AMOUNT_LUNA: BETA_REWARD_AMOUNT_LUNA.toString(),
  NIMHUNT_MAX_DAILY_REWARD_LUNA: BETA_MAX_DAILY_REWARD_LUNA.toString(),
  NIMHUNT_REWARD_WEEK_ENABLED: 'true',
  NIMHUNT_REWARD_WEEK_STARTS_AT: '2026-10-05T00:00:00.000Z',
  NIMHUNT_REWARD_WEEK_ENDS_AT: '2026-10-12T00:00:00.000Z',
  NIMHUNT_REWARD_WEEK_AMOUNT_LUNA: EVENT_AMOUNT.toString(),
  NIMHUNT_REWARD_WEEK_MAX_DAILY_REWARD_LUNA: EVENT_CAP.toString(),
})

const CONFIG: PayoutExecutionConfig = {
  network: 'mainnet',
  mainnetEnabled: true,
  automaticPayoutsEnabled: true,
  amountLuna: BETA_REWARD_AMOUNT_LUNA,
  maxDailyRewardLuna: BETA_MAX_DAILY_REWARD_LUNA,
  treasuryMinReserveLuna: 0n,
  rewardPolicy: POLICY,
}

function claim(id: string, dayKey: string, rewardAmountLuna: bigint): MemoryClaimRecord {
  return {
    claimId: `11111111-1111-1111-1111-${id}`,
    runId: `22222222-2222-2222-2222-${id}`,
    wallet: `NQ${id}`,
    dayKey,
    status: 'RESERVED',
    publicKey: 'pk',
    signature: 'sig',
    finalizedAt: `${dayKey}T12:00:00.000Z`,
    rewardAmountLuna,
  }
}

async function runOne(row: MemoryClaimRecord, now: string) {
  const store = createMemoryPayoutStore({ clock: { now: () => new Date(now) } })
  await store.setAutomationEnabled(true)
  store.seedClaim(row)
  store.seedAssessment(row.runId, 'PASS')
  const treasury = createFakeTreasury({ network: 'mainnet', balance: 1_000_000_000n })
  await runPayoutWorker({
    store,
    treasury,
    config: CONFIG,
    max: 1,
    now: () => new Date(now),
  })
  return store.getByClaim(row.claimId)
}

describe('Reward Week payout economics', () => {
  it('pays an event claim with its frozen event amount after expiry', async () => {
    const payout = await runOne(
      claim('0001', '2026-10-05', EVENT_AMOUNT),
      '2026-10-13T12:00:00.000Z',
    )
    expect(payout?.amountLuna).toBe(EVENT_AMOUNT)
  })

  it('pays a pre-event claim at baseline amount while the event is active', async () => {
    const payout = await runOne(
      claim('0002', '2026-10-04', BETA_REWARD_AMOUNT_LUNA),
      '2026-10-08T12:00:00.000Z',
    )
    expect(payout?.amountLuna).toBe(BETA_REWARD_AMOUNT_LUNA)
  })

  it('keeps the event daily cap below 1,000 NIM for all 69 reservations', () => {
    expect(EVENT_AMOUNT * 69n).toBe(99_999_975n)
    expect(EVENT_AMOUNT * 69n).toBeLessThanOrEqual(EVENT_CAP)
  })
})
