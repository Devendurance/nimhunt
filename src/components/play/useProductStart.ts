import { useCallback, useEffect, useReducer, useRef } from 'react'
import type { NimiqProvider } from '@nimiq/mini-app-sdk'
import {
  authorizeStart,
  ExpeditionProofApiError,
  requestStartChallenge,
  type ProductStartResult,
  type SignedStartRequest,
} from '../../api/expeditionProof.ts'
import { serializeStartPayload, START_EXPEDITION_TYPE, START_EXPEDITION_VERSION, type StartExpeditionPayload } from '../../domain/startAuthorization.ts'
import { initializeNimiqProvider, listNimiqAccounts, signNimiqMessage } from '../../integrations/nimiq/nimiqClient'
import { NimiqIntegrationError } from '../../integrations/nimiq/nimiqErrors'
import type { MissionType } from '../../game/replay/types.ts'
import {
  canBeginProductStart,
  createProductStartAttemptGuard,
  isFlowActive,
  reduceProductStart,
  INITIAL_PRODUCT_START_STATE,
  type ProductStartErrorCode,
} from './productStart.ts'

type ProductStartHookOptions = {
  readonly onStarted?: (start: ProductStartResult, normalizedWallet: string) => void
}

export function useProductStart({ onStarted }: ProductStartHookOptions = {}) {
  const [state, dispatch] = useReducer(reduceProductStart, INITIAL_PRODUCT_START_STATE)
  const providerRef = useRef<NimiqProvider | null>(null)
  const mountedRef = useRef(true)
  const guardRef = useRef(createProductStartAttemptGuard())
  const activeTokenRef = useRef<number | null>(null)
  const startedAtRef = useRef(0)
  const onStartedRef = useRef(onStarted)
  const notifiedTokenRef = useRef<number | null>(null)

  useEffect(() => {
    onStartedRef.current = onStarted
  }, [onStarted])

  useEffect(() => {
    mountedRef.current = true
    const guard = guardRef.current
    return () => {
      mountedRef.current = false
      guard.invalidate()
      activeTokenRef.current = null
    }
  }, [])

  const isCurrent = useCallback((token: number): boolean => {
    return mountedRef.current && activeTokenRef.current === token && guardRef.current.isCurrent(token)
  }, [])

  const invalidate = useCallback(() => {
    guardRef.current.invalidate()
    activeTokenRef.current = null
  }, [])

  const fail = useCallback((token: number, status: 'LIMIT_REACHED' | 'BLUEPRINT_UNAVAILABLE' | 'PROOF_UNAVAILABLE' | 'REJECTED', errorCode: ProductStartErrorCode) => {
    if (!isCurrent(token)) return
    dispatch({ type: 'FAILURE', status, errorCode })
    invalidate()
  }, [invalidate, isCurrent])

  const cancelFlow = useCallback(() => {
    if (!isFlowActive(state.status)) return
    invalidate()
    dispatch({ type: 'CANCEL' })
  }, [invalidate, state.status])

  const requestChallengeFor = useCallback(async (token: number, account: string, mission: MissionType) => {
    try {
      traceProductStartBoundary('START_CHALLENGE_REQUEST_BEGIN', startedAtRef.current)
      const challenge = await requestStartChallenge(account, mission)
      if (!isCurrent(token)) return
      const payload: StartExpeditionPayload = {
        version: START_EXPEDITION_VERSION,
        type: START_EXPEDITION_TYPE,
        wallet: challenge.wallet,
        mission,
        dayKey: challenge.dayKey,
        challenge: challenge.challenge,
        blueprintId: challenge.blueprintId,
        blueprintHash: challenge.blueprintHash,
      }
      const canonicalPayload = serializeStartPayload(payload)
      traceProductStartBoundary('CANONICAL_START_PAYLOAD_READY', startedAtRef.current)
      dispatch({
        type: 'CHALLENGE_RECEIVED',
        challenge,
        canonicalPayload,
      })
      traceProductStartBoundary('AWAITING_START_SIGNATURE', startedAtRef.current)
    } catch (error) {
      if (!isCurrent(token)) return
      const failure = mapFailure(error)
      fail(token, failure.status, failure.errorCode)
    }
  }, [fail, isCurrent])

  const submitStart = useCallback(async (token: number, signed: SignedStartRequest, normalizedWallet: string) => {
    try {
      const start = await authorizeStart(signed)
      if (!isCurrent(token)) return
      dispatch({ type: 'START_SUCCEEDED', start })
      if (notifiedTokenRef.current === token) return
      notifiedTokenRef.current = token
      onStartedRef.current?.(start, normalizedWallet)
    } catch (error) {
      if (!isCurrent(token)) return
      if (error instanceof ExpeditionProofApiError && error.code === 'NETWORK_ERROR') {
        dispatch({ type: 'START_NETWORK_FAILURE' })
        return
      }
      const failure = mapFailure(error)
      fail(token, failure.status, failure.errorCode)
    }
  }, [fail, isCurrent])

  const begin = useCallback(async (mission: MissionType) => {
    if (!canBeginProductStart(state) || activeTokenRef.current !== null) return
    const token = guardRef.current.start()
    activeTokenRef.current = token
    const startedAt = Date.now()
    startedAtRef.current = startedAt
    traceProductStartBoundary('START_CLICKED', startedAt)
    dispatch({ type: 'BEGIN', mission })

    try {
      let provider = providerRef.current
      if (!provider) {
        traceProductStartBoundary('PRODUCT_INIT_BEGIN', startedAt)
        try {
          provider = await initializeNimiqProvider()
          traceProductStartBoundary('PRODUCT_INIT_RESOLVED', startedAt)
        } catch (error) {
          traceProductStartBoundary('PRODUCT_INIT_REJECTED', startedAt)
          throw error
        }
      }
      if (!isCurrent(token)) return
      providerRef.current = provider
      traceProductStartBoundary('LIST_ACCOUNTS_BEGIN', startedAt)
      let accounts: string[]
      try {
        accounts = await listNimiqAccounts(provider)
        traceProductStartBoundary('LIST_ACCOUNTS_RESOLVED', startedAt)
      } catch (error) {
        traceProductStartBoundary('LIST_ACCOUNTS_REJECTED', startedAt)
        throw error
      }
      if (!isCurrent(token)) return
      dispatch({ type: 'ACCOUNTS_RECEIVED', accounts })
      traceProductStartBoundary('COORDINATOR_ACCOUNT_RESULT', startedAt)
      if (accounts.length === 1 && accounts[0]) {
        traceProductStartBoundary('ACCOUNT_SELECTED', startedAt)
        void requestChallengeFor(token, accounts[0], mission)
      }
    } catch (error) {
      if (!isCurrent(token)) return
      if (isNimiqCancellation(error)) {
        invalidate()
        dispatch({ type: 'CANCEL' })
        return
      }
      const failure = mapFailure(error)
      fail(token, failure.status, failure.errorCode)
    }
  }, [fail, invalidate, isCurrent, requestChallengeFor, state,])

  const selectAccount = useCallback((account: string) => {
    const token = activeTokenRef.current
    if (!token || state.status !== 'SELECTING_ACCOUNT' || !state.accounts.includes(account) || !state.mission || !isCurrent(token)) return
    dispatch({ type: 'ACCOUNT_SELECTED', account })
    traceProductStartBoundary('ACCOUNT_SELECTED', startedAtRef.current)
    void requestChallengeFor(token, account, state.mission)
  }, [isCurrent, requestChallengeFor, state])

  const authorize = useCallback(async () => {
    const token = activeTokenRef.current
    const provider = providerRef.current
    if (!token || !provider || state.status !== 'AWAITING_START_SIGNATURE' || !state.canonicalPayload || !state.normalizedWallet || !isCurrent(token)) return
    try {
      const signature = await signNimiqMessage(provider, state.canonicalPayload)
      if (!isCurrent(token)) return
      const signed: SignedStartRequest = {
        payload: state.canonicalPayload,
        publicKey: signature.publicKey,
        signature: signature.signature,
      }
      dispatch({ type: 'SIGNATURE_SUBMITTED', signed })
      void submitStart(token, signed, state.normalizedWallet)
    } catch (error) {
      if (!isCurrent(token)) return
      if (isNimiqCancellation(error)) {
        invalidate()
        dispatch({ type: 'CANCEL' })
        return
      }
      const failure = mapFailure(error)
      fail(token, failure.status, failure.errorCode)
    }
  }, [fail, invalidate, isCurrent, state, submitStart])

  const retryStart = useCallback(() => {
    const token = activeTokenRef.current
    if (!token || state.status !== 'RECOVERING_START' || !state.signed || !state.normalizedWallet || !isCurrent(token)) return
    void submitStart(token, state.signed, state.normalizedWallet)
  }, [isCurrent, state, submitStart])

  const reset = useCallback(() => {
    invalidate()
    dispatch({ type: 'RESET' })
  }, [invalidate])

  return {
    ...state,
    begin,
    selectAccount,
    authorize,
    retryStart,
    cancel: cancelFlow,
    reset,
  }
}

