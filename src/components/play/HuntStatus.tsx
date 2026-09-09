import { useEffect, useState } from 'react'
import type { PlayFixture } from '../../types/play'
import { resolveHuntStatusView } from './huntStatusView'
import styles from './PlayShell.module.css'
import { useDailyHuntStatus } from './useDailyHuntStatus'

export function HuntStatus({ fixture }: { fixture: PlayFixture }) {
  const hunt = useDailyHuntStatus()
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (hunt.kind !== 'live') return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [hunt])

  const view = resolveHuntStatusView(hunt, fixture, now)

  return <section className={styles.status} aria-labelledby="hunt-status-heading" aria-busy={view.busy}>
    <div className={styles.statusEyebrow}>
      <span className={styles.statusDot} aria-hidden="true" />
      <span id="hunt-status-heading">TODAY'S HUNT</span>
      <span className={styles.fixtureBadge}>{view.badge}</span>
    </div>
    <div className={styles.statusGrid}>
      <div className={styles.treasureMetric}>
        <strong>{view.treasuresRemaining}<span> / {view.treasuresTotal}</span></strong>
        <span>treasures remain</span>
      </div>
      <div className={styles.statusMetric}>
        <strong>{view.expeditionsRemaining}</strong>
        <span>expeditions left · sample</span>
      </div>
      <div className={styles.statusMetric}>
        <strong>{view.resetDisplay}</strong>
        <span>{view.live ? 'reset in' : 'reset preview'}</span>
      </div>
    </div>
  </section>
}
