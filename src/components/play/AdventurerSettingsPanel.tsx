import type { AdventurerProfile } from '../../domain/adventurer.ts'
import { useSoundEnabled } from '../../audio/useNimhuntAudio'
import { useHapticsEnabled } from '../../input/useNimhuntHaptics'
import { shortenNqWallet } from './productVaultSeal'
import styles from './Adventurer.module.css'

export function AdventurerSettingsPanel({
  profile,
  wallet,
  onBack,
  onOpenBlocked,
}: {
  readonly profile: AdventurerProfile
  readonly wallet: string | null
  readonly onBack: () => void
  readonly onOpenBlocked: () => void
}) {
  const sound = useSoundEnabled()
  const haptics = useHapticsEnabled()

  return <div className={styles.profileSheet}>
    <div className={styles.subviewHeader}>
      <button type="button" className={styles.backAction} onClick={onBack}>← My Adventurer</button>
      <p className="eyebrow">MY ADVENTURER</p>
      <h2 id="adventurer-settings-title">Settings</h2>
      <p>Control the parts of NimHunt that are live today.</p>
    </div>

    <section className={styles.settingsGroup} aria-labelledby="settings-game-heading">
      <h3 id="settings-game-heading">Game</h3>
      <button type="button" className={styles.settingsRow} onClick={sound.toggle} aria-pressed={sound.enabled}>
        <span><strong>Sound</strong><small>Music and sound effects</small></span>
        <span className={styles.settingsValue}>{sound.enabled ? 'On' : 'Off'}</span>
      </button>
      {haptics.supported && <button type="button" className={styles.settingsRow} onClick={haptics.toggle} aria-pressed={haptics.enabled}>
        <span><strong>Haptics</strong><small>Subtle touch feedback</small></span>
        <span className={styles.settingsValue}>{haptics.enabled ? 'On' : 'Off'}</span>
      </button>}
    </section>

    <section className={styles.settingsGroup} aria-labelledby="settings-account-heading">
      <h3 id="settings-account-heading">Account</h3>
      <div className={styles.settingsInfoRow}>
        <span><strong>Connected wallet</strong><small>Wallet recovery and reward ownership</small></span>
        <span className={styles.settingsValue}>{wallet ? shortenNqWallet(wallet) : 'Not connected'}</span>
      </div>
    </section>

    <section className={styles.settingsGroup} aria-labelledby="settings-social-heading">
      <h3 id="settings-social-heading">Social</h3>
      <button type="button" className={styles.settingsRow} onClick={onOpenBlocked}>
        <span><strong>Blocked Adventurers</strong><small>Private list; unblocking restores no old requests or Allies</small></span>
        <span className={styles.settingsChevron} aria-hidden="true">›</span>
      </button>
    </section>

    <section className={styles.settingsGroup} aria-labelledby="settings-about-heading">
      <h3 id="settings-about-heading">About</h3>
      <div className={styles.aboutCopy}>
        <strong>How NimHunt works</strong>
        <p>Complete daily expeditions, survive the ruins, and seal eligible NIM rewards through your wallet. Practice runs stay separate from reward history.</p>
        <small>NimHunt v0.0.0 · Adventurer {profile.displayName}</small>
      </div>
    </section>

    <button type="button" className={styles.secondaryAction} onClick={onBack}>Back to My Adventurer</button>
  </div>
}
