import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchTreasureBank, TreasureBankApiError } from '../../api/treasureBank.ts'
import type { TreasureBankResponse } from '../../domain/treasureBank.ts'

export type TreasureBankState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly bank: TreasureBankResponse }
  | { readonly status: 'empty'; readonly bank: TreasureBankResponse }
  | { readonly status: 'unauthorized' }
  | { readonly status: 'unavailable' }

export function useTreasureBank(options: {
  readonly enabled: boolean
  readonly sessionKey?: string | number
  readonly onUnauthorized?: () => void
}): TreasureBankState & { readonly retry: () => void } {
  const [nonce, setNonce] = useState(0)
  const key = `${options.enabled ? '1' : '0'}:${options.sessionKey ?? '0'}:${nonce}`
  const [view, setView] = useState<{ readonly key: string; readonly value: TreasureBankState } | null>(null)
  const onUnauthorizedRef = useRef(options.onUnauthorized)
  useEffect(() => {
    onUnauthorizedRef.current = options.onUnauthorized
  }, [options.onUnauthorized])

  const retry = useCallback(() => setNonce(current => current + 1), [])

  useEffect(() => {
    if (!options.enabled) return
    let cancelled = false
    void fetchTreasureBank()
      .then(bank => {
        if (cancelled) return
        setView({ key, value: bank.rewards.length === 0 ? { status: 'empty', bank } : { status: 'ready', bank } })
      })
      .catch((error: unknown) => {
        if (cancelled) return
        if (error instanceof TreasureBankApiError && error.code === 'RUN_SESSION_INVALID') {
          onUnauthorizedRef.current?.()
          setView({ key, value: { status: 'unauthorized' } })
          return
        }
        setView({ key, value: { status: 'unavailable' } })
      })
    return () => {
      cancelled = true
    }
  }, [options.enabled, options.sessionKey, nonce, key])

  if (!options.enabled) return { status: 'unauthorized', retry }
  if (view?.key === key) return { ...view.value, retry }
  return { status: 'loading', retry }
}
