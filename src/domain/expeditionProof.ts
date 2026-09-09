import type { ExpeditionBlueprint, MissionType, RewardClaimPayload } from '../game/replay/types.ts'

export const START_CHALLENGE_PATH = '/api/expeditions/start-challenge'
export const START_EXPEDITION_PATH = '/api/expeditions/start'
export const CHECKPOINT_PATH = '/api/expeditions/checkpoint'
export const VERIFY_EXPEDITION_PATH = '/api/expeditions/verify'
export const ACTIVE_EXPEDITION_PATH = '/api/expeditions/active'
export const PRODUCT_VAULT_SEAL_PATH = '/api/expeditions/vault-seal'
export const PREPARE_REWARD_PATH = '/api/rewards/prepare'
export const CLAIM_REWARD_PATH = '/api/rewards/claim'

export type ExpeditionProofErrorCode =
  | 'MALFORMED_TRANSCRIPT'
  | 'ACTION_LIMIT_EXCEEDED'
  | 'INVALID_SEQUENCE'
  | 'INVALID_ACTION'
  | 'UNSUPPORTED_RULES_VERSION'
  | 'UNSUPPORTED_ROOM_VERSION'
  | 'UNSUPPORTED_BLUEPRINT_VERSION'
  | 'CHECKPOINT_MISMATCH'
  | 'PROOF_LOST'
  | 'DAILY_BLUEPRINT_UNAVAILABLE'
  | 'START_CHALLENGE_EXPIRED'
  | 'START_CHALLENGE_DAY_EXPIRED'
  | 'START_CHALLENGE_INVALID'
  | 'START_ALREADY_CREATED'
  | 'INVALID_SESSION'
  | 'SESSION_EXPIRED'
  | 'SESSION_REVOKED'
  | 'RUN_NOT_FOUND'
  | 'RUN_MISMATCH'
  | 'WALLET_MISMATCH'
  | 'RUN_NOT_ACTIVE'
  | 'INVALID_SIGNATURE'
  | 'ADDRESS_MISMATCH'
  | 'VAULT_SEAL_REQUIRED'
  | 'VAULT_SEAL_MISMATCH'
  | 'CLAIM_NOT_FOUND'
  | 'CLAIM_MISMATCH'
  | 'CLAIM_NOT_ELIGIBLE'
  | 'CLAIM_WINDOW_EXPIRED'
  | 'CLAIM_ALREADY_FINALIZED'
  | 'DAILY_EXPEDITION_LIMIT_REACHED'
  | 'BLUEPRINT_INVALID'
  | 'BLUEPRINT_IMMUTABLE'
  | 'BLUEPRINT_ALREADY_PUBLISHED'
  | 'BLUEPRINT_LIFECYCLE_INVALID'
  | 'PROOF_UNAVAILABLE'
  | 'SOLD_OUT'
  | 'ALREADY_REWARDED'

export type ProductGameplayState =
  | 'READY'
  | 'PLAYING'
  | 'MISSION_LOCAL_COMPLETE'
  | 'VAULT_REACHED'
  | 'FAILED'
  | 'ABANDONED'
  | 'ENDED'

export type ProductProofState =
  | 'NOT_APPLICABLE'
  | 'PROOF_ACTIVE'
  | 'CHECKPOINT_PENDING'
  | 'CHECKPOINT_SYNCED'
  | 'PROOF_LOST'
  | 'VERIFYING'
  | 'VERIFIED_ELIGIBLE'
  | 'CLAIM_PREPARED'
  | 'AWAITING_CLAIM_SIGNATURE'
  | 'CLAIM_VERIFYING'
  | 'RESERVED'
  | 'SOLD_OUT'
  | 'ALREADY_REWARDED'
  | 'CLAIM_WINDOW_EXPIRED'
  | 'REJECTED'

export type ProductReservationOutcome =
  | { readonly status: 'RESERVED'; readonly reservationNumber: number; readonly remainingSlots: number; readonly totalSlots: 69 }
  | { readonly status: 'SOLD_OUT' }
  | { readonly status: 'ALREADY_REWARDED' }
  | { readonly status: 'CLAIM_WINDOW_EXPIRED' }

export type StartChallengeResponse = {
  readonly challenge: string
  readonly blueprintId: string
  readonly blueprintHash: string
  readonly dayKey: string
  readonly expiresAt: string
}

export type StartResult = {
  readonly runId: string
  readonly runChallenge: string
  readonly attemptsRemaining: number
  readonly rulesVersion: string
  readonly roomVersion: string
  readonly blueprintVersion: string
  readonly blueprintId: string
  readonly blueprintHash: string
  readonly blueprint: ExpeditionBlueprint
  readonly dayKey: string
  readonly nextResetAt: string
}

export type PreparedClaim = {
  readonly claimId: string
  readonly payload: RewardClaimPayload
  readonly canonicalPayload: string
  readonly claimHash: string
  readonly state: 'PREPARED'
}

export type ProductExpeditionResult = {
  readonly mission: MissionType
  readonly gameplay: ProductGameplayState
  readonly proof: ProductProofState
  readonly reservation: ProductReservationOutcome | null
}
