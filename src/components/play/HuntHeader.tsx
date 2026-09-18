import { brandAssets } from '../../data/assets'
import { SoundToggle } from './SoundToggle'
import styles from './PlayShell.module.css'

export function HuntHeader() {
  return <header className={styles.header}>
    <a className={styles.wordmark} href="/play" aria-label="NimHunt hunt home">
      <img src={brandAssets.wordmark} alt="NimHunt" width={160} height={34} decoding="async" />
    </a>
    <div className={styles.headerRight}>
      <span className={styles.headerContext}>ANGKOR RUINS</span>
      <SoundToggle />
    </div>
  </header>
}
