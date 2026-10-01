import { DAILY_REWARD_SLOTS } from '../../src/domain/dailyLedger.js'
import { createRewardPolicy, parsePositiveLuna } from '../rewards/policy.js'
import { ProofError } from './errors.js'

export function assertRewardTreasuryCap(
  env: Record<string, string | undefined> = process.env,
  at = new Date(),
): void {
  const economics = createRewardPolicy(env).resolveAt(at)
  let maxDaily = economics.maxDailyRewardLuna
  if (!economics.rewardWeekActive) {
    const rawMaxDaily = env.NIMHUNT_MAX_DAILY_REWARD_LUNA?.trim() ?? ''
    if (!rawMaxDaily) return
    maxDaily = parsePositiveLuna(rawMaxDaily)
    if (maxDaily === null) throw new ProofError('REWARD_UNAVAILABLE')
  }
  if (maxDaily === null) return
  const amount = economics.amountLuna
  if (amount === null || amount <= 0n) throw new ProofError('REWARD_UNAVAILABLE')
  if (amount * BigInt(DAILY_REWARD_SLOTS) > maxDaily) throw new ProofError('REWARD_UNAVAILABLE')
}
