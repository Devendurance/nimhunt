import { useCallback, useEffect, useReducer, useRef } from 'react'
import {
  ExpeditionProofApiError,
  prepareProductVaultSeal,
  verifyProductVaultSeal,
} from '../../api/expeditionProof.ts'
import { initializeNimiqProvider, signNimiqMessage } from '../../integrations/nimiq/nimiqClient'
import { NimiqIntegrationError, normalizeNimiqError } from '../../integrations/nimiq/nimiqErrors'
import { getRememberedProductTerminal, rememberProductVaultSeal } from './productRunSession.ts'
import {
  initialProductVaultSealState,
  reduceProductVaultSeal,
  type ProductVaultSealState,
} from './productVaultSeal.ts'

export function useProductVaultSeal(options: {
  readonly enabled: boolean
  readonly runId: string | null
}): ProductVaultSealState & { sealTreasure: () => void } {
  const [state, dispatch] = useReducer(reduceProductVaultSeal, initialProductVaultSealState)
  const stateRef = useRef(state)
  const runRef = useRef(0)
  const mountedRef = useRef(true)
  const enabled = options.enabled && Boolean(options.runId)
  const runId = options.runId

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
    dispatch({ type: 'RESET', proof: getRememberedProductTerminal('vault-breaker', runId)?.vaultSeal ?? null })
  }, [enabled, runId])

  const sealTreasure = useCallback(() => {
    if (!enabled || !runId) return
    const busy = stateRef.current.status === 'SEALING' || stateRef.current.status === 'VERIFIED'
    if (busy) return
    const token = runRef.current + 1
    runRef.current = token
    const alive = () => mountedRef.current && runRef.current === token

    void (async () => {
      dispatch({ type: 'SEAL_REQUESTED' })
      try {
        const prepared = await prepareProductVaultSeal(runId)
        if (!alive()) return
        const provider = await initializeNimiqProvider()
        if (!alive()) return
        const signed = await signNimiqMessage(provider, prepared.canonicalPayload)
        if (!alive()) return
        const proof = await verifyProductVaultSeal({
          payload: prepared.canonicalPayload,
          publicKey: signed.publicKey,
          signature: signed.signature,
        })
        if (!alive()) return
        rememberProductVaultSeal(proof)
        dispatch({ type: 'SEAL_VERIFIED', proof })
      } catch (error) {
        if (!alive()) return
        if (isCancellation(error)) {
          dispatch({ type: 'SEAL_CANCELLED' })
          return
        }
        dispatch({ type: 'SEAL_FAILED', message: failureCopy(error) })
      }
    })()
  }, [enabled, runId])

  return { ...state, sealTreasure }
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
    if (error.code === 'INVALID_SIGNATURE') return 'The signature does not match this treasure.'
    if (error.code === 'ADDRESS_MISMATCH' || error.code === 'WALLET_MISMATCH') {
      return 'The signing wallet does not match this expedition.'
    }
    if (error.code === 'NETWORK_ERROR' || error.code === 'PROOF_UNAVAILABLE') {
      return 'Verification could not be reached. Check your connection and try again.'
    }
    return 'The seal could not be verified.'
  }
  if (error instanceof NimiqIntegrationError) return error.message
  return 'The seal could not be verified.'
}
