import { useCallback, useEffect, useReducer, useRef } from 'react'
import {
  ExpeditionProofApiError,
  finalizeRewardClaim,
  prepareRewardClaim,
} from '../../api/expeditionProof.ts'
import { initializeNimiqProvider, signNimiqMessage } from '../../integrations/nimiq/nimiqClient'
import { NimiqIntegrationError, normalizeNimiqError } from '../../integrations/nimiq/nimiqErrors'
import { getRememberedProductTerminal, rememberProductRewardClaim } from './productRunSession.ts'
import {
  initialProductRewardClaimState,
  reduceProductRewardClaim,
  type ProductRewardClaimState,
} from './productRewardClaim.ts'

export function useProductRewardClaim(options: {
  readonly enabled: boolean
  readonly mission: 'gem-runner' | 'chest-hunter' | 'vault-breaker' | null
  readonly runId: string | null
}): ProductRewardClaimState & { claimTreasure: () => void } {
  const [state, dispatch] = useReducer(reduceProductRewardClaim, initialProductRewardClaimState)
  const stateRef = useRef(state)
  const runRef = useRef(0)
  const mountedRef = useRef(true)
  const enabled = options.enabled && Boolean(options.runId) && Boolean(options.mission)
  const runId = options.runId
  const mission = options.mission

  useEffect(() => {
    stateRef.current = state
  }, [state])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      runRef.current += 1
    }
  }, [])

  useEffect(() => {
    if (!enabled || !runId) {
      dispatch({ type: 'RESET' })
      return
    }
    dispatch({ type: 'RESET', result: mission ? getRememberedProductTerminal(mission, runId)?.rewardClaim ?? null : null })
  }, [enabled, mission, runId])

  const claimTreasure = useCallback(() => {
    if (!enabled || !runId) return
    const current = stateRef.current
    const sessionRetryable = current.status === 'BLOCK'
      && current.result !== null
      && 'reasonCategory' in current.result
      && current.result.reasonCategory === 'SESSION'
    const busy = current.status === 'SIGNING'
      || current.status === 'RESERVED'
      || current.status === 'SOLD_OUT'
      || current.status === 'ALREADY_REWARDED'
      || current.status === 'REVIEW'
      || (current.status === 'BLOCK' && !sessionRetryable)
    if (busy) return
    const token = runRef.current + 1
    runRef.current = token
    const alive = () => mountedRef.current && runRef.current === token

    void (async () => {
      dispatch({ type: 'CLAIM_REQUESTED' })
      try {
        const prepared = await prepareRewardClaim(runId)
        if (!alive()) return
        if (prepared.outcome !== 'PREPARED') {
          if (prepared.outcome === 'RESERVED' || prepared.outcome === 'SOLD_OUT' || prepared.outcome === 'ALREADY_REWARDED') {
            rememberProductRewardClaim(prepared)
          }
          dispatch({ type: 'CLAIM_PREPARED_TERMINAL', result: prepared })
          return
        }
        const provider = await initializeNimiqProvider()
        if (!alive()) return
        const signed = await signNimiqMessage(provider, prepared.canonicalPayload)
        if (!alive()) return
        const result = await finalizeRewardClaim({
          claimId: prepared.claimId,
          payload: prepared.canonicalPayload,
          publicKey: signed.publicKey,
          signature: signed.signature,
        })
        if (!alive()) return
        rememberProductRewardClaim(result)
        dispatch({ type: 'CLAIM_FINALIZED', result })
      } catch (error) {
        if (!alive()) return
        if (isCancellation(error)) {
          dispatch({ type: 'CLAIM_CANCELLED' })
          return
        }
        dispatch({ type: 'CLAIM_FAILED', message: failureCopy(error) })
      }
    })()
  }, [enabled, runId])

  return { ...state, claimTreasure }
}

function isCancellation(error: unknown): boolean {
  if (error instanceof ExpeditionProofApiError) return false
  if (error instanceof NimiqIntegrationError) {
    return error.code === 'SIGN_CANCELLED' || error.code === 'ACCOUNT_CANCELLED'
  }
  return normalizeNimiqError(error, 'sign').code === 'SIGN_CANCELLED'
}

function failureCopy(error: unknown): string {
  if (error instanceof ExpeditionProofApiError) {
    if (error.code === 'INVALID_SIGNATURE') return 'The signature does not match this claim.'
    if (error.code === 'ADDRESS_MISMATCH' || error.code === 'WALLET_MISMATCH') {
      return 'The signing wallet does not match this expedition.'
    }
    if (error.code === 'CLAIM_WINDOW_EXPIRED') return "Today's claim window has closed."
    if (error.code === 'CLAIM_NOT_ELIGIBLE') return 'This expedition is not eligible for a reward claim.'
    if (error.code === 'RATE_LIMITED') return 'Too many reward requests. Please wait a moment and try again.'
    if (error.code === 'REWARD_UNAVAILABLE') return 'Rewards are temporarily unavailable.'
    if (error.code === 'NETWORK_ERROR' || error.code === 'PROOF_UNAVAILABLE') {
      return 'The claim could not be reached. Check your connection and try again.'
    }
    return 'The reward claim could not be reserved.'
  }
  if (error instanceof NimiqIntegrationError) return error.message
  return 'The reward claim could not be reserved.'
}
