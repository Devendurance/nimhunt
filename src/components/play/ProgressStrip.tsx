import type { PlayFixture } from '../../types/play'
import { PlayIcon } from './PlayIcon'
import styles from './PlayShell.module.css'

export function ProgressStrip({ fixture }: { fixture: PlayFixture }) {
  return <section className={styles.progressSection} aria-labelledby="progress-heading">
    <div className={styles.sectionHeading}><div><span className={styles.kicker}>YOUR EXPEDITION LOG</span><h2 id="progress-heading">Progress</h2></div></div>
    <div className={styles.progressStrip}>
      <div><span className={`${styles.progressIcon} ${styles.gemIcon}`}><PlayIcon name="gem" size={18} /></span><strong>{fixture.gems}</strong><span>gems</span></div>
      <div><span className={`${styles.progressIcon} ${styles.pointsIcon}`}><PlayIcon name="star" size={18} /></span><strong>{fixture.points.toLocaleString()}</strong><span>points</span></div>
      <div><span className={`${styles.progressIcon} ${styles.streakIcon}`}><PlayIcon name="flame" size={18} /></span><strong>{fixture.streakDays}</strong><span>day streak</span></div>
    </div>
    <p className={styles.disclosure}>Gems are not redeemable for NIM in the current build.</p>
  </section>
}
