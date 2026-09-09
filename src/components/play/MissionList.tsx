import type { Mission } from '../../types/play'
import { MissionCard } from './MissionCard'
import styles from './PlayShell.module.css'

export function MissionList({ missions, onEnter, compact = false }: { missions: readonly Mission[]; onEnter: (mission: Mission, trigger: HTMLButtonElement) => void; compact?: boolean }) {
  const availableCount = missions.filter(mission => mission.status === 'available').length
  return <section className={compact ? styles.missionSectionCompact : styles.missionSection} aria-labelledby="missions-heading">
    <div className={styles.sectionHeading}>
      <div><span className={styles.kicker}>THE DAILY BOARD</span><h2 id="missions-heading">Today's missions</h2></div>
      <span className={styles.fixtureBadge}>{availableCount} AVAILABLE</span>
    </div>
    {!compact && <p className={styles.sectionIntro}>Choose your route. The task is clear before the ruins open.</p>}
    <div className={styles.missionList}>{missions.map(mission => <MissionCard key={mission.id} mission={mission} onEnter={onEnter} />)}</div>
  </section>
}
