import type { PlayFixture } from '../../types/play'
import styles from './PlayShell.module.css'

export function HuntStatus({ fixture }: { fixture: PlayFixture }) {
  return <section className={styles.status} aria-labelledby="hunt-status-heading">
    <div className={styles.statusEyebrow}>
      <span className={styles.statusDot} aria-hidden="true" />
      <span id="hunt-status-heading">TODAY'S HUNT</span>
      <span className={styles.fixtureBadge}>SAMPLE DATA · NOT LIVE</span>
    </div>
    <div className={styles.statusGrid}>
      <div className={styles.treasureMetric}>
        <strong>{fixture.treasuresRemaining}<span> / {fixture.treasuresTotal}</span></strong>
        <span>treasures remain</span>
      </div>
      <div className={styles.statusMetric}>
        <strong>{fixture.expeditionsRemaining}</strong>
        <span>expeditions left</span>
      </div>
      <div className={styles.statusMetric}>
        <strong>{fixture.resetIn}</strong>
        <span>reset preview</span>
      </div>
    </div>
  </section>
}
