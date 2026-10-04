import { describe, expect, it } from 'vitest'
import { createRewardPolicy, REWARD_WEEK_DURATION_MS } from './policy.ts'

const START = '2026-10-05T00:00:00.000Z'
const END = '2026-10-12T00:00:00.000Z'
const EVENT_AMOUNT = 1_449_275n
const EVENT_CAP = 100_000_000n

function env(overrides: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    NIMHUNT_REWARD_AMOUNT_LUNA: '10000000',
    NIMHUNT_MAX_DAILY_REWARD_LUNA: '690000000',
    NIMHUNT_REWARD_WEEK_ENABLED: 'true',
    NIMHUNT_REWARD_WEEK_STARTS_AT: START,
    NIMHUNT_REWARD_WEEK_ENDS_AT: END,
    NIMHUNT_REWARD_WEEK_AMOUNT_LUNA: EVENT_AMOUNT.toString(),
    NIMHUNT_REWARD_WEEK_MAX_DAILY_REWARD_LUNA: EVENT_CAP.toString(),
    ...overrides,
  }
}

describe('Reward Week policy', () => {
  it('uses baseline economics before the event', () => {
    const policy = createRewardPolicy(env())
    expect(policy.resolveAt(new Date('2026-10-04T23:59:59.999Z'))).toMatchObject({
      amountLuna: 10_000_000n,
      maxDailyRewardLuna: 690_000_000n,
      rewardWeekActive: false,
    })
  })

  it('activates at the exact UTC start boundary', () => {
    const policy = createRewardPolicy(env())
    expect(policy.resolveAt(new Date(START))).toMatchObject({
      amountLuna: EVENT_AMOUNT,
      maxDailyRewardLuna: EVENT_CAP,
      rewardWeekActive: true,
      rewardWeekEndsAt: END,
    })
  })

  it('uses event economics during the window and baseline at the exact end boundary', () => {
    const policy = createRewardPolicy(env())
    expect(policy.resolveAt(new Date('2026-10-08T12:34:56.000Z')).amountLuna).toBe(EVENT_AMOUNT)
    expect(policy.resolveAt(new Date(END))).toMatchObject({
      amountLuna: 10_000_000n,
      maxDailyRewardLuna: 690_000_000n,
      rewardWeekActive: false,
      rewardWeekEndsAt: null,
    })
  })

  it('is UTC-date deterministic for claim economics', () => {
    const policy = createRewardPolicy(env())
    expect(policy.resolveForDay('2026-10-04').amountLuna).toBe(10_000_000n)
    expect(policy.resolveForDay('2026-10-05').amountLuna).toBe(EVENT_AMOUNT)
    expect(policy.resolveForDay('2026-10-11').amountLuna).toBe(EVENT_AMOUNT)
    expect(policy.resolveForDay('2026-10-12').amountLuna).toBe(10_000_000n)
  })

  it('fails closed for malformed event configuration without overwriting baseline', () => {
    for (const overrides of [
      { NIMHUNT_REWARD_WEEK_STARTS_AT: '2026-10-05T00:00:00.001Z' },
      { NIMHUNT_REWARD_WEEK_ENDS_AT: '2026-10-13T00:00:00.000Z' },
      { NIMHUNT_REWARD_WEEK_AMOUNT_LUNA: 'not-luna' },
      { NIMHUNT_REWARD_WEEK_MAX_DAILY_REWARD_LUNA: '99999974' },
    ]) {
      const policy = createRewardPolicy(env(overrides))
      expect(policy.rewardWeek).toBeNull()
      expect(policy.publicStatus(new Date('2026-10-08T12:00:00.000Z'))).toBeNull()
      expect(policy.resolveAt(new Date('2026-10-08T12:00:00.000Z')).amountLuna).toBe(10_000_000n)
    }
  })

  it('requires exactly seven UTC days and never exceeds the event cap', () => {
    const policy = createRewardPolicy(env())
    const rewardWeek = policy.rewardWeek
    expect(rewardWeek).not.toBeNull()
    if (!rewardWeek) throw new Error('REWARD_WEEK_EXPECTED')
    expect(rewardWeek.endsAt.getTime() - rewardWeek.startsAt.getTime()).toBe(REWARD_WEEK_DURATION_MS)
    expect(EVENT_AMOUNT * 69n).toBe(99_999_975n)
    expect(EVENT_AMOUNT * 69n).toBeLessThanOrEqual(EVENT_CAP)
    expect(EVENT_AMOUNT * 69n * 7n).toBe(699_999_825n)
  })

  it('publishes no active UI state outside the same policy window', () => {
    const policy = createRewardPolicy(env())
    expect(policy.publicStatus(new Date('2026-10-04T23:59:59.999Z'))).toBeNull()
    expect(policy.publicStatus(new Date(START))).toEqual({ active: true, endsAt: END })
    expect(policy.publicStatus(new Date(END))).toBeNull()
  })
})
