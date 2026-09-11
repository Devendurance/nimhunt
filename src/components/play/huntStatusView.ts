import type { PlayFixture } from '../../types/play'
import type { WalletDailyStatus } from '../../domain/dailyLedger'

export type HuntTreasureSource =
  | { kind: 'loading'; walletStatus: WalletDailyStatus | null }
  | { kind: 'unavailable'; walletStatus: WalletDailyStatus | null }
  | { kind: 'live'; remainingSlots: number; totalSlots: number; nextResetAt: string; walletStatus: WalletDailyStatus | null }

export type HuntStatusView = {
  treasuresRemaining: string
  treasuresTotal: string
  expeditionsRemaining: string
  expeditionsLabel: string
  resetDisplay: string
  badge: string
  live: boolean
  busy: boolean
}

export function resolveHuntStatusView(source: HuntTreasureSource, fixture: PlayFixture, nowMs = Date.now()): HuntStatusView {
  if (source.kind === 'loading') {
    return {
      treasuresRemaining: '—',
      treasuresTotal: String(fixture.treasuresTotal),
      ...walletAttemptView(source.walletStatus),
      resetDisplay: '—',
      badge: 'LOADING',
      live: false,
      busy: true,
    }
  }
  if (source.kind === 'unavailable') {
    return {
      treasuresRemaining: '—',
      treasuresTotal: String(fixture.treasuresTotal),
      ...walletAttemptView(source.walletStatus),
      resetDisplay: '—',
      badge: 'TREASURE COUNT UNAVAILABLE',
      live: false,
      busy: false,
    }
  }
  return {
    treasuresRemaining: String(source.remainingSlots),
    treasuresTotal: String(source.totalSlots),
    ...walletAttemptView(source.walletStatus),
    resetDisplay: formatResetCountdown(source.nextResetAt, nowMs),
    badge: 'LIVE · SERVER',
    live: true,
    busy: false,
  }
}

function walletAttemptView(status: WalletDailyStatus | null): Pick<HuntStatusView, 'expeditionsRemaining' | 'expeditionsLabel'> {
  if (!status) return { expeditionsRemaining: '—', expeditionsLabel: 'wallet required' }
  return {
    expeditionsRemaining: String(status.expeditionsRemaining),
    expeditionsLabel: 'expeditions left today',
  }
}

export function formatExpeditionsLeftToday(status: WalletDailyStatus | null): string | null {
  if (!status) return null
  const remaining = status.expeditionsRemaining
  return `${remaining} ${remaining === 1 ? 'EXPEDITION' : 'EXPEDITIONS'} LEFT TODAY`
}

export function formatResetCountdown(nextResetAt: string, nowMs: number): string {
  const seconds = Math.max(0, Math.floor((Date.parse(nextResetAt) - nowMs) / 1000))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor(seconds / 60) % 60
  const rest = seconds % 60
  return [hours, minutes, rest].map(value => String(value).padStart(2, '0')).join(':')
}
