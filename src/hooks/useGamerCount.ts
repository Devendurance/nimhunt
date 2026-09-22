import { useCallback, useEffect, useState } from 'react'
import { applyGamerFetch, fetchPublicStats, type GamerCountView } from '../api/publicStats.ts'

export type GamerCountState = GamerCountView

/** Near-live refresh: 20s poll + window focus. Never hammers the API. */
export const GAMER_COUNT_POLL_MS = 20_000

export function useGamerCount(
  fetcher: typeof fetch = fetch,
  pollMs: number = GAMER_COUNT_POLL_MS,
): GamerCountState {
  const [state, setState] = useState<GamerCountState>({ status: 'loading', gamers: null })

  const refresh = useCallback(async () => {
    try {
      const stats = await fetchPublicStats(fetcher)
      setState(current => applyGamerFetch(current, stats))
    } catch {
      // Fail softly and retain the last valid count when one exists.
      setState(current => applyGamerFetch(current, null))
    }
  }, [fetcher])

  useEffect(() => {
    let cancelled = false
    const safeRefresh = () => {
      if (!cancelled) void refresh()
    }
    safeRefresh()
    const poll = window.setInterval(safeRefresh, pollMs)
    const onVisible = () => {
      if (document.visibilityState === 'visible') safeRefresh()
    }
    const onFocus = () => safeRefresh()
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onFocus)
    return () => {
      cancelled = true
      window.clearInterval(poll)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onFocus)
    }
  }, [refresh, pollMs])

  return state
}