export type ProductStartModel = ReturnType<typeof useProductStart>

function traceProductStartBoundary(boundary: string, startedAt: number): void {
  if (!import.meta.env.DEV || import.meta.env.MODE === 'test') return
  console.info(`[product-start] ${boundary} +${Math.max(0, Date.now() - startedAt)}ms`)
}

function isNimiqCancellation(error: unknown): boolean {
  return error instanceof NimiqIntegrationError
    && (error.code === 'ACCOUNT_CANCELLED'
      || error.code === 'ACCOUNT_EMPTY'
      || error.code === 'SIGN_CANCELLED'
      || error.code === 'UNKNOWN')
}

function mapFailure(error: unknown): {
  status: 'LIMIT_REACHED' | 'BLUEPRINT_UNAVAILABLE' | 'PROOF_UNAVAILABLE' | 'REJECTED'
  errorCode: ProductStartErrorCode
} {
  if (error instanceof ExpeditionProofApiError) {
    if (error.code === 'DAILY_EXPEDITION_LIMIT_REACHED') return { status: 'LIMIT_REACHED', errorCode: error.code }
    if (error.code === 'DAILY_BLUEPRINT_UNAVAILABLE') return { status: 'BLUEPRINT_UNAVAILABLE', errorCode: error.code }
    if (error.code === 'PROOF_UNAVAILABLE' || error.code === 'NETWORK_ERROR' || error.code === 'MALFORMED_RESPONSE') {
      return { status: 'PROOF_UNAVAILABLE', errorCode: error.code }
    }
    return { status: 'REJECTED', errorCode: error.code }
  }
  if (error instanceof NimiqIntegrationError) {
    if (error.code === 'PROVIDER_UNAVAILABLE' || error.code === 'PROVIDER_INIT_FAILED') {
      return { status: 'PROOF_UNAVAILABLE', errorCode: 'NIMIQ_ERROR' }
    }
    return { status: 'REJECTED', errorCode: error.code === 'ACCOUNT_EMPTY' ? 'ACCOUNT_EMPTY' : 'NIMIQ_ERROR' }
  }
  return { status: 'PROOF_UNAVAILABLE', errorCode: 'NIMIQ_ERROR' }
}
