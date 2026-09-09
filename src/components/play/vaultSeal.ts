import type { PlayerHUDState } from '../../game/events/gameEvents'
import type { VerifyTreasureSealReason, VerifyTreasureSealResult } from '../../integrations/nimiq/verifySealTypes'

export type VaultSealStatus =
  | 'UNSEALED'
  | 'REQUESTING_ACCOUNT'
  | 'AWAITING_SIGNATURE'
  | 'VERIFYING'
  | 'VERIFIED'
  | 'REJECTED'

export type VaultSealProof = {
  readonly publicKey: string
  readonly signature: string
  readonly message: string
}

export type VaultSealState = {
  readonly status: VaultSealStatus
  readonly wallet: string | null
  readonly proof: VaultSealProof | null
  readonly verification: VerifyTreasureSealResult | null
  readonly error: string | null
}

export const initialVaultSealState: VaultSealState = {
  status: 'UNSEALED',
  wallet: null,
  proof: null,
  verification: null,
  error: null,
}

export type VaultSealAction =
  | { readonly type: 'SEAL_REQUESTED' }
  | { readonly type: 'ACCOUNT_RECEIVED'; readonly wallet: string }
  | { readonly type: 'ACCOUNT_FAILED'; readonly message: string }
  | { readonly type: 'PROVIDER_MISSING' }
  | { readonly type: 'SIGNATURE_RECEIVED'; readonly proof: VaultSealProof }
  | { readonly type: 'SIGNATURE_FAILED'; readonly message: string }
  | { readonly type: 'VERIFICATION_DONE'; readonly result: VerifyTreasureSealResult }

export const VAULT_PROVIDER_FALLBACK = 'Open NimHunt inside Nimiq Pay to seal this treasure.'

export function reduceVaultSeal(state: VaultSealState, action: VaultSealAction): VaultSealState {
  switch (action.type) {
    case 'SEAL_REQUESTED':
      return { ...state, status: 'REQUESTING_ACCOUNT', verification: null, error: null }
    case 'ACCOUNT_RECEIVED':
      return { ...state, status: 'AWAITING_SIGNATURE', wallet: action.wallet, proof: null, error: null }
    case 'ACCOUNT_FAILED':
      return { ...state, status: 'UNSEALED', error: action.message }
    case 'PROVIDER_MISSING':
      return { ...state, status: 'UNSEALED', proof: null, error: VAULT_PROVIDER_FALLBACK }
    case 'SIGNATURE_RECEIVED':
      return { ...state, status: 'VERIFYING', proof: action.proof, error: null }
    case 'SIGNATURE_FAILED':
      return { ...state, status: 'UNSEALED', error: action.message }
    case 'VERIFICATION_DONE':
      if (action.result.valid) {
        return { ...state, status: 'VERIFIED', verification: action.result, error: null }
      }
      return { ...state, status: 'REJECTED', verification: action.result, error: null }
  }
}

type VaultHud = Pick<PlayerHUDState, 'objectiveReached' | 'hp' | 'runStatus'>

/** Stage 1 gate: the player is alive and playing on the Vault objective tile. */
export function shouldShowVaultOverlay(hud: VaultHud, mission: string): boolean {
  return mission === 'vault-breaker' && hud.objectiveReached && hud.hp > 0 && hud.runStatus === 'PLAYING'
}

/** Stage 2 gate: Vault reached alive plus a trusted verified seal. Never trust a client flag alone. */
export function isVaultBreakerComplete(input: { vaultReached: boolean; sealVerified: boolean }): boolean {
  return input.vaultReached && input.sealVerified
}

export function vaultRejectionCopy(reason: VerifyTreasureSealReason | undefined): string {
  switch (reason) {
    case 'INVALID_SIGNATURE':
      return 'The signature does not match this treasure.'
    case 'ADDRESS_MISMATCH':
      return 'The signing wallet does not match this expedition.'
    case 'REQUEST_FAILED':
      return 'Verification could not be reached. Check your connection and try again.'
    case 'INVALID_PUBLIC_KEY':
    case 'INVALID_WALLET':
    case 'MALFORMED_PAYLOAD':
    case 'PAYLOAD_TAMPERED':
      return 'The seal payload was malformed.'
    case 'UNSUPPORTED_MESSAGE_TYPE':
      return 'This seal type is not supported.'
    default:
      return 'The seal could not be verified.'
  }
}
