import { describe, it, expect } from 'vitest'
import { createRewardPolicy } from './policy.ts'
import { readPayoutExecutionConfig, requireAutomaticPayoutConfig } from '../payouts/config.ts'
import { assertRewardTreasuryCap } from '../expeditions/treasuryCap.ts'

const env = { NIMHUNT_PERMANENT_REWARDS_STARTS_AT: '2026-10-10T00:00:00.000Z', NIMHUNT_REWARD_AMOUNT_LUNA: '100000000', NIMHUNT_MAX_DAILY_REWARD_LUNA: '700000000',
  NIMHUNT_REWARD_WEEK_ENABLED: 'true', NIMHUNT_REWARD_WEEK_STARTS_AT: '2026-10-02T00:00:00.000Z', NIMHUNT_REWARD_WEEK_ENDS_AT: '2026-10-09T00:00:00.000Z', NIMHUNT_REWARD_WEEK_AMOUNT_LUNA: '1449275', NIMHUNT_REWARD_WEEK_MAX_DAILY_REWARD_LUNA: '100000000' }
describe('permanent reward cutover', () => {
  it('enforces the exact automatic liability without creating or executing payouts', () => {
    const configured={...env,NIMHUNT_PAYOUT_NETWORK:'mainnet',NIMHUNT_ENABLE_MAINNET_PAYOUT:'true',NIMHUNT_AUTOMATIC_PAYOUTS_ENABLED:'true',NIMHUNT_TREASURY_MIN_RESERVE_LUNA:'10000000'}
    const at=new Date('2026-10-10T12:00:00.000Z')
    expect(requireAutomaticPayoutConfig(readPayoutExecutionConfig(configured),undefined,at)).toEqual({amountLuna:100_000_000n,maxDailyRewardLuna:700_000_000n,treasuryMinReserveLuna:10_000_000n})
    expect(()=>assertRewardTreasuryCap(configured,at)).not.toThrow()
    for(const cap of ['699999999','700000001']) {
      expect(()=>requireAutomaticPayoutConfig(readPayoutExecutionConfig({...configured,NIMHUNT_MAX_DAILY_REWARD_LUNA:cap}),undefined,at)).toThrow()
      expect(()=>assertRewardTreasuryCap({...configured,NIMHUNT_MAX_DAILY_REWARD_LUNA:cap},at)).toThrow('REWARD_UNAVAILABLE')
    }
    expect(requireAutomaticPayoutConfig(readPayoutExecutionConfig(configured),undefined,new Date('2026-10-09T12:00:00.000Z')).amountLuna).toBe(10_000_000n)
  })
  it('uses exactly seven immutable 1,000 NIM rewards from the configured UTC boundary', () => {
    const policy = createRewardPolicy(env)
    expect(policy.resolveForDay('2026-10-08').amountLuna).toBe(1_449_275n)
    expect(policy.resolveForDay('2026-10-09').amountLuna).toBe(10_000_000n)
    const next = policy.resolveForDay('2026-10-10')
    expect(next.totalSlots).toBe(7)
    expect(next.amountLuna).toBe(100_000_000n)
    expect(next.amountLuna! * BigInt(next.totalSlots)).toBe(700_000_000n)
    expect(next.maxDailyRewardLuna).toBe(700_000_000n)
    expect(policy.publicStatus(new Date('2026-10-10T00:00:00Z'))).toBeNull()
    expect(policy.resolveForDay('2026-10-08').amountLuna).toBe(1_449_275n)
  })
  it('fails closed for incorrect permanent amount, cap, or non-midnight cutover', () => {
    for (const override of [{ NIMHUNT_REWARD_AMOUNT_LUNA: '99999999' }, { NIMHUNT_MAX_DAILY_REWARD_LUNA: '699999999' }, { NIMHUNT_MAX_DAILY_REWARD_LUNA: '700000001' }]) {
      expect(createRewardPolicy({ ...env, ...override }).resolveForDay('2026-10-10').amountLuna).toBeNull()
    }
    expect(() => createRewardPolicy({ ...env, NIMHUNT_PERMANENT_REWARDS_STARTS_AT: '2026-10-10T12:00:00.000Z' })).toThrow('PERMANENT_REWARD_CUTOVER_INVALID')
  })
})
