import type { PlayTab } from '../../types/play'
import { PlayIcon, type PlayIconName } from './PlayIcon'
import styles from './PlayShell.module.css'

const tabs: readonly { id: PlayTab; label: string; icon: PlayIconName }[] = [
  { id: 'hunt', label: 'Hunt', icon: 'compass' },
  { id: 'missions', label: 'Missions', icon: 'listChecks' },
  { id: 'heroes', label: 'Heroes', icon: 'trophy' },
]

export function PlayBottomNav({ activeTab, onChange }: { activeTab: PlayTab; onChange: (tab: PlayTab) => void }) {
  return <nav className={styles.bottomNav} aria-label="Mini App navigation">{tabs.map(tab => <button key={tab.id} className={activeTab === tab.id ? styles.navItemActive : styles.navItem} type="button" aria-current={activeTab === tab.id ? 'page' : undefined} onClick={() => onChange(tab.id)}><PlayIcon name={tab.icon} size={17} />{tab.label}</button>)}</nav>
}
