import { DAILY_REWARD_SLOTS } from '../../src/domain/dailyLedger.js'
import { BETA_REWARD_AMOUNT_LUNA } from '../payouts/types.js'

export const PERMANENT_AMOUNT_LUNA = 100_000_000n
export const PERMANENT_DAILY_CAP_LUNA = 700_000_000n
export const LEGACY_DAILY_REWARD_SLOTS = 69
export const PERMANENT_START_ENV = 'NIMHUNT_PERMANENT_REWARDS_STARTS_AT'

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
  readonly totalSlots: number
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
  readonly permanentStartsAt: Date
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
  // Explicit boundary is required for the production rollout. Legacy configured
  // installations keep their economics until that boundary is supplied.
  const legacyConfigured = env.NIMHUNT_REWARD_AMOUNT_LUNA?.trim() && env.NIMHUNT_REWARD_AMOUNT_LUNA?.trim() !== PERMANENT_AMOUNT_LUNA.toString()
  const startsRaw = env[PERMANENT_START_ENV]
  const permanentStartsAt = startsRaw ? parseUtcMidnight(startsRaw) : new Date(legacyConfigured || rewardWeek ? '9999-01-01T00:00:00.000Z' : '1970-01-01T00:00:00.000Z')
  if (!permanentStartsAt) throw new Error('PERMANENT_REWARD_CUTOVER_INVALID')
  const resolveAt = (at: Date): RewardEconomics => {
    const time = at.getTime()
    if (time >= permanentStartsAt.getTime()) {
      const amount = env.NIMHUNT_REWARD_AMOUNT_LUNA?.trim() ? parseLuna(env.NIMHUNT_REWARD_AMOUNT_LUNA) : PERMANENT_AMOUNT_LUNA
      const cap = env.NIMHUNT_MAX_DAILY_REWARD_LUNA?.trim() ? parseLuna(env.NIMHUNT_MAX_DAILY_REWARD_LUNA) : PERMANENT_DAILY_CAP_LUNA
      const valid = amount === PERMANENT_AMOUNT_LUNA && cap === PERMANENT_DAILY_CAP_LUNA
      return { amountLuna: valid ? amount : null, maxDailyRewardLuna: valid ? cap : null,
        rewardWeekActive: false, rewardWeekEndsAt: null, totalSlots: DAILY_REWARD_SLOTS }
    }
    if (rewardWeek && time >= rewardWeek.startsAt.getTime() && time < rewardWeek.endsAt.getTime()) {
      return {
        amountLuna: rewardWeek.amountLuna,
        maxDailyRewardLuna: rewardWeek.maxDailyRewardLuna,
        rewardWeekActive: true,
        totalSlots: LEGACY_DAILY_REWARD_SLOTS,
        rewardWeekEndsAt: rewardWeek.endsAt.toISOString(),
      }
    }
    return {
      amountLuna: startsRaw ? BETA_REWARD_AMOUNT_LUNA : baseline.amountLuna,
      maxDailyRewardLuna: baseline.maxDailyRewardLuna,
      rewardWeekActive: false,
      totalSlots: LEGACY_DAILY_REWARD_SLOTS,
      rewardWeekEndsAt: null,
    }
  }

  return {
    baseline,
    rewardWeek,
    permanentStartsAt,
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
  if (amountLuna * BigInt(LEGACY_DAILY_REWARD_SLOTS) > maxDailyRewardLuna) return null

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
