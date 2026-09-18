import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchMonthlyHeroes, fetchWalletMonthlyStats, MonthlyHeroesApiError } from '../../api/monthlyHeroes.ts'
import type { MonthlyHeroesResponse, WalletMonthlyStatsResponse } from '../../domain/monthlyHeroes.ts'

export type MonthlyHeroesState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly heroes: MonthlyHeroesResponse }
  | { readonly status: 'empty'; readonly heroes: MonthlyHeroesResponse }
  | { readonly status: 'unavailable' }

export function useMonthlyHeroes(): MonthlyHeroesState & { readonly retry: () => void } {
  const [nonce, setNonce] = useState(0)
  const [view, setView] = useState<{ readonly key: number; readonly value: MonthlyHeroesState } | null>(null)
  const retry = useCallback(() => setNonce(current => current + 1), [])

  useEffect(() => {
    let cancelled = false
    void fetchMonthlyHeroes()
      .then(heroes => {
        if (cancelled) return
        const hasLeaders = heroes.categories.some(category => category.leaders.length > 0)
        setView({ key: nonce, value: hasLeaders ? { status: 'ready', heroes } : { status: 'empty', heroes } })
      })
      .catch((error: unknown) => {
        if (cancelled) return
        if (error instanceof MonthlyHeroesApiError) {
          setView({ key: nonce, value: { status: 'unavailable' } })
          return
        }
        setView({ key: nonce, value: { status: 'unavailable' } })
      })
    return () => {
      cancelled = true
    }
  }, [nonce])

  if (view?.key === nonce) return { ...view.value, retry }
  return { status: 'loading', retry }
}

export type WalletMonthlyStatsState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly monthly: WalletMonthlyStatsResponse }
  | { readonly status: 'unauthorized' }
  | { readonly status: 'unavailable' }

export function useWalletMonthlyStats(options: {
  readonly enabled: boolean
  readonly sessionKey?: string | number
  readonly onUnauthorized?: () => void
}): WalletMonthlyStatsState & { readonly retry: () => void } {
  const [nonce, setNonce] = useState(0)
  const key = `${options.enabled ? '1' : '0'}:${options.sessionKey ?? '0'}:${nonce}`
  const [view, setView] = useState<{ readonly key: string; readonly value: WalletMonthlyStatsState } | null>(null)
  const [unauthorized, setUnauthorized] = useState(false)
  const onUnauthorizedRef = useRef(options.onUnauthorized)
  useEffect(() => {
    onUnauthorizedRef.current = options.onUnauthorized
  }, [options.onUnauthorized])
  const retry = useCallback(() => {
    setUnauthorized(false)
    setNonce(current => current + 1)
  }, [])

  useEffect(() => {
    if (!options.enabled) return
    let cancelled = false
    void fetchWalletMonthlyStats()
      .then(monthly => {
        if (cancelled) return
        setView({ key, value: { status: 'ready', monthly } })
      })
      .catch((error: unknown) => {
        if (cancelled) return
        if (error instanceof MonthlyHeroesApiError && error.code === 'RUN_SESSION_INVALID') {
          setUnauthorized(true)
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

  if (!options.enabled || unauthorized) return { status: 'unauthorized', retry }
  if (view?.key === key) return { ...view.value, retry }
  return { status: 'loading', retry }
}
