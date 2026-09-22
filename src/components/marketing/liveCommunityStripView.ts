import type { SitePresenceStatus } from '../../hooks/useSitePresence.ts'

export type GamerCountStatus = 'loading' | 'live' | 'unavailable'

export function formatOnlineText(online: number): string {
  return online === 1 ? '1 exploring now' : `${formatCount(online)} exploring now`
}

export function formatGamerText(gamers: number): string {
  return gamers === 1 ? '1 gamer has entered Angkor' : `${formatCount(gamers)} gamers have entered Angkor`
}

export function formatCount(value: number): string {
  return new Intl.NumberFormat('en-US').format(value)
}

/**
 * Strip visibility rule (pure, tested):
 * - online shows while Presence is live (even at 0 — a connected empty
 *   state is real) or still connecting; hidden only when failed.
 * - gamers show while live/loading, or whenever a last valid count exists.
 * The strip disappears silently only when BOTH sides have nothing to show.
 */
export function shouldShowCommunityStrip({
  presenceStatus,
  gamerStatus,
  gamerCount,
}: {
  readonly presenceStatus: SitePresenceStatus
  readonly gamerStatus: GamerCountStatus
  readonly gamerCount: number | null
}): boolean {
  const showOnline = presenceStatus === 'live' || presenceStatus === 'connecting'
  const showGamers = gamerCount !== null || gamerStatus === 'loading'
  return showOnline || showGamers
}
