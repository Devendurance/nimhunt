import type { PlayTab } from '../../types/play'

export const PLAY_TABS: readonly PlayTab[] = ['hunt', 'missions', 'heroes', 'bank']

export function isPlayTab(value: string): value is PlayTab {
  return PLAY_TABS.includes(value as PlayTab)
}

export function resolvePlayTab(value: string | null, fallback: PlayTab = 'hunt'): PlayTab {
  if (value === null) return fallback
  return isPlayTab(value) ? value : 'hunt'
}

export function withPlayTab(params: URLSearchParams, tab: PlayTab): URLSearchParams {
  const next = new URLSearchParams(params)
  if (tab === 'hunt') next.delete('tab')
  else next.set('tab', tab)
  return next
}

export function normalizePlayTabParams(params: URLSearchParams, fallback: PlayTab = 'hunt'): URLSearchParams {
  const next = new URLSearchParams(params)
  const raw = next.get('tab')
  if (raw === null) {
    if (fallback !== 'hunt') next.set('tab', fallback)
    return next
  }
  if (!isPlayTab(raw) || raw === 'hunt') next.delete('tab')
  return next
}
