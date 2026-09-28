import { useEffect, useRef, useState } from 'react'
import {
  acceptAdventurerRequest,
  blockAdventurer,
  cancelAdventurerRequest,
  declineAdventurerRequest,
  fetchPublicAdventurerProfileView,
  removeAdventurerAlly,
  requestAdventurer,
  unblockAdventurer,
  AdventurerApiError,
  type PublicAdventurerProfileView,
} from '../../api/adventurer.ts'
import type { AdventurerRelationshipState } from '../../domain/adventurerSocial.ts'
import { AdventurerAvatarToken } from './AdventurerAvatar'
import styles from './Adventurer.module.css'

type PublicProfileState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly view: PublicAdventurerProfileView }
  | { readonly status: 'unavailable' }

export function PublicAdventurerProfileSheet({
  playerId,
  onClose,
  onSocialChanged,
}: {
  readonly playerId: string
  readonly onClose: () => void
  readonly onSocialChanged?: () => void
}) {
  const [state, setState] = useState<PublicProfileState>({ status: 'loading' })
  const [action, setAction] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const viewGeneration = useRef(0)

  useEffect(() => {
    let cancelled = false
    const generation = ++viewGeneration.current
    const timer = setTimeout(() => {
      setState({ status: 'loading' })
      setActionError(null)
      void fetchPublicAdventurerProfileView(playerId)
        .then(view => {
          if (!cancelled && viewGeneration.current === generation) setState({ status: 'ready', view })
        })
        .catch(() => {
          if (!cancelled && viewGeneration.current === generation) setState({ status: 'unavailable' })
        })
    }, 0)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [playerId])

  const runAction = async (name: string, operation: () => Promise<string | void>, next: (view: PublicAdventurerProfileView, result?: string) => PublicAdventurerProfileView) => {
    if (action) return
    const generation = viewGeneration.current
    setAction(name)
    setActionError(null)
    try {
      const result = await operation()
      if (viewGeneration.current !== generation) return
      setState(current => current.status === 'ready' ? { status: 'ready', view: next(current.view, typeof result === 'string' ? result : undefined) } : current)
      onSocialChanged?.()
    } catch (error) {
      if (viewGeneration.current === generation) setActionError(socialError(error))
    } finally {
      if (viewGeneration.current === generation) setAction(null)
    }
  }

  return <div className={styles.publicProfileSheet} aria-busy={state.status === 'loading'}>
    {state.status === 'loading' && <p className={styles.profileStatus} role="status">Loading Adventurer profile…</p>}
    {state.status === 'unavailable' && <p className={styles.profileError} role="alert">This Adventurer profile is unavailable.</p>}
    {state.status === 'ready' && <PublicProfileContent
      view={state.view}
      action={action}
      actionError={actionError}
      runAction={runAction}
    />}
    <button type="button" className={styles.secondaryAction} onClick={onClose} autoFocus>Close profile</button>
  </div>
}

function PublicProfileContent({
  view,
  action,
  actionError,
  runAction,
}: {
  readonly view: PublicAdventurerProfileView
  readonly action: string | null
  readonly actionError: string | null
  readonly runAction: (name: string, operation: () => Promise<string | void>, next: (view: PublicAdventurerProfileView, result?: string) => PublicAdventurerProfileView) => Promise<void>
}) {
  const { profile, relationship } = view
  return <>
    <div className={styles.profileHero}>
      <AdventurerAvatarToken avatarId={profile.avatarId} size="large" />
      <div>
        <p className="eyebrow">PUBLIC ADVENTURER</p>
        <h2 id="public-adventurer-profile-title">{profile.displayName}</h2>
      </div>
    </div>
    <div className={`${styles.profileStats} ${styles.socialStats}`} aria-label="Public Adventurer stats">
      <div className={styles.profileStat}><strong>{profile.lifetimeGems}</strong><span>LIFETIME GEMS</span></div>
      <div className={styles.profileStat}><strong>{profile.expeditionsCompleted}</strong><span>EXPEDITIONS</span></div>
      <div className={styles.profileStat}><strong>{profile.bestStreak}</strong><span>BEST STREAK</span></div>
      <div className={styles.profileStat}><strong>{profile.allyCount ?? 0}</strong><span>ALLIES</span></div>
    </div>
    {relationship && relationship.state !== 'SELF' && <SocialAction
      view={view}
      state={relationship.state}
      action={action}
      actionError={actionError}
      runAction={runAction}
    />}
  </>
}

function SocialAction({
  view,
  state,
  action,
  actionError,
  runAction,
}: {
  readonly view: PublicAdventurerProfileView
  readonly state: Exclude<AdventurerRelationshipState, 'SELF'>
  readonly action: string | null
  readonly actionError: string | null
  readonly runAction: (name: string, operation: () => Promise<string | void>, next: (view: PublicAdventurerProfileView, result?: string) => PublicAdventurerProfileView) => Promise<void>
}) {
  const requestId = view.relationship?.requestId ?? null
  const profile = view.profile
  const refreshRelationship = (nextState: Exclude<AdventurerRelationshipState, 'SELF'>, nextRequestId: string | null, countDelta = 0) => (current: PublicAdventurerProfileView, result?: string): PublicAdventurerProfileView => ({
    ...current,
    profile: { ...current.profile, allyCount: Math.max(0, (current.profile.allyCount ?? 0) + countDelta) },
    relationship: { state: nextState, requestId: nextRequestId ?? result ?? null },
  })
  const disabled = action !== null

  if (state === 'NONE') {
    return <section className={styles.socialActions} aria-label="Adventurer social actions">
      <button type="button" className={styles.primaryAction} disabled={disabled} onClick={() => void runAction('request', () => requestAdventurer(profile.playerId), refreshRelationship('OUTGOING_PENDING', null))}>
        {action === 'request' ? 'Adding Adventurer…' : '+ Add Adventurer'}
      </button>
      {actionError && <p className={styles.profileError} role="alert">{actionError}</p>}
    </section>
  }

  if (state === 'OUTGOING_PENDING') {
    return <section className={styles.socialActions} aria-label="Adventurer social actions">
      <p className={styles.socialState} role="status">Request sent</p>
      {requestId && <button type="button" className={styles.secondaryAction} disabled={disabled} onClick={() => void runAction('cancel', () => cancelAdventurerRequest(requestId), refreshRelationship('NONE', null))}>{action === 'cancel' ? 'Cancelling…' : 'Cancel request'}</button>}
      {actionError && <p className={styles.profileError} role="alert">{actionError}</p>}
    </section>
  }

  if (state === 'INCOMING_PENDING') {
    return <section className={styles.socialActions} aria-label="Adventurer social actions">
      <div className={styles.socialButtonRow}>
        <button type="button" className={styles.primaryAction} disabled={disabled || !requestId} onClick={() => requestId && void runAction('accept', () => acceptAdventurerRequest(requestId), refreshRelationship('ALLY', null, 1))}>{action === 'accept' ? 'Accepting…' : 'Accept'}</button>
        <button type="button" className={styles.secondaryAction} disabled={disabled || !requestId} onClick={() => requestId && void runAction('decline', () => declineAdventurerRequest(requestId), refreshRelationship('NONE', null))}>{action === 'decline' ? 'Declining…' : 'Decline'}</button>
      </div>
      {actionError && <p className={styles.profileError} role="alert">{actionError}</p>}
    </section>
  }

  if (state === 'ALLY') {
    return <section className={styles.socialActions} aria-label="Ally actions">
      <p className={styles.socialState}>✓ Ally</p>
      <div className={styles.socialButtonRow}>
        <button type="button" className={styles.secondaryAction} disabled={disabled} onClick={() => void runAction('remove', () => removeAdventurerAlly(profile.playerId), refreshRelationship('NONE', null, -1))}>{action === 'remove' ? 'Removing…' : 'Remove Ally'}</button>
        <button type="button" className={styles.dangerAction} disabled={disabled} onClick={() => void runAction('block', () => blockAdventurer(profile.playerId), refreshRelationship('BLOCKED_BY_ME', null, -1))}>{action === 'block' ? 'Blocking…' : 'Block Adventurer'}</button>
      </div>
      {actionError && <p className={styles.profileError} role="alert">{actionError}</p>}
    </section>
  }

  if (state === 'BLOCKED_BY_ME') {
    return <section className={styles.socialActions} aria-label="Blocked Adventurer actions">
      <p className={styles.socialState}>Adventurer blocked</p>
      <button type="button" className={styles.secondaryAction} disabled={disabled} onClick={() => void runAction('unblock', () => unblockAdventurer(profile.playerId), refreshRelationship('NONE', null))}>{action === 'unblock' ? 'Unblocking…' : 'Unblock Adventurer'}</button>
      {actionError && <p className={styles.profileError} role="alert">{actionError}</p>}
    </section>
  }

  if (state === 'UNAVAILABLE') {
    return <section className={styles.socialActions} aria-label="Adventurer social actions">
      <p className={styles.socialState}>Social actions unavailable.</p>
    </section>
  }

  return null
}

function socialError(error: unknown): string {
  if (!(error instanceof AdventurerApiError)) return 'Social actions are unavailable. Try again.'
  if (error.code === 'SOCIAL_OUTGOING_CAP_REACHED') return 'You have reached the 25 pending request limit.'
  if (error.code === 'SOCIAL_INCOMING_CAP_REACHED') return 'That Adventurer cannot receive more pending requests right now.'
  if (error.code === 'SOCIAL_ALLY_CAP_REACHED') return 'One Adventurer has reached the 100 Ally limit.'
  if (error.code === 'SOCIAL_ALREADY_ALLY') return 'You are already Allies.'
  if (error.code === 'SOCIAL_REQUEST_PENDING' || error.code === 'SOCIAL_INCOMING_REQUEST_EXISTS') return 'A request between you is already pending.'
  if (error.code === 'SOCIAL_TARGET_UNAVAILABLE') return 'This Adventurer is unavailable for social actions.'
  if (error.code === 'SOCIAL_REQUEST_STALE' || error.code === 'SOCIAL_REQUEST_NOT_FOUND') return 'That request is no longer available. Refresh and try again.'
  if (error.code === 'ADVENTURER_SESSION_INVALID') return 'Your Adventurer session expired. Reconnect to continue.'
  return 'Social actions are unavailable. Try again.'
}
