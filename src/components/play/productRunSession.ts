import type { FinalizeRewardClaimResult, PrepareRewardClaimResult, VerifiedProductVaultSeal, VerifyExpeditionResult } from '../../domain/expeditionProof.ts'
import type { MissionType } from '../../game/domain/mission.ts'

export type RememberedRewardClaim = FinalizeRewardClaimResult | Extract<PrepareRewardClaimResult, { outcome: 'SOLD_OUT' | 'ALREADY_REWARDED' | 'RESERVED' }>

export type RememberedProductTerminal = {
  readonly runId: string
  readonly mission: MissionType
  readonly result: VerifyExpeditionResult
  readonly vaultSeal: VerifiedProductVaultSeal | null
  readonly rewardClaim: RememberedRewardClaim | null
}

let remembered: RememberedProductTerminal | null = null

export function rememberProductTerminal(mission: MissionType, result: VerifyExpeditionResult): void {
  if (result.outcome !== 'VERIFIED_ELIGIBLE' && result.outcome !== 'VAULT_GAMEPLAY_VERIFIED') return
  remembered = {
    runId: result.runId,
    mission,
    result,
    vaultSeal: remembered?.runId === result.runId ? remembered.vaultSeal : null,
    rewardClaim: remembered?.runId === result.runId ? remembered.rewardClaim : null,
  }
}

export function rememberProductVaultSeal(proof: VerifiedProductVaultSeal): void {
  if (!remembered || remembered.runId !== proof.runId) return
  remembered = { ...remembered, vaultSeal: proof }
}

const RESERVED_REWARD_KEY = 'nimhunt.reservedReward.v1'

export function rememberProductRewardClaim(result: RememberedRewardClaim): void {
  if (result.outcome === 'RESERVED') persistReservedRewardClaim(result.claimId)
  if (!remembered || remembered.runId !== result.runId) return
  remembered = { ...remembered, rewardClaim: result }
}

export function persistReservedRewardClaim(claimId: string): void {
  if (!claimId || claimId.length > 128) return
  try {
    sessionStorage.setItem(RESERVED_REWARD_KEY, JSON.stringify({ claimId }))
  } catch {
    /* ignore quota / private-mode failures */
  }
}

export function getPersistedReservedRewardClaim(): { readonly claimId: string } | null {
  try {
    const raw = sessionStorage.getItem(RESERVED_REWARD_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const claimId = (parsed as { claimId?: unknown }).claimId
    return typeof claimId === 'string' && claimId.length > 0 && claimId.length <= 128
      ? { claimId }
      : null
  } catch {
    return null
  }
}

export function getRememberedProductTerminal(mission: MissionType, runId: string): RememberedProductTerminal | null {
  if (!remembered || remembered.mission !== mission || remembered.runId !== runId) return null
  return remembered
}

export function retainProductTerminalFor(mission: MissionType, runId: string): void {
  if (!remembered) return
  if (remembered.mission !== mission || remembered.runId !== runId) remembered = null
}

export function clearRememberedProductTerminal(): void {
  remembered = null
}
