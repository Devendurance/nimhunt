import { useEffect, useState } from 'react'
import { fetchDailyHuntStatus, fetchWalletDailyStatus } from '../../api/dailyHunt'
import type { WalletDailyStatus } from '../../domain/dailyLedger'
import { getRememberedProductWallet } from './productWallet'
import type { HuntTreasureSource } from './huntStatusView'

type PublicHuntSource =
  | { kind: 'loading' }
  | { kind: 'unavailable' }
  | { kind: 'live'; remainingSlots: number; totalSlots: number; nextResetAt: string }

export function useDailyHuntStatus(wallet = getRememberedProductWallet()): HuntTreasureSource {
  const [publicSource, setPublicSource] = useState<PublicHuntSource>({ kind: 'loading' })
  const [walletResult, setWalletResult] = useState<{ wallet: string; status: WalletDailyStatus | null } | null>(null)

  useEffect(() => {
    let cancelled = false
    void fetchDailyHuntStatus().then(result => {
      if (cancelled) return
      if (result.kind === 'live') {
        setPublicSource({
          kind: 'live',
          remainingSlots: result.status.remainingSlots,
          totalSlots: result.status.totalSlots,
          nextResetAt: result.status.nextResetAt,
        })
        return
      }
      setPublicSource({ kind: 'unavailable' })
    })
    if (wallet) {
      void fetchWalletDailyStatus(wallet).then(walletStatus => {
        if (cancelled) return
        setWalletResult({ wallet, status: walletStatus })
      })
    }
    return () => {
      cancelled = true
    }
  }, [wallet])

  return {
    ...publicSource,
    walletStatus: wallet && walletResult?.wallet === wallet ? walletResult.status : null,
  }
}
