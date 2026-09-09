import type { Mission } from '../../types/play'
import { getBriefState } from './expeditionFlow'
import { PlayIcon } from './PlayIcon'
import styles from './PlayShell.module.css'

export function MissionCard({ mission, onEnter }: { mission: Mission; onEnter: (mission: Mission, trigger: HTMLButtonElement) => void }) {
  const brief = getBriefState(mission.id)
  const locked = !brief.canStart
  return <article className={styles.missionCard} aria-disabled={locked || undefined}>
    <div className={styles.missionIcon} aria-hidden="true"><PlayIcon name={mission.icon === 'chest' ? 'package' : mission.icon === 'key' ? 'key' : 'gem'} size={22} /></div>
    <div className={styles.missionBody}>
      <div className={styles.missionMeta}><span>{mission.number} / EXPEDITION BRIEF</span><span className={locked ? styles.comingNext : styles.available}><i aria-hidden="true" /> {brief.badge}</span></div>
      <h3>{mission.title}</h3>
      <p>{mission.objective}</p>
      {locked
        ? <button className={styles.enterButton} type="button" disabled aria-disabled="true" title="Vault Breaker arrives in a later build">Coming next <PlayIcon name="arrowUpRight" size={16} /></button>
        : <button className={styles.enterButton} type="button" onClick={event => onEnter(mission, event.currentTarget)}>Enter ruins <PlayIcon name="arrowUpRight" size={16} /></button>}
    </div>
  </article>
}
