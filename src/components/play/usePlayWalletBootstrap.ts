import { useCallback, useEffect, useReducer, useRef } from 'react'
import type { NimiqProvider } from '@nimiq/mini-app-sdk'
import { detectNimiqPayHost, initializeNimiqProvider, listNimiqAccounts } from '../../integrations/nimiq/nimiqClient'
import { NimiqIntegrationError } from '../../integrations/nimiq/nimiqErrors'
import {
  INITIAL_PLAY_WALLET_BOOTSTRAP,
  reducePlayWalletBootstrap,
} from './playWalletBootstrap.ts'
import { getRememberedProductWallet, rememberProductWallet } from './productWallet.ts'
import { traceWalletRecovery } from './walletRecoveryDiagnostics.ts'

export function usePlayWalletBootstrap() {
  const [state, dispatch] = useReducer(reducePlayWalletBootstrap, INITIAL_PLAY_WALLET_BOOTSTRAP)
  const providerRef = useRef<NimiqProvider | undefined>(undefined)
  const mountedRef = useRef(true)
  const startedRef = useRef(false)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const connect = useCallback(async () => {
    if (state.status === 'CONNECTING' || state.status === 'CONNECTED') return
    const remembered = getRememberedProductWallet()
    if (remembered) {
      dispatch({ type: 'CONNECTED', wallet: remembered })
      return
    }
    if (!detectNimiqPayHost()) {
      dispatch({ type: 'UNAVAILABLE' })
      return
    }

    dispatch({ type: 'CONNECT_START' })
    try {
      let provider = providerRef.current
      if (!provider) provider = await initializeNimiqProvider()
      if (!mountedRef.current) return
      providerRef.current = provider
      const accounts = await listNimiqAccounts(provider)
      if (!mountedRef.current) return
      dispatch({ type: 'ACCOUNTS_RECEIVED', accounts })
      if (accounts.length === 1 && accounts[0]) rememberProductWallet(accounts[0])
    } catch (error) {
      if (!mountedRef.current) return
      if (isNimiqCancellation(error)) {
        dispatch({ type: 'CANCEL' })
        return
      }
      dispatch({ type: 'UNAVAILABLE' })
    }
  }, [state.status])

  const selectAccount = useCallback((account: string) => {
    if (state.status !== 'SELECTING_ACCOUNT' || !state.accounts.includes(account)) return
    rememberProductWallet(account)
    dispatch({ type: 'ACCOUNT_SELECTED', account })
  }, [state])

  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    const remembered = getRememberedProductWallet()
    if (remembered) {
      dispatch({ type: 'CONNECTED', wallet: remembered })
      return
    }
    if (!detectNimiqPayHost()) return
    void connect()
  }, [connect])

  useEffect(() => {
    if (state.status !== 'CONNECTED' || !state.wallet) {
      traceWalletRecovery('PLAY_WALLET_CONNECTED', { connected: 'no' })
      return
    }
    const compact = state.wallet.replace(/\s+/g, '')
    const shortened = compact.length <= 12 ? compact : `${compact.slice(0, 6)}…${compact.slice(-4)}`
    traceWalletRecovery('PLAY_WALLET_CONNECTED', { connected: 'yes', wallet: shortened })
  }, [state.status, state.wallet])

  return {
    ...state,
    connect,
    selectAccount,
  }
}

function isNimiqCancellation(error: unknown): boolean {
  return error instanceof NimiqIntegrationError
    && (error.code === 'ACCOUNT_CANCELLED'
      || error.code === 'ACCOUNT_EMPTY'
      || error.code === 'SIGN_CANCELLED'
      || error.code === 'UNKNOWN')
}
