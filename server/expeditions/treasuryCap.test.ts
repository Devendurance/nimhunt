import { describe, expect, it } from 'vitest'
import { ProofError } from './errors.ts'
import { assertRewardTreasuryCap } from './treasuryCap.ts'

describe('reward treasury cap config', () => {
  it('fails closed when the configured daily cap cannot cover 69 rewards', () => {
    expect(() => assertRewardTreasuryCap({})).not.toThrow()
    expect(() => assertRewardTreasuryCap({
      NIMHUNT_REWARD_AMOUNT_LUNA: '100000',
    })).not.toThrow()
    expect(() => assertRewardTreasuryCap({
      NIMHUNT_REWARD_AMOUNT_LUNA: '100000',
      NIMHUNT_MAX_DAILY_REWARD_LUNA: '6900000',
    })).not.toThrow()
    expect(() => assertRewardTreasuryCap({
      NIMHUNT_REWARD_AMOUNT_LUNA: '100000',
      NIMHUNT_MAX_DAILY_REWARD_LUNA: '6899999',
    })).toThrow(ProofError)
    expect(() => assertRewardTreasuryCap({
      NIMHUNT_MAX_DAILY_REWARD_LUNA: '6900000',
    })).toThrowError(/REWARD_UNAVAILABLE/)
    expect(() => assertRewardTreasuryCap({
      NIMHUNT_REWARD_AMOUNT_LUNA: '10000000',
      NIMHUNT_MAX_DAILY_REWARD_LUNA: '690000000',
    })).not.toThrow()
  })
})
