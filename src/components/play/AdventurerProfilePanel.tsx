import { useEffect, useState } from 'react'
import { fetchAdventurerSocialOverview } from '../../api/adventurer.ts'
import type { AdventurerSocialOverview } from '../../domain/adventurerSocial.ts'
import type { AdventurerProfile } from '../../domain/adventurer.ts'
import { AdventurerAvatarToken } from './AdventurerAvatar'
import styles from './Adventurer.module.css'

export function AdventurerProfilePanel({
  profile,
  onOpenAllies,
  onOpenEditProfile,
  onOpenSettings,
  onClose,
}: {
  readonly profile: AdventurerProfile
  readonly onOpenAllies: () => void
  readonly onOpenEditProfile: () => void
  readonly onOpenSettings: () => void
  readonly onClose: () => void
}) {
  const [social, setSocial] = useState<{ readonly status: 'loading' } | { readonly status: 'ready'; readonly overview: AdventurerSocialOverview } | { readonly status: 'unavailable' }>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    void fetchAdventurerSocialOverview()
      .then(overview => { if (!cancelled) setSocial({ status: 'ready', overview }) })
      .catch(() => { if (!cancelled) setSocial({ status: 'unavailable' }) })
    return () => { cancelled = true }
  }, [profile.updatedAt])

  return <div className={styles.profileSheet}>
    <div className={styles.profileHero}>
      <AdventurerAvatarToken avatarId={profile.avatarId} size="large" />
      <div>
        <p className="eyebrow">MY ADVENTURER</p>
        <h2 id="adventurer-profile-title">{profile.displayName}</h2>
        <p>Your persistent identity for NimHunt.</p>
      </div>
    </div>

    <div className={styles.profileStats} aria-label="Adventurer stats">
      <div className={styles.profileStat}><strong>{profile.stats.lifetimeGems}</strong><span>LIFETIME GEMS</span></div>
      <div className={styles.profileStat}><strong>{profile.stats.expeditionsCompleted}</strong><span>EXPEDITIONS</span></div>
      <div className={styles.profileStat}><strong>{profile.stats.bestStreak}</strong><span>BEST STREAK</span></div>
    </div>

    <div className={styles.profileSection}>
      <h3>Social</h3>
      {social.status === 'loading' && <p className={styles.profileStatus} role="status">Loading Allies…</p>}
      {social.status === 'unavailable' && <p className={styles.profileError} role="status">Allies are temporarily unavailable.</p>}
      {social.status === 'ready' && <button type="button" className={styles.socialSummaryButton} onClick={onOpenAllies}>
        <span><strong>{social.overview.allyCount}</strong> Allies</span>
        <span><strong>{social.overview.incomingPendingCount}</strong> pending requests</span>
        <span aria-hidden="true">›</span>
      </button>}
    </div>

    <div className={styles.profileActions}>
      <button type="button" className={styles.primaryAction} onClick={onOpenEditProfile}>Edit Profile</button>
      <button type="button" className={styles.secondaryAction} onClick={onOpenSettings}>Settings</button>
      <button type="button" className={styles.secondaryAction} onClick={onClose} autoFocus>Close profile</button>
    </div>
  </div>
}
