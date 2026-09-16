import { useCallback, useEffect, useRef, useState } from 'react'
import type { NimiqProvider } from '@nimiq/mini-app-sdk'
import {
  authorizeWalletRecovery,
  requestWalletRecoveryChallenge,
  type SignedStartRequest,
} from '../../api/expeditionProof.ts'
import {
  serializeWalletRecoveryPayload,
  WALLET_RECOVERY_TYPE,
  WALLET_RECOVERY_VERSION,
} from '../../domain/walletRecovery.ts'
import { initializeNimiqProvider, signNimiqMessage } from '../../integrations/nimiq/nimiqClient'
import { NimiqIntegrationError } from '../../integrations/nimiq/nimiqErrors'
import { traceWalletRecovery } from './walletRecoveryDiagnostics.ts'

export function usePlayRewardRecovery(options: {
  readonly enabled: boolean
  readonly wallet: string | null
}) {
  const [epoch, setEpoch] = useState(0)
  const [status, setStatus] = useState<'idle' | 'signing' | 'ready' | 'cancelled' | 'failed'>('idle')
  const attemptedRef = useRef(false)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const recover = useCallback(async (wallet: string, provider: NimiqProvider) => {
    traceWalletRecovery('RECOVERY_CHALLENGE_REQUESTED', { requested: 'yes' })
    const challenge = await requestWalletRecoveryChallenge(wallet)
    if (!mountedRef.current) return
    const canonicalPayload = serializeWalletRecoveryPayload({
      version: WALLET_RECOVERY_VERSION,
      type: WALLET_RECOVERY_TYPE,
      wallet: challenge.wallet,
      challenge: challenge.challenge,
      issuedAt: challenge.issuedAt,
      expiresAt: challenge.expiresAt,
      purpose: challenge.purpose,
    })
    traceWalletRecovery('RECOVERY_SIGNATURE_REQUESTED', { requested: 'yes' })
    const signature = await signNimiqMessage(provider, canonicalPayload)
    if (!mountedRef.current) return
    traceWalletRecovery('RECOVERY_SIGNATURE_RESULT', { result: 'approved' })
    const signed: SignedStartRequest = {
      payload: canonicalPayload,
      publicKey: signature.publicKey,
      signature: signature.signature,
    }
    await authorizeWalletRecovery(signed)
    if (!mountedRef.current) return
    setStatus('ready')
    setEpoch(current => current + 1)
  }, [])

  useEffect(() => {
    attemptedRef.current = false
  }, [options.wallet])

  useEffect(() => {
    if (!options.enabled || !options.wallet || attemptedRef.current) return
    attemptedRef.current = true
    setStatus('signing')
    void initializeNimiqProvider()
      .then(provider => recover(options.wallet!, provider))
      .catch((error: unknown) => {
        if (!mountedRef.current) return
        if (isNimiqCancellation(error)) {
          traceWalletRecovery('RECOVERY_SIGNATURE_RESULT', { result: 'cancelled' })
          setStatus('cancelled')
          return
        }
        setStatus('failed')
      })
  }, [options.enabled, options.wallet, recover])

  return { status, epoch }
}

function isNimiqCancellation(error: unknown): boolean {
  return error instanceof NimiqIntegrationError
    && (error.code === 'ACCOUNT_CANCELLED'
      || error.code === 'SIGN_CANCELLED'
      || error.code === 'UNKNOWN')
}
