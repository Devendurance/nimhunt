import { DAILY_REWARD_SLOTS } from '../../src/domain/dailyLedger.js'
import { BETA_REWARD_AMOUNT_LUNA } from '../payouts/types.js'

export const REWARD_WEEK_DURATION_MS = 7 * 24 * 60 * 60 * 1000
export const REWARD_WEEK_ENABLED_ENV = 'NIMHUNT_REWARD_WEEK_ENABLED'
export const REWARD_WEEK_STARTS_AT_ENV = 'NIMHUNT_REWARD_WEEK_STARTS_AT'
export const REWARD_WEEK_ENDS_AT_ENV = 'NIMHUNT_REWARD_WEEK_ENDS_AT'
export const REWARD_WEEK_AMOUNT_LUNA_ENV = 'NIMHUNT_REWARD_WEEK_AMOUNT_LUNA'
export const REWARD_WEEK_MAX_DAILY_REWARD_LUNA_ENV = 'NIMHUNT_REWARD_WEEK_MAX_DAILY_REWARD_LUNA'

export type RewardWeekPublicStatus = {
  readonly active: true
  readonly endsAt: string
}

export type RewardEconomics = {
  readonly amountLuna: bigint | null
  readonly maxDailyRewardLuna: bigint | null
  readonly rewardWeekActive: boolean
  readonly rewardWeekEndsAt: string | null
}

export type RewardWeekConfig = {
  readonly startsAt: Date
  readonly endsAt: Date
  readonly amountLuna: bigint
  readonly maxDailyRewardLuna: bigint
}

export type RewardPolicy = {
  readonly baseline: {
    readonly amountLuna: bigint | null
    readonly maxDailyRewardLuna: bigint | null
  }
  readonly rewardWeek: RewardWeekConfig | null
  resolveAt(at: Date): RewardEconomics
  resolveForDay(dayKey: string): RewardEconomics
  publicStatus(at: Date): RewardWeekPublicStatus | null
}

export function createRewardPolicy(
  env: Record<string, string | undefined> = process.env,
): RewardPolicy {
  const baseline = {
    amountLuna: parseBaselineAmount(env.NIMHUNT_REWARD_AMOUNT_LUNA),
    maxDailyRewardLuna: parseLuna(env.NIMHUNT_MAX_DAILY_REWARD_LUNA),
  }
  const rewardWeek = parseRewardWeekConfig(env)
  const resolveAt = (at: Date): RewardEconomics => {
    const time = at.getTime()
    if (rewardWeek && time >= rewardWeek.startsAt.getTime() && time < rewardWeek.endsAt.getTime()) {
      return {
        amountLuna: rewardWeek.amountLuna,
        maxDailyRewardLuna: rewardWeek.maxDailyRewardLuna,
        rewardWeekActive: true,
        rewardWeekEndsAt: rewardWeek.endsAt.toISOString(),
      }
    }
    return {
      amountLuna: baseline.amountLuna,
      maxDailyRewardLuna: baseline.maxDailyRewardLuna,
      rewardWeekActive: false,
      rewardWeekEndsAt: null,
    }
  }

  return {
    baseline,
    rewardWeek,
    resolveAt,
    resolveForDay(dayKey) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) return resolveAt(new Date(Number.NaN))
      // Reward Week activation is deliberately restricted to UTC day boundaries.
      // The immutable claim day can therefore resolve the amount even after expiry.
      return resolveAt(new Date(`${dayKey}T12:00:00.000Z`))
    },
    publicStatus(at) {
      const economics = resolveAt(at)
      return economics.rewardWeekActive && economics.rewardWeekEndsAt
        ? { active: true, endsAt: economics.rewardWeekEndsAt }
        : null
    },
  }
}

export function parseRewardWeekConfig(
  env: Record<string, string | undefined>,
): RewardWeekConfig | null {
  if (env[REWARD_WEEK_ENABLED_ENV]?.trim() !== 'true') return null

  const startsAt = parseUtcMidnight(env[REWARD_WEEK_STARTS_AT_ENV])
  const endsAt = parseUtcMidnight(env[REWARD_WEEK_ENDS_AT_ENV])
  const amountLuna = parseLuna(env[REWARD_WEEK_AMOUNT_LUNA_ENV])
  const maxDailyRewardLuna = parseLuna(env[REWARD_WEEK_MAX_DAILY_REWARD_LUNA_ENV])
  if (!startsAt || !endsAt || !amountLuna || !maxDailyRewardLuna) return null
  if (endsAt.getTime() - startsAt.getTime() !== REWARD_WEEK_DURATION_MS) return null
  if (amountLuna * BigInt(DAILY_REWARD_SLOTS) > maxDailyRewardLuna) return null

  return { startsAt, endsAt, amountLuna, maxDailyRewardLuna }
}

export function parsePositiveLuna(value: string | undefined): bigint | null {
  const raw = value?.trim() ?? ''
  if (!/^[0-9]+$/.test(raw)) return null
  try {
    const amount = BigInt(raw)
    return amount > 0n ? amount : null
  } catch {
    return null
  }
}

function parseBaselineAmount(value: string | undefined): bigint | null {
  if (!value?.trim()) return BETA_REWARD_AMOUNT_LUNA
  return parseLuna(value)
}

function parseLuna(value: string | undefined): bigint | null {
  return parsePositiveLuna(value)
}

function parseUtcMidnight(value: string | undefined): Date | null {
  const raw = value?.trim() ?? ''
  if (!/^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$/.test(raw)) return null
  const parsed = new Date(raw)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== raw) return null
  return parsed
}
