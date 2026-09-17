import type { FinalizeRewardClaimResult, PrepareRewardClaimResult } from '../../domain/expeditionProof.ts'

export type ProductRewardClaimStatus =
  | 'IDLE'
  | 'SIGNING'
  | 'RESERVED'
  | 'SOLD_OUT'
  | 'ALREADY_REWARDED'
  | 'REVIEW'
  | 'BLOCK'
  | 'CANCELLED'
  | 'REJECTED'

export type ProductRewardClaimState = {
  readonly status: ProductRewardClaimStatus
  readonly result: FinalizeRewardClaimResult | Extract<PrepareRewardClaimResult, { outcome: 'SOLD_OUT' | 'ALREADY_REWARDED' | 'RESERVED' | 'REVIEW' | 'BLOCK' }> | null
  readonly error: string | null
}

export const initialProductRewardClaimState: ProductRewardClaimState = {
  status: 'IDLE',
  result: null,
  error: null,
}

export type ProductRewardClaimAction =
  | { readonly type: 'RESET'; readonly result?: ProductRewardClaimState['result'] }
  | { readonly type: 'CLAIM_REQUESTED' }
  | { readonly type: 'CLAIM_PREPARED_TERMINAL'; readonly result: Extract<PrepareRewardClaimResult, { outcome: 'SOLD_OUT' | 'ALREADY_REWARDED' | 'RESERVED' | 'REVIEW' | 'BLOCK' }> }
  | { readonly type: 'CLAIM_FINALIZED'; readonly result: FinalizeRewardClaimResult }
  | { readonly type: 'CLAIM_CANCELLED' }
  | { readonly type: 'CLAIM_FAILED'; readonly message: string }

export function reduceProductRewardClaim(
  state: ProductRewardClaimState,
  action: ProductRewardClaimAction,
): ProductRewardClaimState {
  switch (action.type) {
    case 'RESET':
      return action.result
        ? { status: action.result.outcome, result: action.result, error: null }
        : { ...initialProductRewardClaimState }
    case 'CLAIM_REQUESTED':
      if (state.status === 'SIGNING' || state.status === 'RESERVED' || state.status === 'SOLD_OUT' || state.status === 'ALREADY_REWARDED' || state.status === 'REVIEW' || state.status === 'BLOCK') {
        return state
      }
      return { ...state, status: 'SIGNING', error: null }
    case 'CLAIM_PREPARED_TERMINAL':
      return { status: action.result.outcome, result: action.result, error: null }
    case 'CLAIM_FINALIZED':
      return { status: action.result.outcome, result: action.result, error: null }
    case 'CLAIM_CANCELLED':
      return { status: 'CANCELLED', result: null, error: 'Signature request was cancelled.' }
    case 'CLAIM_FAILED':
      return { status: 'REJECTED', result: null, error: action.message }
  }
}
