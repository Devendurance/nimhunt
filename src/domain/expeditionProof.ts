import type { ExpeditionBlueprint, ExpeditionCheckpoint, MissionType, MoveAction, ReplayState, RewardClaimPayload } from '../game/replay/types.ts'

export const START_CHALLENGE_PATH = '/api/expeditions/start-challenge'
export const START_EXPEDITION_PATH = '/api/expeditions/start'
export const CHECKPOINT_PATH = '/api/expeditions/checkpoint'
export const VERIFY_EXPEDITION_PATH = '/api/expeditions/verify'
export const ABANDON_EXPEDITION_PATH = '/api/expeditions/abandon'
export const ACTIVE_EXPEDITION_PATH = '/api/expeditions/active'
export const GAMEPLAY_START_PATH = '/api/expeditions/gameplay-start'
export const PRODUCT_VAULT_SEAL_PATH = '/api/expeditions/vault-seal'
export const PRODUCT_VAULT_SEAL_PREPARE_PATH = '/api/expeditions/vault-seal/prepare'
export const PRODUCT_VAULT_SEAL_VERIFY_PATH = '/api/expeditions/vault-seal/verify'
export const PREPARE_REWARD_PATH = '/api/rewards/prepare'
export const CLAIM_REWARD_PATH = '/api/rewards/claim'
export const PREPARE_REWARD_CLAIM_PATH = '/api/rewards/claim/prepare'
export const FINALIZE_REWARD_CLAIM_PATH = '/api/rewards/claim/finalize'
export const GET_REWARD_PAYOUT_PATH = '/api/rewards/claim/payout'

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
  | 'INVALID_WALLET'
  | 'MALFORMED_REQUEST'
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
  | 'RUN_SESSION_INVALID'
  | 'ACTIVE_RUN_UNAVAILABLE'
  | 'RUN_INCOMPLETE'

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
  | 'VAULT_GAMEPLAY_VERIFIED'
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
  readonly wallet: string
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

export type ProductActiveExpedition = {
  readonly runId: string
  readonly dayKey: string
  readonly mission: MissionType
  readonly status: 'STARTED'
  readonly startedAt: string
  readonly expiresAt: string
  readonly gameplayStartedAt: string | null
  readonly rulesVersion: string
  readonly roomVersion: string
  readonly blueprintVersion: string
  readonly blueprintId: string
  readonly blueprintHash: string
  readonly blueprint: ExpeditionBlueprint
  readonly state: ReplayState
  readonly checkpoint: ExpeditionCheckpoint
}

export type ProductGameplayStartResponse = {
  readonly runId: string
  readonly outcome: 'GAMEPLAY_STARTED' | 'GAMEPLAY_ALREADY_STARTED'
}

export type CheckpointMoveAction = MoveAction

export type CheckpointRequest = {
  readonly runId: string
  readonly previousCheckpointHash: string
  readonly actions: readonly CheckpointMoveAction[]
}

export type CheckpointProgress = {
  readonly acknowledgedSeq: number
  readonly checkpointHash: string
  readonly hp: number
  readonly gemsCollected: number
  readonly chestsOpened: number
  readonly hasTempleKey: boolean
  readonly objectiveReached: boolean
  readonly missionSatisfied: boolean
  readonly dead: boolean
}

export type CheckpointAcknowledgement = CheckpointProgress & {
  readonly runId: string
  readonly seqStart: number
  readonly seqEnd: number
  readonly previousCheckpointHash: string
  readonly transcriptHash: string
  readonly stateHash: string
  readonly batchFingerprint: string
}

export type VerifyExpeditionRequest = {
  readonly runId: string
  readonly checkpointHash: string
}

export type VerifyExpeditionOutcome = 'VERIFIED_ELIGIBLE' | 'VAULT_GAMEPLAY_VERIFIED' | 'FAILED'

export type TrustedFinalSummary = {
  readonly finalHp: number
  readonly gemsCollected: number
  readonly chestsOpened: number
  readonly objectiveReached: boolean
  readonly hasTempleKey: boolean
  readonly missionSatisfied: boolean
  readonly finalSeq: number
  readonly transcriptHash: string
  readonly stateHash: string
  readonly verifiedAt: string
}

export type VerifyExpeditionResult = TrustedFinalSummary & {
  readonly runId: string
  readonly checkpointHash: string
  readonly outcome: VerifyExpeditionOutcome
  readonly status: 'STARTED' | 'COMPLETED' | 'FAILED'
  readonly rewardStatus: 'NONE' | 'ELIGIBLE'
}

export type AbandonExpeditionResult = {
  readonly runId: string
  readonly checkpointHash: string
  readonly outcome: 'ABANDONED' | 'FAILED'
  readonly status: 'ABANDONED' | 'FAILED'
  readonly rewardStatus: 'NONE'
}

export type PreparedProductVaultSeal = {
  readonly runId: string
  readonly canonicalPayload: string
  readonly vaultSealHash: string
}

export type VerifiedProductVaultSeal = {
  readonly runId: string
  readonly wallet: string
  readonly canonicalPayload: string
  readonly vaultSealHash: string
  readonly publicKey: string
  readonly vaultCheckpointHash: string
  readonly verifiedAt: string
}

export type PreparedClaim = {
  readonly claimId: string
  readonly payload: RewardClaimPayload
  readonly canonicalPayload: string
  readonly claimHash: string
  readonly state: 'PREPARED'
}

export type PrepareRewardClaimResult =
  | {
      readonly outcome: 'PREPARED'
      readonly claimId: string
      readonly runId: string
      readonly canonicalPayload: string
      readonly claimPayloadHash: string
      readonly expiresAt: string
    }
  | {
      readonly outcome: 'SOLD_OUT' | 'ALREADY_REWARDED' | 'RESERVED'
      readonly claimId: string
      readonly runId: string
      readonly expiresAt: string
      readonly reservationNumber: number | null
      readonly remainingSlots: number | null
      readonly totalSlots: 69
    }

export type FinalizeRewardClaimResult = {
  readonly outcome: 'RESERVED' | 'SOLD_OUT' | 'ALREADY_REWARDED'
  readonly claimId: string
  readonly runId: string
  readonly reservationNumber: number | null
  readonly remainingSlots: number | null
  readonly totalSlots: 69
  readonly finalizedAt: string
}

export type ProductExpeditionResult = {
  readonly mission: MissionType
  readonly gameplay: ProductGameplayState
  readonly proof: ProductProofState
  readonly reservation: ProductReservationOutcome | null
}

export type RewardPayoutStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'SUBMITTED'
  | 'CONFIRMED'
  | 'FAILED_RETRYABLE'
  | 'FAILED_FINAL'

export type RewardPayoutNetwork = 'testnet' | 'mainnet'

export type RewardPayoutStatusResult = {
  readonly claimId: string
  readonly payout: {
    readonly payoutId: string
    readonly claimId: string
    readonly status: RewardPayoutStatus
    readonly amountLuna: string
    readonly network: RewardPayoutNetwork
    readonly txHashSafe: string | null
    readonly submittedAt: string | null
    readonly confirmedAt: string | null
  } | null
}
