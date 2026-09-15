import type { VerifiedProductVaultSeal } from '../../domain/expeditionProof.ts'

export type ProductVaultSealStatus = 'IDLE' | 'SEALING' | 'VERIFIED' | 'CANCELLED' | 'REJECTED'

export type ProductVaultSealState = {
  readonly status: ProductVaultSealStatus
  readonly proof: VerifiedProductVaultSeal | null
  readonly error: string | null
}

export const initialProductVaultSealState: ProductVaultSealState = {
  status: 'IDLE',
  proof: null,
  error: null,
}

export type ProductVaultSealAction =
  | { readonly type: 'RESET'; readonly proof?: VerifiedProductVaultSeal | null }
  | { readonly type: 'SEAL_REQUESTED' }
  | { readonly type: 'SEAL_VERIFIED'; readonly proof: VerifiedProductVaultSeal }
  | { readonly type: 'SEAL_CANCELLED' }
  | { readonly type: 'SEAL_FAILED'; readonly message: string }

export function reduceProductVaultSeal(
  state: ProductVaultSealState,
  action: ProductVaultSealAction,
): ProductVaultSealState {
  switch (action.type) {
    case 'RESET':
      return action.proof
        ? { status: 'VERIFIED', proof: action.proof, error: null }
        : { ...initialProductVaultSealState }
    case 'SEAL_REQUESTED':
      if (state.status === 'SEALING' || state.status === 'VERIFIED') return state
      return { ...state, status: 'SEALING', error: null }
    case 'SEAL_VERIFIED':
      return { status: 'VERIFIED', proof: action.proof, error: null }
    case 'SEAL_CANCELLED':
      return { status: 'CANCELLED', proof: null, error: 'Signature request was cancelled.' }
    case 'SEAL_FAILED':
      return { status: 'REJECTED', proof: null, error: action.message }
  }
}

export function shortenNqWallet(wallet: string): string {
  const compact = wallet.replace(/\s+/g, '')
  if (compact.length <= 12) return wallet
  return `${compact.slice(0, 6)}…${compact.slice(-4)}`
}

export function shortenProofHash(hash: string): string {
  return /^[0-9a-f]{64}$/.test(hash) ? `${hash.slice(0, 8)}…` : hash
}
