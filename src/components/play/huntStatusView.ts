import type { PlayFixture } from '../../types/play'

export type HuntTreasureSource =
  | { kind: 'loading' }
  | { kind: 'unavailable' }
  | { kind: 'live'; remainingSlots: number; totalSlots: number; nextResetAt: string }

export type HuntStatusView = {
  treasuresRemaining: string
  treasuresTotal: string
  expeditionsRemaining: string
  resetDisplay: string
  badge: string
  live: boolean
  busy: boolean
}

export function resolveHuntStatusView(source: HuntTreasureSource, fixture: PlayFixture, nowMs = Date.now()): HuntStatusView {
  if (source.kind === 'loading') {
    return {
      treasuresRemaining: '—',
      treasuresTotal: '69',
      expeditionsRemaining: String(fixture.expeditionsRemaining),
      resetDisplay: '—',
      badge: 'LOADING',
      live: false,
      busy: true,
    }
  }
  if (source.kind === 'unavailable') {
    return {
      treasuresRemaining: '—',
      treasuresTotal: '69',
      expeditionsRemaining: String(fixture.expeditionsRemaining),
      resetDisplay: '—',
      badge: 'TREASURE COUNT UNAVAILABLE',
      live: false,
      busy: false,
    }
  }
  return {
    treasuresRemaining: String(source.remainingSlots),
    treasuresTotal: String(source.totalSlots),
    expeditionsRemaining: String(fixture.expeditionsRemaining),
    resetDisplay: formatResetCountdown(source.nextResetAt, nowMs),
    badge: 'LIVE · SERVER',
    live: true,
    busy: false,
  }
}

export function formatResetCountdown(nextResetAt: string, nowMs: number): string {
  const seconds = Math.max(0, Math.floor((Date.parse(nextResetAt) - nowMs) / 1000))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor(seconds / 60) % 60
  const rest = seconds % 60
  return [hours, minutes, rest].map(value => String(value).padStart(2, '0')).join(':')
}
