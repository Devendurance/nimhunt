import { useCallback, useEffect, useRef, useState } from 'react'
import {
  acceptAdventurerRequest,
  AdventurerApiError,
  declineAdventurerRequest,
  fetchAdventurerSocialOverview,
} from '../../api/adventurer.ts'
import type { AdventurerSocialOverview } from '../../domain/adventurerSocial.ts'
import { AdventurerAvatarToken } from './AdventurerAvatar'
import styles from './Adventurer.module.css'

type OverviewState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly overview: AdventurerSocialOverview }
  | { readonly status: 'error'; readonly message: string }

export function AlliesPanel({
  onClose,
  onOpenPublicProfile,
  onSocialChanged,
}: {
  readonly onClose: () => void
  readonly onOpenPublicProfile: (playerId: string, trigger: HTMLButtonElement) => void
  readonly onSocialChanged?: () => void
}) {
  const [state, setState] = useState<OverviewState>({ status: 'loading' })
  const [busy, setBusy] = useState<string | null>(null)
  const generation = useRef(0)

  const load = useCallback(() => {
    const current = ++generation.current
    setState({ status: 'loading' })
    void fetchAdventurerSocialOverview()
      .then(overview => {
        if (generation.current === current) setState({ status: 'ready', overview })
      })
      .catch(error => {
        if (generation.current === current) setState({ status: 'error', message: socialError(error) })
      })
  }, [])

  useEffect(() => {
    const timer = setTimeout(load, 0)
    return () => {
      clearTimeout(timer)
      generation.current += 1
    }
  }, [load])

  const resolveRequest = async (requestId: string, operation: () => Promise<void>) => {
    if (busy) return
    setBusy(requestId)
    try {
      await operation()
      onSocialChanged?.()
      load()
    } catch (error) {
      setState({ status: 'error', message: socialError(error) })
    } finally {
      setBusy(null)
    }
  }

  return <div className={styles.profileSheet} aria-busy={state.status === 'loading'}>
    <div className={styles.profileHero}>
      <div>
        <p className="eyebrow">MY ADVENTURER</p>
        <h2 id="adventurer-allies-title">Allies</h2>
        <p>Mutual Adventurers, kept private and keyed to player identity.</p>
      </div>
    </div>
    {state.status === 'loading' && <p className={styles.profileStatus} role="status">Loading requests and Allies…</p>}
    {state.status === 'error' && <div className={styles.profileSection}><p className={styles.profileError} role="alert">{state.message}</p><button type="button" className={styles.secondaryAction} onClick={load}>Retry</button></div>}
    {state.status === 'ready' && <>
      <section className={styles.socialListSection} aria-labelledby="incoming-requests-heading">
        <div className={styles.socialSectionHeading}><h3 id="incoming-requests-heading">Incoming requests</h3><span>{state.overview.incomingPendingCount}</span></div>
        {state.overview.incomingRequests.length === 0
          ? <p className={styles.socialEmpty}>No pending requests.</p>
          : <div className={styles.socialList}>{state.overview.incomingRequests.map(request => <div key={request.requestId} className={styles.socialRequestRow}>
            <AdventurerAvatarToken avatarId={request.avatarId} size="small" />
            <div className={styles.socialRowIdentity}><strong>{request.displayName}</strong><span>Adventurer</span></div>
            <div className={styles.socialButtonStack}>
              <button type="button" className={styles.socialMiniPrimary} disabled={busy !== null} onClick={() => void resolveRequest(request.requestId, () => acceptAdventurerRequest(request.requestId))}>{busy === request.requestId ? '…' : 'Accept'}</button>
              <button type="button" className={styles.socialMiniSecondary} disabled={busy !== null} onClick={() => void resolveRequest(request.requestId, () => declineAdventurerRequest(request.requestId))}>Decline</button>
            </div>
          </div>)}</div>}
      </section>
      <section className={styles.socialListSection} aria-labelledby="allies-list-heading">
        <div className={styles.socialSectionHeading}><h3 id="allies-list-heading">Your Allies</h3><span>{state.overview.allyCount}</span></div>
        {state.overview.allies.length === 0
          ? <p className={styles.socialEmpty}>Your Ally list is empty. Add Adventurers from their public profile.</p>
          : <div className={styles.socialList}>{state.overview.allies.map(ally => <button key={ally.playerId} type="button" className={styles.socialAllyRow} onClick={event => onOpenPublicProfile(ally.playerId, event.currentTarget)}>
            <AdventurerAvatarToken avatarId={ally.avatarId} size="small" />
            <span className={styles.socialRowIdentity}><strong>{ally.displayName}</strong><span>View public profile</span></span>
            <span className={styles.socialChevron} aria-hidden="true">›</span>
          </button>)}</div>}
      </section>
    </>}
    <button type="button" className={styles.secondaryAction} onClick={onClose} autoFocus>Close Allies</button>
  </div>
}

function socialError(error: unknown): string {
  if (error instanceof AdventurerApiError && error.code === 'ADVENTURER_SESSION_INVALID') return 'Your Adventurer session expired. Reconnect to continue.'
  if (error instanceof AdventurerApiError && (error.code === 'SOCIAL_REQUEST_STALE' || error.code === 'SOCIAL_REQUEST_NOT_FOUND')) return 'That request is no longer available. Refresh and try again.'
  return 'Allies are unavailable right now. Try again.'
}
