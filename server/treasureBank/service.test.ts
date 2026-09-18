import { describe, expect, it } from 'vitest'
import { BETA_REWARD_AMOUNT_LUNA } from '../payouts/types.js'
import { buildTreasureBank, lunaToNim, BETA_REWARD_NIM, resolveRewardFallbackAmountLuna } from './service.js'

const DAY1 = '2026-09-16'
const DAY2 = '2026-09-17'
const WALLET = 'NQ00 TEST WALLET'

function claim(overrides: Partial<Parameters<typeof buildTreasureBank>[0]['claims'][number]> & { claimId: string; runId: string }) {
  return {
    wallet: WALLET,
    mission: 'gem-runner',
    dayKey: DAY1,
    status: 'RESERVED',
    finalizedAt: `${DAY1}T12:00:00.000Z`,
    createdAt: `${DAY1}T12:00:00.000Z`,
    ...overrides,
  }
}

describe('treasure bank read model', () => {
  it('aggregates same-wallet reservations across days into pending 200 NIM', () => {
    const bank = buildTreasureBank({
      claims: [
        claim({ claimId: 'c1', runId: 'r1', dayKey: DAY1, mission: 'gem-runner' }),
        claim({ claimId: 'c2', runId: 'r2', dayKey: DAY2, mission: 'chest-hunter' }),
      ],
      payouts: [],
    })
    expect(bank.pendingCount).toBe(2)
    expect(bank.deliveredCount).toBe(0)
    expect(bank.pendingNim).toBe(200)
    expect(bank.deliveredNim).toBe(0)
    expect(bank.lifetimeEarnedNim).toBe(200)
    expect(bank.rewards).toHaveLength(2)
    // Newest day first.
    expect(bank.rewards[0]?.rewardDay).toBe(DAY2)
    expect(bank.rewards[1]?.rewardDay).toBe(DAY1)
    expect(bank.rewards.map(reward => reward.status)).toEqual(['SECURED', 'SECURED'])
  })

  it('maps RESERVED without payout to SECURED with fallback 100 NIM', () => {
    const bank = buildTreasureBank({
      claims: [claim({ claimId: 'c1', runId: 'r1' })],
      payouts: [],
    })
    expect(BETA_REWARD_NIM).toBe(100)
    expect(bank.rewards[0]).toMatchObject({ status: 'SECURED', amountNim: 100, txHash: null })
  })

  it('maps SUBMITTED to PROCESSING with tx hash, CONFIRMED to DELIVERED', () => {
    const tx = 'ab'.repeat(32)
    const bank = buildTreasureBank({
      claims: [
        claim({ claimId: 'c1', runId: 'r1', dayKey: DAY1 }),
        claim({ claimId: 'c2', runId: 'r2', dayKey: DAY2 }),
      ],
      payouts: [
        { claimId: 'c1', status: 'SUBMITTED', amountLuna: 10_000_000n, txHash: tx },
        { claimId: 'c2', status: 'CONFIRMED', amountLuna: 10_000_000n, txHash: tx },
      ],
    })
    expect(bank.rewards.find(reward => reward.rewardDay === DAY1)).toMatchObject({ status: 'PROCESSING', txHash: tx })
    expect(bank.rewards.find(reward => reward.rewardDay === DAY2)).toMatchObject({ status: 'DELIVERED', txHash: tx })
    expect(bank.pendingNim).toBe(100)
    expect(bank.deliveredNim).toBe(100)
    expect(bank.lifetimeEarnedNim).toBe(200)
    expect(bank.pendingCount).toBe(1)
    expect(bank.deliveredCount).toBe(1)
  })

  it('maps FAILED_FINAL and risk REVIEW to REVIEW without tx hash', () => {
    const bank = buildTreasureBank({
      claims: [
        claim({ claimId: 'c1', runId: 'r1', dayKey: DAY1 }),
        claim({ claimId: 'c2', runId: 'r2', dayKey: DAY2 }),
      ],
      payouts: [{ claimId: 'c1', status: 'FAILED_FINAL', amountLuna: 10_000_000n, txHash: null }],
      assessments: [{ runId: 'r2', result: 'REVIEW' }],
    })
    expect(bank.rewards.find(reward => reward.rewardDay === DAY1)).toMatchObject({ status: 'REVIEW', txHash: null })
    expect(bank.rewards.find(reward => reward.rewardDay === DAY2)).toMatchObject({ status: 'REVIEW', txHash: null })
    // Review rewards still count as pending (secured but not confirmed).
    expect(bank.pendingCount).toBe(2)
    expect(bank.pendingNim).toBe(200)
  })

  it('never exposes Luna or internal enums in the read model', () => {
    const bank = buildTreasureBank({
      claims: [claim({ claimId: 'c1', runId: 'r1' })],
      payouts: [{ claimId: 'c1', status: 'PENDING', amountLuna: 10_000_000n, txHash: null }],
    })
    const text = JSON.stringify(bank)
    expect(text).not.toMatch(/amountLuna|"RESERVED"|"PENDING"|"CONFIRMED"|treasury|install_id|risk_result|reason_codes/i)
    expect(text).toMatch(/SECURED/)
    for (const reward of bank.rewards) {
      expect(Object.keys(reward).sort()).toEqual(['amountNim', 'mission', 'missionLabel', 'rewardDay', 'status', 'txHash'])
    }
  })

  it('ignores non-RESERVED claims for lifetime earnings', () => {
    const bank = buildTreasureBank({
      claims: [
        claim({ claimId: 'c1', runId: 'r1', status: 'RESERVED' }),
        claim({ claimId: 'c2', runId: 'r2', status: 'SOLD_OUT' }),
        claim({ claimId: 'c3', runId: 'r3', status: 'ALREADY_REWARDED' }),
        claim({ claimId: 'c4', runId: 'r4', status: 'PREPARED' }),
      ],
      payouts: [],
    })
    expect(bank.rewards).toHaveLength(1)
    expect(bank.lifetimeEarnedNim).toBe(100)
  })

  it('returns an empty bank with zero totals', () => {
    const bank = buildTreasureBank({ claims: [], payouts: [] })
    expect(bank).toEqual({
      ok: true,
      pendingNim: 0,
      deliveredNim: 0,
      lifetimeEarnedNim: 0,
      pendingCount: 0,
      deliveredCount: 0,
      rewards: [],
    })
  })

  it('converts Luna to NIM without drift', () => {
    expect(lunaToNim(10_000_000n)).toBe(100)
    expect(lunaToNim('10000000')).toBe(100)
  })
})

