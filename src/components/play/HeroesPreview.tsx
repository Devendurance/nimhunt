import type { PlayFixture } from '../../types/play'
import styles from './PlayShell.module.css'

export function HeroesPreview({ fixture, compact = false }: { fixture: PlayFixture; compact?: boolean }) {
  return <section className={compact ? styles.heroesSectionCompact : styles.heroesSection} aria-labelledby="heroes-heading">
    <div className={styles.sectionHeading}><div><span className={styles.kicker}>HALL OF HEROES</span><h2 id="heroes-heading">Your place in the ruins</h2></div>{compact && <span className={styles.fixtureBadge}>PREVIEW</span>}</div>
    <div className={styles.heroPreviewCard}>
      <div><span className={styles.sampleLabel}>SAMPLE HERO NAME</span><strong>{fixture.heroName}</strong></div>
      <div><span className={styles.sampleLabel}>SAMPLE RANK</span><strong>#{fixture.sampleRank}</strong></div>
      <div><span className={styles.sampleLabel}>POINTS · STREAK</span><strong>{fixture.points.toLocaleString()} · {fixture.streakDays} days</strong></div>
    </div>
    <p className={styles.disclosure}>Demo ranking preview · no real identity or wallet address is connected.</p>
  </section>
}
