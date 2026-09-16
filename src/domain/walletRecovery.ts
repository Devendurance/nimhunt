export const WALLET_RECOVERY_VERSION = 1 as const
export const WALLET_RECOVERY_TYPE = 'NIMHUNT_RECOVER_SESSION_V1' as const
export const WALLET_RECOVERY_PURPOSE = 'reward/daily-state recovery' as const

export const RECOVER_SESSION_CHALLENGE_PATH = '/api/wallet/recover-challenge'
export const RECOVER_SESSION_PATH = '/api/wallet/recover-session'

export type WalletRecoveryPayload = {
  readonly version: typeof WALLET_RECOVERY_VERSION
  readonly type: typeof WALLET_RECOVERY_TYPE
  readonly wallet: string
  readonly challenge: string
  readonly issuedAt: string
  readonly expiresAt: string
  readonly purpose: typeof WALLET_RECOVERY_PURPOSE
}

export type WalletRecoveryChallengeResponse = {
  readonly wallet: string
  readonly challenge: string
  readonly issuedAt: string
  readonly expiresAt: string
  readonly purpose: typeof WALLET_RECOVERY_PURPOSE
}

export function serializeWalletRecoveryPayload(payload: WalletRecoveryPayload): string {
  return JSON.stringify({
    version: payload.version,
    type: payload.type,
    wallet: payload.wallet,
    challenge: payload.challenge,
    issuedAt: payload.issuedAt,
    expiresAt: payload.expiresAt,
    purpose: payload.purpose,
  }, null, 2)
}
