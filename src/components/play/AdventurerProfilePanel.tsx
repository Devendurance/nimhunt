import { useEffect, useState } from 'react'
import { fetchAdventurerSocialOverview } from '../../api/adventurer.ts'
import type { AdventurerSocialOverview } from '../../domain/adventurerSocial.ts'
import type { AdventurerProfile } from '../../domain/adventurer.ts'
import { AvatarPicker, AdventurerAvatarToken } from './AdventurerAvatar'
import styles from './Adventurer.module.css'

export function AdventurerProfilePanel({
  profile,
  updateAvatar,
  updateError,
  onOpenAllies,
  onClose,
}: {
  readonly profile: AdventurerProfile
  readonly updateAvatar: (avatarId: string) => Promise<boolean>
  readonly updateError: string | null
  readonly onOpenAllies: () => void
  readonly onClose: () => void
}) {
  const titleId = 'adventurer-profile-title'
  const [avatarId, setAvatarId] = useState(profile.avatarId)
  const [saving, setSaving] = useState(false)
  const [social, setSocial] = useState<{ readonly status: 'loading' } | { readonly status: 'ready'; readonly overview: AdventurerSocialOverview } | { readonly status: 'unavailable' }>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    void fetchAdventurerSocialOverview()
      .then(overview => { if (!cancelled) setSocial({ status: 'ready', overview }) })
      .catch(() => { if (!cancelled) setSocial({ status: 'unavailable' }) })
    return () => { cancelled = true }
  }, [profile.updatedAt])

  const saveAvatar = async () => {
    if (avatarId === profile.avatarId) return
    setSaving(true)
    await updateAvatar(avatarId)
    setSaving(false)
  }

  return <div className={styles.profileSheet}>
    <div className={styles.profileHero}>
      <AdventurerAvatarToken avatarId={profile.avatarId} size="large" />
      <div>
        <p className="eyebrow">MY ADVENTURER</p>
        <h2 id={titleId}>{profile.displayName}</h2>
        <p>Identity anchored to your connected wallet.</p>
      </div>
    </div>

    <div className={styles.profileStats} aria-label="Adventurer stats">
      <div className={styles.profileStat}><strong>{profile.stats.lifetimeGems}</strong><span>GEMS FOUND</span></div>
      <div className={styles.profileStat}><strong>{profile.stats.expeditionsCompleted}</strong><span>EXPEDITIONS</span></div>
      <div className={styles.profileStat}><strong>{profile.stats.bestStreak}</strong><span>BEST STREAK</span></div>
    </div>

    <div className={styles.profileSection}>
      <h3>Allies</h3>
      {social.status === 'loading' && <p className={styles.profileStatus} role="status">Loading social status…</p>}
      {social.status === 'unavailable' && <p className={styles.profileError} role="status">Allies are temporarily unavailable.</p>}
      {social.status === 'ready' && <button type="button" className={styles.socialSummaryButton} onClick={onOpenAllies}>
        <span><strong>{social.overview.allyCount}</strong> Allies</span>
        <span><strong>{social.overview.incomingPendingCount}</strong> pending requests</span>
        <span aria-hidden="true">›</span>
      </button>}
    </div>

    <div className={styles.profileSection}>
      <h3>Change avatar</h3>
      <AvatarPicker value={avatarId} onChange={setAvatarId} disabled={saving} title="Change avatar" />
      {updateError && <p className={styles.profileError} role="status" aria-live="polite">{avatarError(updateError)}</p>}
      <button type="button" className={styles.primaryAction} disabled={saving || avatarId === profile.avatarId} onClick={() => void saveAvatar()}>
        {saving ? 'Saving avatar…' : 'Save avatar'}
      </button>
    </div>

    <button type="button" className={styles.secondaryAction} onClick={onClose} autoFocus>Close profile</button>
  </div>
}

function avatarError(error: string): string {
  if (error === 'AVATAR_UNAVAILABLE') return 'That crest is unavailable. Choose another.'
  if (error === 'ADVENTURER_SESSION_INVALID') return 'Your Adventurer session expired. Reconnect to continue.'
  return 'The crest could not be saved. Try again.'
}
