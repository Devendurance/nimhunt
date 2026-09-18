import { useCallback, useEffect, useState } from 'react'
import { fetchDailyHuntStatus } from '../../api/dailyHunt'

export type LandingHuntStatus =
  | { kind: 'loading' }
  | { kind: 'live'; remainingSlots: number; totalSlots: number; nextResetAt: string }
  | { kind: 'unavailable' }

const POLL_INTERVAL_MS = 45_000

export function useLandingHuntStatus(
  fetcher: typeof fetch = fetch,
  now: () => number = Date.now,
): LandingHuntStatus {
  const [status, setStatus] = useState<LandingHuntStatus>({ kind: 'loading' })

  const refresh = useCallback(async () => {
    try {
      const result = await fetchDailyHuntStatus(fetcher)
      if (result.kind === 'live') {
        setStatus({
          kind: 'live',
          remainingSlots: result.status.remainingSlots,
          totalSlots: result.status.totalSlots,
          nextResetAt: result.status.nextResetAt,
        })
        return
      }
      setStatus({ kind: 'unavailable' })
    } catch {
      setStatus({ kind: 'unavailable' })
    }
  }, [fetcher])

  useEffect(() => {
    let cancelled = false
    const safeRefresh = () => {
      if (!cancelled) void refresh()
    }
    safeRefresh()

    const poll = window.setInterval(safeRefresh, POLL_INTERVAL_MS)
    const onVisible = () => {
      if (document.visibilityState === 'visible') safeRefresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      window.clearInterval(poll)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [refresh])

  useEffect(() => {
    if (status.kind !== 'live') return
    const msUntilReset = Date.parse(status.nextResetAt) - now()
    const delay = !Number.isFinite(msUntilReset) || msUntilReset <= 0 ? 0 : msUntilReset + 1_000
    const timer = window.setTimeout(() => {
      void refresh()
    }, delay)
    return () => window.clearTimeout(timer)
  }, [status, refresh, now])

  return status
}
