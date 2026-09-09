import { useEffect, useState } from 'react'
import { fetchDailyHuntStatus } from '../../api/dailyHunt'
import type { HuntTreasureSource } from './huntStatusView'

export function useDailyHuntStatus(): HuntTreasureSource {
  const [source, setSource] = useState<HuntTreasureSource>({ kind: 'loading' })

  useEffect(() => {
    let cancelled = false
    void fetchDailyHuntStatus().then(result => {
      if (cancelled) return
      if (result.kind === 'live') {
        setSource({
          kind: 'live',
          remainingSlots: result.status.remainingSlots,
          totalSlots: result.status.totalSlots,
          nextResetAt: result.status.nextResetAt,
        })
        return
      }
      setSource({ kind: 'unavailable' })
    })
    return () => {
      cancelled = true
    }
  }, [])

  return source
}
