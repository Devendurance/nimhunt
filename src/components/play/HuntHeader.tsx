import { brandAssets } from '../../data/assets'
import type { AdventurerProfile } from '../../domain/adventurer.ts'
import { AdventurerAvatarToken } from './AdventurerAvatar'
import { SoundToggle } from './SoundToggle'
import styles from './PlayShell.module.css'

export function HuntHeader({
  profile,
  onProfileClick,
}: {
  readonly profile?: AdventurerProfile | null
  readonly onProfileClick?: (trigger: HTMLButtonElement) => void
}) {
  const openProfile = onProfileClick ?? (() => {})
  return <header className={styles.header}>
    <a className={styles.wordmark} href="/play" aria-label="NimHunt hunt home">
      <img src={brandAssets.wordmark} alt="NimHunt" width={160} height={34} decoding="async" />
    </a>
    <div className={styles.headerRight}>
      {profile
        ? <button type="button" className={styles.profileIdentity} onClick={event => openProfile(event.currentTarget)} aria-label={`Open Adventurer profile for ${profile.displayName}`}>
          <span className={styles.profileIdentityText}>{profile.displayName}</span>
          <span className={styles.profileIdentityGems} aria-label={`${profile.stats.lifetimeGems} lifetime gems`}>💎 {profile.stats.lifetimeGems}</span>
          <AdventurerAvatarToken avatarId={profile.avatarId} size="small" />
        </button>
        : <span className={styles.headerContext}>ADVENTURER</span>}
      <SoundToggle />
    </div>
  </header>
}