describe('treasure bank amount-source safety', () => {
  it('resolves the fallback from the server reward configuration, not a UI constant', () => {
    // Production payout worker amount comes from NIMHUNT_REWARD_AMOUNT_LUNA.
    expect(resolveRewardFallbackAmountLuna({ NIMHUNT_REWARD_AMOUNT_LUNA: '10000000' })).toBe(10_000_000n)
    // Missing/invalid config falls back to the code default (100 NIM beta).
    expect(resolveRewardFallbackAmountLuna({})).toBe(BETA_REWARD_AMOUNT_LUNA)
    expect(resolveRewardFallbackAmountLuna({ NIMHUNT_REWARD_AMOUNT_LUNA: 'zero' })).toBe(BETA_REWARD_AMOUNT_LUNA)
    expect(resolveRewardFallbackAmountLuna({ NIMHUNT_REWARD_AMOUNT_LUNA: '0' })).toBe(BETA_REWARD_AMOUNT_LUNA)
  })

  it('prefers the frozen payout amount over the configured fallback', () => {
    const bank = buildTreasureBank({
      claims: [claim({ claimId: 'c1', runId: 'r1' })],
      payouts: [{ claimId: 'c1', status: 'CONFIRMED', amountLuna: 10_000_000n, txHash: 'ab'.repeat(32) }],
      fallbackAmountLuna: 5_000_000n,
    })
    // Frozen authoritative payout wins: 100 NIM delivered, not 50.
    expect(bank.deliveredNim).toBe(100)
    expect(bank.pendingNim).toBe(0)
  })

  it('uses the configured fallback for secured rewards without a payout row', () => {
    const bank = buildTreasureBank({
      claims: [claim({ claimId: 'c1', runId: 'r1' })],
      payouts: [],
      fallbackAmountLuna: resolveRewardFallbackAmountLuna({ NIMHUNT_REWARD_AMOUNT_LUNA: '10000000' }),
    })
    expect(bank.rewards[0]).toMatchObject({ status: 'SECURED', amountNim: 100 })
  })
})
