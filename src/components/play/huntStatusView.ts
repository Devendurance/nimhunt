import type { WalletDailyStatus } from '../../domain/dailyLedger'

export type HuntRewardWeek = { readonly active: true; readonly endsAt: string }

export type HuntTreasureSource =
  | { kind: 'loading'; walletStatus: WalletDailyStatus | null }
  | { kind: 'unavailable'; walletStatus: WalletDailyStatus | null }
  | { kind: 'live'; remainingSlots: number; totalSlots: number; nextResetAt: string; rewardWeek?: HuntRewardWeek; walletStatus: WalletDailyStatus | null }

export type HuntStatusView = {
  treasuresRemaining: string
  treasuresTotal: string
  expeditionsRemaining: string
  expeditionsLabel: string
  resetDisplay: string
  badge: string
  live: boolean
  busy: boolean
  rewardWeek: HuntRewardWeek | null
}

export function resolveHuntStatusView(source: HuntTreasureSource, nowMs = Date.now()): HuntStatusView {
  if (source.kind === 'loading') {
    return {
      treasuresRemaining: '—',
      treasuresTotal: '—',
      ...walletAttemptView(source.walletStatus),
      resetDisplay: '—',
      badge: 'CHECKING',
      live: false,
      busy: true,
      rewardWeek: null,
    }
  }
  if (source.kind === 'unavailable') {
    return {
      treasuresRemaining: '—',
      treasuresTotal: '—',
      ...walletAttemptView(source.walletStatus),
      resetDisplay: '—',
      badge: 'UNAVAILABLE',
      live: false,
      busy: false,
      rewardWeek: null,
    }
  }
  return {
    treasuresRemaining: String(source.remainingSlots),
    treasuresTotal: String(source.totalSlots),
    ...walletAttemptView(source.walletStatus),
    resetDisplay: formatResetCountdown(source.nextResetAt, nowMs),
    badge: 'LIVE',
    live: true,
    busy: false,
    rewardWeek: source.rewardWeek ?? null,
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

export function formatRewardWeekCountdown(endsAt: string, nowMs: number): string {
  const seconds = Math.max(0, Math.floor((Date.parse(endsAt) - nowMs) / 1000))
  const days = Math.floor(seconds / 86_400)
  const hours = Math.floor(seconds / 3600) % 24
  const minutes = Math.floor(seconds / 60) % 60
  const rest = seconds % 60
  return `${days}D ${[hours, minutes, rest].map(value => String(value).padStart(2, '0')).join(':')}`
}

export function formatResetCountdown(nextResetAt: string, nowMs: number): string {
  const seconds = Math.max(0, Math.floor((Date.parse(nextResetAt) - nowMs) / 1000))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor(seconds / 60) % 60
  const rest = seconds % 60
  return [hours, minutes, rest].map(value => String(value).padStart(2, '0')).join(':')
}
