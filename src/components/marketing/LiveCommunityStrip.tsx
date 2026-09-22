import type { JSX } from 'react'
import { useLocation } from 'react-router-dom'
import { useGamerCount } from '../../hooks/useGamerCount.ts'
import { useSitePresence, type SitePresenceStatus } from '../../hooks/useSitePresence.ts'
import {
  formatCount,
  shouldShowCommunityStrip,
  type GamerCountStatus,
} from './liveCommunityStripView.ts'

/**
 * Live community proof strip. "Exploring now" is current Realtime
 * Presence (unique anonymous visitor keys, 0 shown when connected-empty);
 * "Gamers" is unique wallets with actual gameplay_started_at from
 * /api/public-stats (last valid count retained on API failure). Either side
 * hides silently when its source failed — never a fake number, never any
 * wallet data.
 */
export function LiveCommunityStrip(): JSX.Element | null {
  const location = useLocation()
  const presence = useSitePresence(location.pathname)
  const gamers = useGamerCount()
  return (
    <LiveCommunityStripView
      online={presence.status === 'live' ? presence.online : null}
      presenceStatus={presence.status}
      gamerCount={gamers.gamers}
      gamerStatus={gamers.status}
    />
  )
}

export function LiveCommunityStripView({
  online,
  presenceStatus,
  gamerCount,
  gamerStatus,
}: {
  readonly online: number | null
  readonly presenceStatus: SitePresenceStatus
  readonly gamerCount: number | null
  readonly gamerStatus: GamerCountStatus
}): JSX.Element | null {
  if (!shouldShowCommunityStrip({ presenceStatus, gamerStatus, gamerCount })) return null
  const busy = presenceStatus === 'connecting' || gamerStatus === 'loading'

  return (
    <section className="community-strip" aria-label="Live community" aria-busy={busy || undefined}>
      {(presenceStatus === 'live' || presenceStatus === 'connecting') && (
        <p className="community-online">
          {presenceStatus === 'live' && online !== null ? (
            <>
              <span className="live-dot" aria-hidden="true" />
              <span aria-live="polite" aria-label={`${online} ${online === 1 ? 'explorer' : 'explorers'} exploring now`}>
                <strong>{formatCount(online)}</strong> exploring now
              </span>
            </>
          ) : (
            <span className="community-pending" role="status">
              <span className="live-dot is-pending" aria-hidden="true" />
              Connecting explorers…
            </span>
          )}
        </p>
      )}
      {(gamerCount !== null || gamerStatus === 'loading') && (
        <p className="community-gamers">
          {gamerCount !== null ? (
            <span aria-live="polite" aria-label={`${gamerCount} ${gamerCount === 1 ? 'gamer has' : 'gamers have'} entered Angkor`}>
              <strong>{formatCount(gamerCount)}</strong> {gamerCount === 1 ? 'gamer has' : 'gamers have'} entered Angkor
            </span>
          ) : (
            <span className="community-pending" role="status">
              Counting gamers…
            </span>
          )}
        </p>
      )}
    </section>
  )
}
