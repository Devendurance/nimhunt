import { BETA_REWARD_AMOUNT_LUNA, LUNA_PER_NIM } from '../payouts/types.js'
import {
  TREASURE_BANK_MISSION_LABELS,
  type TreasureBankDisplayStatus,
  type TreasureBankMission,
  type TreasureBankResponse,
  type TreasureBankReward,
} from '../../src/domain/treasureBank.js'

export const TREASURE_BANK_ERRORS = ['MALFORMED_REQUEST', 'RUN_SESSION_INVALID', 'TREASURE_UNAVAILABLE'] as const
export type TreasureBankErrorCode = (typeof TREASURE_BANK_ERRORS)[number]

export class TreasureBankError extends Error {
  readonly code: TreasureBankErrorCode
  constructor(code: TreasureBankErrorCode) {
    super(code)
    this.name = 'TreasureBankError'
    this.code = code
  }
}

export type TreasureBankClaimRow = {
  readonly claimId: string
  readonly runId: string
  readonly wallet: string
  readonly mission: string
  readonly dayKey: string
  readonly status: string
  readonly finalizedAt: string | null
  readonly createdAt: string
}

export type TreasureBankPayoutRow = {
  readonly claimId: string
  readonly status: string
  readonly amountLuna: bigint | number | string
  readonly txHash: string | null
}

export type TreasureBankAssessmentRow = {
  readonly runId: string
  readonly result: string
}

export const BETA_REWARD_NIM: number = Number(BETA_REWARD_AMOUNT_LUNA / LUNA_PER_NIM)

/**
 * Authoritative fallback amount for SECURED rewards that have no frozen
 * payout row yet. Resolution order: explicit payout amount_luna (frozen per
 * payout) -> server reward configuration NIMHUNT_REWARD_AMOUNT_LUNA (the
 * same env the payout worker requires via requirePayoutAmountLuna) ->
 * BETA_REWARD_AMOUNT_LUNA code default. The Treasure Bank never invents an
 * amount independent of reward configuration.
 */
export function resolveRewardFallbackAmountLuna(
  env: Record<string, string | undefined> = process.env,
): bigint {
  const raw = env.NIMHUNT_REWARD_AMOUNT_LUNA?.trim() ?? ''
  if (/^[0-9]+$/.test(raw)) {
    try {
      const amount = BigInt(raw)
      if (amount > 0n) return amount
    } catch {
      // Fall through to the code default below.
    }
  }
  return BETA_REWARD_AMOUNT_LUNA
}

export function lunaToNim(amountLuna: bigint | number | string): number {
  const luna = typeof amountLuna === 'bigint' ? amountLuna : BigInt(amountLuna)
  if (luna <= 0n) throw new TreasureBankError('TREASURE_UNAVAILABLE')
  const whole = luna / LUNA_PER_NIM
  const remainder = luna % LUNA_PER_NIM
  if (remainder === 0n) return Number(whole)
  // Keep up to 5 decimals without float drift for non-round amounts.
  return Number(whole) + Number(remainder) / Number(LUNA_PER_NIM)
}

function asMission(mission: string): TreasureBankMission | null {
  return mission === 'gem-runner' || mission === 'chest-hunter' || mission === 'vault-breaker' ? mission : null
}

function asDisplayStatus(input: {
  readonly payoutStatus: string | null
  readonly assessment: string | null
}): TreasureBankDisplayStatus {
  const payout = input.payoutStatus
  const assessment = input.assessment
  if (payout === 'CONFIRMED') return 'DELIVERED'
  if (payout === 'SUBMITTED') return 'PROCESSING'
  if (payout === 'FAILED_FINAL') return 'REVIEW'
  if (assessment === 'REVIEW' || assessment === 'BLOCK') return 'REVIEW'
  return 'SECURED'
}

function safeTxHash(payout: TreasureBankPayoutRow | null, display: TreasureBankDisplayStatus): string | null {
  if (display !== 'DELIVERED' && display !== 'PROCESSING') return null
  if (!payout?.txHash || !/^[0-9a-f]{64}$/.test(payout.txHash)) return null
  return payout.txHash
}

export function buildTreasureBank(input: {
  readonly claims: readonly TreasureBankClaimRow[]
  readonly payouts: readonly TreasureBankPayoutRow[]
  readonly assessments?: readonly TreasureBankAssessmentRow[]
  /** Server reward-config fallback for SECURED rewards without a payout row. */
  readonly fallbackAmountLuna?: bigint
}): TreasureBankResponse {
  const fallbackNim = lunaToNim(input.fallbackAmountLuna ?? BETA_REWARD_AMOUNT_LUNA)
  const payoutsByClaim = new Map<string, TreasureBankPayoutRow>()
  for (const payout of input.payouts) {
    if (!payoutsByClaim.has(payout.claimId)) payoutsByClaim.set(payout.claimId, payout)
  }
  const assessmentsByRun = new Map<string, string>()
  for (const assessment of input.assessments ?? []) {
    if (!assessmentsByRun.has(assessment.runId)) assessmentsByRun.set(assessment.runId, assessment.result)
  }

  const rewards: TreasureBankReward[] = []
  for (const claim of input.claims) {
    // Only RESERVED claims are valid secured/delivered rewards. SOLD_OUT,
    // ALREADY_REWARDED, PREPARED, and EXPIRED never earn lifetime NIM.
    if (claim.status !== 'RESERVED') continue
    const mission = asMission(claim.mission)
    const rewardDay = claim.dayKey.slice(0, 10)
    if (!mission || !/^\d{4}-\d{2}-\d{2}$/.test(rewardDay)) continue
    const payout = payoutsByClaim.get(claim.claimId) ?? null
    const assessment = assessmentsByRun.get(claim.runId) ?? null
    const status = asDisplayStatus({
      payoutStatus: payout?.status ?? null,
      assessment,
    })
    let amountNim = fallbackNim
    if (payout) {
      try {
        amountNim = lunaToNim(payout.amountLuna)
      } catch {
        amountNim = fallbackNim
      }
    }
    rewards.push({
      rewardDay,
      mission,
      missionLabel: TREASURE_BANK_MISSION_LABELS[mission],
      amountNim,
      status,
      txHash: safeTxHash(payout, status),
    })
  }

  rewards.sort((left, right) => {
    if (left.rewardDay !== right.rewardDay) return left.rewardDay < right.rewardDay ? 1 : -1
    if (left.mission !== right.mission) return left.mission.localeCompare(right.mission)
    return 0
  })

  let pendingNim = 0
  let deliveredNim = 0
  let pendingCount = 0
  let deliveredCount = 0
  for (const reward of rewards) {
    if (reward.status === 'DELIVERED') {
      deliveredNim += reward.amountNim
      deliveredCount += 1
    } else {
      pendingNim += reward.amountNim
      pendingCount += 1
    }
  }

  return {
    ok: true,
    pendingNim,
    deliveredNim,
    lifetimeEarnedNim: pendingNim + deliveredNim,
    pendingCount,
    deliveredCount,
    rewards,
  }
}
