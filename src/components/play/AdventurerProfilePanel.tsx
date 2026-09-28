import { useState } from 'react'
import type { AdventurerProfile } from '../../domain/adventurer.ts'
import { AvatarPicker, AdventurerAvatarToken } from './AdventurerAvatar'
import styles from './Adventurer.module.css'

export function AdventurerProfilePanel({
  profile,
  updateAvatar,
  updateError,
  onClose,
}: {
  readonly profile: AdventurerProfile
  readonly updateAvatar: (avatarId: string) => Promise<boolean>
  readonly updateError: string | null
  readonly onClose: () => void
}) {
  const titleId = 'adventurer-profile-title'
  const [avatarId, setAvatarId] = useState(profile.avatarId)
  const [saving, setSaving] = useState(false)

  const saveAvatar = async () => {
    if (avatarId === profile.avatarId) return
    setSaving(true)
    await updateAvatar(avatarId)
    setSaving(false)
  }

  return <div className={styles.profileSheet} role="dialog" aria-modal="true" aria-labelledby={titleId}>
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
      <h3>Change crest</h3>
      <AvatarPicker value={avatarId} onChange={setAvatarId} disabled={saving} />
      {updateError && <p className={styles.profileError} role="status" aria-live="polite">{avatarError(updateError)}</p>}
      <button type="button" className={styles.primaryAction} disabled={saving || avatarId === profile.avatarId} onClick={() => void saveAvatar()}>
        {saving ? 'Saving crest…' : 'Save crest'}
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
