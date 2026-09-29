import { useCallback, useEffect, useState } from 'react'
import { AdventurerApiError, fetchAdventurerBlockedProfiles, unblockAdventurer } from '../../api/adventurer.ts'
import type { AdventurerBlockedProfile } from '../../domain/adventurerSocial.ts'
import { AdventurerAvatarToken } from './AdventurerAvatar'
import styles from './Adventurer.module.css'

type BlockedState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly profiles: readonly AdventurerBlockedProfile[] }
  | { readonly status: 'error'; readonly message: string }

export function BlockedAdventurersPanel({ onBack }: { readonly onBack: () => void }) {
  const [state, setState] = useState<BlockedState>({ status: 'loading' })
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(() => {
    setState({ status: 'loading' })
    void fetchAdventurerBlockedProfiles()
      .then(profiles => setState({ status: 'ready', profiles }))
      .catch(error => setState({ status: 'error', message: blockedError(error) }))
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(load, 0)
    return () => window.clearTimeout(timer)
  }, [load])

  const unblock = async (playerId: string) => {
    if (busy) return
    setBusy(playerId)
    try {
      await unblockAdventurer(playerId)
      setState(current => current.status === 'ready'
        ? { status: 'ready', profiles: current.profiles.filter(profile => profile.playerId !== playerId) }
        : current)
    } catch (error) {
      setState({ status: 'error', message: blockedError(error) })
    } finally {
      setBusy(null)
    }
  }

  return <div className={styles.profileSheet} aria-busy={state.status === 'loading'}>
    <div className={styles.subviewHeader}>
      <button type="button" className={styles.backAction} onClick={onBack}>← Settings</button>
      <p className="eyebrow">SOCIAL PRIVACY</p>
      <h2 id="adventurer-blocked-title">Blocked Adventurers</h2>
      <p>This list is private to your Adventurer. Unblocking does not restore old Allies or requests.</p>
    </div>

    {state.status === 'loading' && <p className={styles.profileStatus} role="status">Loading your blocked list…</p>}
    {state.status === 'error' && <div className={styles.profileSection}><p className={styles.profileError} role="alert">{state.message}</p><button type="button" className={styles.secondaryAction} onClick={load}>Retry</button></div>}
    {state.status === 'ready' && (state.profiles.length === 0
      ? <p className={styles.socialEmpty}>No blocked Adventurers.</p>
      : <ul className={styles.blockedList} aria-label="Blocked Adventurers">{state.profiles.map(profile => <li key={profile.playerId} className={styles.blockedRow}>
        <AdventurerAvatarToken avatarId={profile.avatarId} size="small" />
        <span className={styles.socialRowIdentity}><strong>{profile.displayName}</strong><span>Blocked Adventurer</span></span>
        <button type="button" className={styles.socialMiniSecondary} disabled={busy !== null} onClick={() => void unblock(profile.playerId)}>{busy === profile.playerId ? '…' : 'Unblock'}</button>
      </li>)}</ul>)}

    <button type="button" className={styles.secondaryAction} onClick={onBack}>Back to Settings</button>
  </div>
}

function blockedError(error: unknown): string {
  if (error instanceof AdventurerApiError && error.code === 'ADVENTURER_SESSION_INVALID') return 'Your Adventurer session expired. Reconnect to continue.'
  if (error instanceof AdventurerApiError && error.code === 'SOCIAL_NOT_BLOCKER') return 'That block is already gone. Refresh the list.'
  return 'Your blocked list is unavailable right now. Try again.'
}
