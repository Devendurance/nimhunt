import type { Mission } from '../../types/play'
import { PlayIcon } from './PlayIcon'
import styles from './PlayShell.module.css'

export function MissionCard({ mission, onEnter }: { mission: Mission; onEnter: (mission: Mission, trigger: HTMLButtonElement) => void }) {
  return <article className={styles.missionCard}>
    <div className={styles.missionIcon}><PlayIcon name={mission.icon === 'chest' ? 'package' : mission.icon === 'key' ? 'key' : 'gem'} size={22} /></div>
    <div className={styles.missionBody}>
      <div className={styles.missionMeta}><span>{mission.number} / EXPEDITION BRIEF</span><span className={styles.available}><i aria-hidden="true" /> AVAILABLE</span></div>
      <h3>{mission.title}</h3>
      <p>{mission.objective}</p>
      <button className={styles.enterButton} type="button" onClick={event => onEnter(mission, event.currentTarget)}>Enter ruins <PlayIcon name="arrowUpRight" size={16} /></button>
    </div>
  </article>
}
