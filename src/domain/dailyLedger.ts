export const DAILY_REWARD_SLOTS = 69
export const DAILY_EXPEDITION_LIMIT = 3
export const DAILY_REWARD_LIMIT_PER_WALLET = 1

export const DAILY_HUNT_STATUS_PATH = '/api/daily-hunt-status'
export const WALLET_DAILY_STATUS_PATH = '/api/wallet-daily-status'
export const START_EXPEDITION_PATH = '/api/expeditions/start'
export const START_CHALLENGE_PATH = '/api/expeditions/start-challenge'
export const CHECKPOINT_PATH = '/api/expeditions/checkpoint'
export const VERIFY_EXPEDITION_PATH = '/api/expeditions/verify'
export const ACTIVE_EXPEDITION_PATH = '/api/expeditions/active'
export const PRODUCT_VAULT_SEAL_PATH = '/api/expeditions/vault-seal'
export const PRODUCT_VAULT_SEAL_PREPARE_PATH = '/api/expeditions/vault-seal/prepare'
export const PRODUCT_VAULT_SEAL_VERIFY_PATH = '/api/expeditions/vault-seal/verify'
export const PREPARE_REWARD_PATH = '/api/rewards/prepare'
export const CLAIM_REWARD_PATH = '/api/rewards/claim'
export const COMPLETE_EXPEDITION_PATH = '/api/expeditions/complete'
export const FAIL_EXPEDITION_PATH = '/api/expeditions/fail'
export const ABANDON_EXPEDITION_PATH = '/api/expeditions/abandon'
export const RESERVE_REWARD_PATH = '/api/rewards/reserve'

export type DailyMissionType = 'gem-runner' | 'chest-hunter' | 'vault-breaker'

export type ExpeditionRunStatus = 'STARTED' | 'COMPLETED' | 'FAILED' | 'ABANDONED'

export type ExpeditionRewardStatus = 'NONE' | 'ELIGIBLE' | 'RESERVED' | 'SOLD_OUT' | 'ALREADY_REWARDED'

export type LedgerErrorCode =
  | 'DAILY_EXPEDITION_LIMIT_REACHED'
  | 'UNKNOWN_MISSION_TYPE'
  | 'INVALID_WALLET'
  | 'INVALID_RUN_ID'
  | 'RUN_NOT_FOUND'
  | 'WALLET_MISMATCH'
  | 'INVALID_RUN_TRANSITION'
  | 'RUN_NOT_COMPLETED'
  | 'ALREADY_REWARDED'
  | 'SOLD_OUT'
  | 'LEDGER_UNAVAILABLE'
  | 'MALFORMED_REQUEST'

export type DailyHuntStatus = {
  totalSlots: number
  reservedSlots: number
  remainingSlots: number
  dayKey: string
  nextResetAt: string
}

export type WalletDailyStatus = {
  dayKey: string
  expeditionsStarted: number
  expeditionsRemaining: number
  rewardAlreadyReserved: boolean
  nextResetAt: string
}

export type StartExpeditionResult = {
  runId: string
  attemptsUsed: number
  attemptsRemaining: number
  dayKey: string
  nextResetAt: string
}

export type ReserveDailyRewardResult = {
  reserved: true
  reservationNumber: number
  remainingSlots: number
  totalSlots: number
}

/**
 * COMPLETED is accounting state only in this milestone.
 * A client-reported gameplay completion is not sufficient proof for NIM payout.
 */
export const LEDGER_TRUST_BOUNDARY =
  'COMPLETED is an accounting flag only. It does not prove skill-task completion and must not trigger NIM transfer.'
