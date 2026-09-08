import { playAssets } from '../../data/assets'
import { PlayIcon } from './PlayIcon'
import styles from './PlayShell.module.css'

export function WorldStatus() {
  return <section className={styles.worldSection} aria-labelledby="world-heading">
    <div className={styles.sectionHeading}><div><span className={styles.kicker}>WORLD SELECT</span><h2 id="world-heading">Choose your ruins</h2></div></div>
    <article className={styles.worldAvailable}>
      <img src={playAssets.angkor} alt="Angkor Ruins temple path in the jungle" width={1672} height={941} loading="eager" decoding="async" />
      <div className={styles.worldOverlay}><span>WORLD 01 · AVAILABLE</span><strong>ANGKOR RUINS</strong></div>
    </article>
    <div className={styles.lockedWorlds} aria-label="Locked worlds">
      <div><PlayIcon name="lock" size={17} /><span>BAVARIA</span><small>COMING SOON</small></div>
      <div><PlayIcon name="lock" size={17} /><span>SIBERIA</span><small>COMING SOON</small></div>
    </div>
  </section>
}
