import { PlayIcon } from './PlayIcon'
import styles from './PlayShell.module.css'

/**
 * Personal progress strip. Shows neutral placeholders until live wallet
 * activity is available; never fabricated values.
 */
export function ProgressStrip() {
  return <section className={styles.progressSection} aria-labelledby="progress-heading">
    <div className={styles.sectionHeading}><div><span className={styles.kicker}>YOUR EXPEDITION LOG</span><h2 id="progress-heading">Progress</h2></div></div>
    <div className={styles.progressStrip}>
      <div><span className={`${styles.progressIcon} ${styles.gemIcon}`}><PlayIcon name="gem" size={18} /></span><strong>—</strong><span>gems</span></div>
      <div><span className={`${styles.progressIcon} ${styles.pointsIcon}`}><PlayIcon name="star" size={18} /></span><strong>—</strong><span>points</span></div>
      <div><span className={`${styles.progressIcon} ${styles.streakIcon}`}><PlayIcon name="flame" size={18} /></span><strong>—</strong><span>day streak</span></div>
    </div>
    <p className={styles.disclosure}>Live standings update in the heroes tab. Reserved NIM treasure is tracked separately.</p>
  </section>
}
