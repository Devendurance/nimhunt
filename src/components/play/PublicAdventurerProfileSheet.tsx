import { useEffect, useState } from 'react'
import { fetchPublicAdventurerProfile } from '../../api/adventurer.ts'
import type { PublicAdventurerProfile } from '../../domain/adventurer.ts'
import { AdventurerAvatarToken } from './AdventurerAvatar'
import styles from './Adventurer.module.css'

type PublicProfileState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly profile: PublicAdventurerProfile }
  | { readonly status: 'unavailable' }

export function PublicAdventurerProfileSheet({
  playerId,
  onClose,
}: {
  readonly playerId: string
  readonly onClose: () => void
}) {
  const [state, setState] = useState<PublicProfileState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    void fetchPublicAdventurerProfile(playerId)
      .then(profile => {
        if (!cancelled) setState({ status: 'ready', profile })
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'unavailable' })
      })
    return () => {
      cancelled = true
    }
  }, [playerId])

  return <div className={styles.publicProfileSheet} aria-busy={state.status === 'loading'}>
    {state.status === 'loading' && <p className={styles.profileStatus} role="status">Loading Adventurer profile…</p>}
    {state.status === 'unavailable' && <p className={styles.profileError} role="alert">This Adventurer profile is unavailable.</p>}
    {state.status === 'ready' && <PublicProfileContent profile={state.profile} />}
    <button type="button" className={styles.secondaryAction} onClick={onClose} autoFocus>Close profile</button>
  </div>
}

function PublicProfileContent({ profile }: { readonly profile: PublicAdventurerProfile }) {
  return <>
    <div className={styles.profileHero}>
      <AdventurerAvatarToken avatarId={profile.avatarId} size="large" />
      <div>
        <p className="eyebrow">PUBLIC ADVENTURER</p>
        <h2 id="public-adventurer-profile-title">{profile.displayName}</h2>
      </div>
    </div>
    <div className={styles.profileStats} aria-label="Public Adventurer stats">
      <div className={styles.profileStat}><strong>{profile.lifetimeGems}</strong><span>LIFETIME GEMS</span></div>
      <div className={styles.profileStat}><strong>{profile.expeditionsCompleted}</strong><span>EXPEDITIONS</span></div>
      <div className={styles.profileStat}><strong>{profile.bestStreak}</strong><span>BEST STREAK</span></div>
    </div>
  </>
}
