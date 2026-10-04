import { useEffect, useState } from 'react'
import { formatExpeditionsLeftToday, resolveHuntStatusView, type HuntTreasureSource } from './huntStatusView'
import styles from './PlayShell.module.css'

export function HuntStatus({ hunt }: { hunt: HuntTreasureSource }) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (hunt.kind !== 'live') return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [hunt.kind])

  const view = resolveHuntStatusView(hunt, now)
  const attemptsLabel = formatExpeditionsLeftToday(hunt.walletStatus) ?? 'Expedition attempts unknown'

  return <section className={styles.status} aria-labelledby="hunt-status-heading" aria-busy={view.busy}>
    <div className={styles.statusEyebrow}>
      <span className={styles.statusDot} aria-hidden="true" />
      <span id="hunt-status-heading">TODAY'S HUNT</span>
      <span className={styles.fixtureBadge}>{view.badge}</span>
    </div>
    <div className={styles.rewardWeek}>
      <strong>{String(view.treasuresTotal) === '7' ? '7 DAILY TREASURES' : 'DAILY TREASURES'}</strong>
      <span>{String(view.treasuresTotal) === '7' ? '1,000 NIM EACH · 7,000 NIM SHARED DAILY' : 'Remaining treasures reset at UTC midnight.'}</span>
      <small>FIRST COME, FIRST SERVED</small>
    </div>
    <div className={styles.statusGrid}>
      <div className={styles.treasureMetric}>
        <strong>{view.treasuresRemaining}<span> / {view.treasuresTotal}</span></strong>
        <span>treasures remain</span>
      </div>
      <div className={styles.statusMetric} aria-label={attemptsLabel}>
        <strong>{view.expeditionsRemaining}</strong>
        <span>{view.expeditionsLabel}</span>
      </div>
      <div className={styles.statusMetric}>
        <strong>{view.resetDisplay}</strong>
        <span>reset in</span>
      </div>
    </div>
  </section>
}
