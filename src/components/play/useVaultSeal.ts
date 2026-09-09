import { useCallback, useEffect, useReducer, useRef } from 'react'
import { buildVaultSealPayload, serializeVaultSeal } from '../../domain/vaultSeal'
import {
  detectNimiqPayHost,
  initializeNimiqProvider,
  listNimiqAccounts,
  signNimiqMessage,
} from '../../integrations/nimiq/nimiqClient'
import { normalizeNimiqError } from '../../integrations/nimiq/nimiqErrors'
import { requestDevSealVerification } from '../../integrations/nimiq/verifySealClient'
import { initialVaultSealState, reduceVaultSeal, type VaultSealState } from './vaultSeal'

/**
 * Product Vault Breaker seal flow. React owns every wallet interaction;
 * Phaser makes zero wallet calls. Nothing runs until the player taps
 * "Seal treasure": no account access, no provider init, no signature.
 */
export function useVaultSeal(): { seal: VaultSealState; sealTreasure: () => void } {
  const [seal, dispatch] = useReducer(reduceVaultSeal, initialVaultSealState)
  const statusRef = useRef(seal.status)
  const runRef = useRef(0)
  const mountedRef = useRef(true)

  useEffect(() => {
    statusRef.current = seal.status
  }, [seal.status])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      runRef.current += 1
    }
  }, [])

  const sealTreasure = useCallback(() => {
    const busy = statusRef.current === 'REQUESTING_ACCOUNT'
      || statusRef.current === 'AWAITING_SIGNATURE'
      || statusRef.current === 'VERIFYING'
    if (busy) return
    const runId = runRef.current + 1
    runRef.current = runId
    const alive = () => mountedRef.current && runRef.current === runId

    void (async () => {
      dispatch({ type: 'SEAL_REQUESTED' })

      if (!detectNimiqPayHost()) {
        if (alive()) dispatch({ type: 'PROVIDER_MISSING' })
        return
      }

      let provider
      try {
        provider = await initializeNimiqProvider()
      } catch (error) {
        if (!alive()) return
        const normalized = normalizeNimiqError(error, 'init')
        if (normalized.code === 'PROVIDER_UNAVAILABLE') dispatch({ type: 'PROVIDER_MISSING' })
        else dispatch({ type: 'ACCOUNT_FAILED', message: normalized.message })
        return
      }

      let wallet: string
      try {
        const accounts = await listNimiqAccounts(provider)
        wallet = accounts[0]
      } catch (error) {
        if (alive()) dispatch({ type: 'ACCOUNT_FAILED', message: normalizeNimiqError(error, 'account').message })
        return
      }
      if (!alive()) return
      dispatch({ type: 'ACCOUNT_RECEIVED', wallet })

      // The exact string shown is the exact string signed and verified.
      const message = serializeVaultSeal(buildVaultSealPayload(wallet))
      let publicKey: string
      let signature: string
      try {
        const signed = await signNimiqMessage(provider, message)
        publicKey = signed.publicKey
        signature = signed.signature
      } catch (error) {
        if (alive()) dispatch({ type: 'SIGNATURE_FAILED', message: normalizeNimiqError(error, 'sign').message })
        return
      }
      if (!alive()) return
      dispatch({ type: 'SIGNATURE_RECEIVED', proof: { publicKey, signature, message } })

      const result = await requestDevSealVerification({ payload: message, wallet, publicKey, signature })
      if (alive()) dispatch({ type: 'VERIFICATION_DONE', result })
    })()
  }, [])

  return { seal, sealTreasure }
}
