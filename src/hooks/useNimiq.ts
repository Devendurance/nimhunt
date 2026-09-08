import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react'
import type { NimiqProvider } from '@nimiq/mini-app-sdk'
import { detectNimiqPayHost, initializeNimiqProvider, listNimiqAccounts, signNimiqMessage } from '../integrations/nimiq/nimiqClient'
import { logNimiqError, normalizeNimiqError, type NimiqIntegrationError } from '../integrations/nimiq/nimiqErrors'
import { initialNimiqState, reduceNimiqState } from '../integrations/nimiq/nimiqState'
import { buildTestTreasureSealPayload, serializeTestTreasureSeal, tamperTestSealMission } from '../integrations/nimiq/treasureSeal'
import { requestDevSealVerification } from '../integrations/nimiq/verifySealClient'

export function useNimiq() {
  const [state, dispatch] = useReducer(reduceNimiqState, initialNimiqState)
  const providerRef = useRef<NimiqProvider | null>(null)

  useEffect(() => {
    let cancelled = false

    if (!detectNimiqPayHost()) {
      dispatch({ type: 'HOST_UNAVAILABLE' })
      return
    }

    dispatch({ type: 'INIT_START' })
    initializeNimiqProvider()
      .then(provider => {
        if (cancelled) return
        providerRef.current = provider
        dispatch({ type: 'INIT_READY' })
      })
      .catch((error: unknown) => {
        if (cancelled) return
        reportError(normalizeNimiqError(error, 'init'), error => {
          dispatch({ type: 'INIT_ERROR', error })
        })
      })

    return () => {
      cancelled = true
    }
  }, [])

  const requestAccount = useCallback(async () => {
    const provider = providerRef.current
    if (!provider) {
      reportError(normalizeNimiqError(new Error('Provider is not ready.'), 'account'), error => {
        dispatch({ type: 'ACCOUNT_ERROR', error })
      })
      return
    }

    dispatch({ type: 'ACCOUNT_START' })
    try {
      const accounts = await listNimiqAccounts(provider)
      dispatch({ type: 'ACCOUNT_SUCCESS', address: accounts[0], accounts })
    } catch (error) {
      reportError(normalizeNimiqError(error, 'account'), normalized => {
        dispatch({ type: 'ACCOUNT_ERROR', error: normalized })
      })
    }
  }, [])

  const testPayload = useMemo(
    () => state.account ? buildTestTreasureSealPayload(state.account) : null,
    [state.account],
  )
  const testMessage = useMemo(
    () => testPayload ? serializeTestTreasureSeal(testPayload) : null,
    [testPayload],
  )

  const signTestSeal = useCallback(async () => {
    const provider = providerRef.current
    if (!provider || !state.account || !testPayload || !testMessage) {
      reportError(normalizeNimiqError(new Error('Account is required before signing.'), 'sign'), error => {
        dispatch({ type: 'SIGN_ERROR', error })
      })
      return
    }

    dispatch({ type: 'SIGN_START' })
    try {
      const signed = await signNimiqMessage(provider, testMessage)
      dispatch({
        type: 'SIGN_SUCCESS',
        proof: {
          publicKey: signed.publicKey,
          signature: signed.signature,
          message: testMessage,
          payload: testPayload,
          completedAt: new Date().toISOString(),
        },
      })
    } catch (error) {
      reportError(normalizeNimiqError(error, 'sign'), normalized => {
        dispatch({ type: 'SIGN_ERROR', error: normalized })
      })
    }
  }, [state.account, testMessage, testPayload])

  const verifySignedPayload = useCallback(async (payload: string) => {
    if (!state.account || !state.signature) {
      dispatch({
        type: 'VERIFY_REJECTED',
        result: { valid: false, signatureValid: false, addressMatches: false, reason: 'MALFORMED_PAYLOAD' },
      })
      return
    }

    dispatch({ type: 'VERIFY_START' })
    const result = await requestDevSealVerification({
      payload,
      wallet: state.account,
      publicKey: state.signature.publicKey,
      signature: state.signature.signature,
    })

    if (result.valid) dispatch({ type: 'VERIFY_SUCCESS', result })
    else dispatch({ type: 'VERIFY_REJECTED', result })
  }, [state.account, state.signature])

  const verifyTestSeal = useCallback(async () => {
    if (!state.signature) return
    await verifySignedPayload(state.signature.message)
  }, [state.signature, verifySignedPayload])

  const verifyTamperedSeal = useCallback(async () => {
    if (!state.signature) return
    await verifySignedPayload(tamperTestSealMission(state.signature.message))
  }, [state.signature, verifySignedPayload])

  return {
    ...state,
    testPayload,
    testMessage,
    requestAccount,
    signTestSeal,
    verifyTestSeal,
    verifyTamperedSeal,
  }
}

function reportError(
  error: NimiqIntegrationError,
  commit: (error: NimiqIntegrationError) => void,
): void {
  logNimiqError(error)
  commit(error)
}
