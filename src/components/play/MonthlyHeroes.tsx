import { HERO_CATEGORIES, formatHeroValue, maskWalletAddress, monthLabel, type MonthlyHeroesResponse, type WalletMonthlyStatsResponse } from '../../domain/monthlyHeroes.ts'
import { useMonthlyHeroes, useWalletMonthlyStats } from './useMonthlyHeroes.ts'
import styles from './MonthlyHeroes.module.css'

const LEADERS_SHOWN = 5

export function MonthlyHeroesSection({ heroes, selfWallet }: {
  readonly heroes: MonthlyHeroesResponse
  readonly selfWallet?: string | null
}) {
  const selfMasked = selfWallet ? maskWalletAddress(selfWallet) : null
  return <section className={styles.heroes} aria-labelledby="monthly-heroes-heading">
    <div className={styles.heroesEyebrow}><span>MONTHLY HEROES</span><span>{monthLabel(heroes.monthKey)}</span></div>
    <h2 id="monthly-heroes-heading" className={styles.heroesTitle}>Hall of Heroes</h2>
    <p className={styles.heroesSub}>Live standings from verified expeditions this month. Only proven runs count.</p>
    <ol className={styles.heroGrid}>
      {heroes.categories.map(category => {
        const def = HERO_CATEGORIES.find(entry => entry.heroId === category.heroId)
        if (!def) return null
        const leaders = category.leaders.slice(0, LEADERS_SHOWN)
        return <li key={category.heroId} className={styles.heroCard}>
          <span className={styles.heroName}>{category.title}</span>
          <span className={styles.heroMetric}>{category.metricLabel}</span>
          {leaders.length === 0
            ? <p className={styles.noLeaders}>No heroes crowned yet. The next name could be yours.</p>
            : <ol className={styles.leaderList}>
              {leaders.map(leader => {
                const isYou = selfMasked !== null && leader.maskedWallet === selfMasked
                return <li key={leader.rank} className={styles.leaderRow} data-you={isYou ? 'true' : 'false'}>
                  <span className={styles.leaderRank}>#{leader.rank}</span>
                  <span className={styles.leaderWallet}>{leader.maskedWallet}</span>
                  {isYou && <span className={styles.youBadge}>YOU</span>}
                  <span className={styles.leaderValue}>{formatHeroValue(def.metricKey, leader.value)}</span>
                </li>
              })}
            </ol>}
        </li>
      })}
    </ol>
  </section>
}

export function YourMonthSection({ monthly }: { readonly monthly: WalletMonthlyStatsResponse }) {
  const stats = monthly.stats
  const cells: Array<{ label: string; value: string; rank?: number | null }> = [
    { label: 'Points', value: stats.points.toLocaleString('en-US'), rank: monthly.ranks['relic-keeper'] },
    { label: 'Gems', value: String(stats.gemsCollected) },
    { label: 'Chests', value: String(stats.chestsOpened), rank: monthly.ranks.chestbreaker },
    { label: 'Completed', value: String(stats.expeditionsCompleted) },
    { label: 'Failed', value: String(stats.expeditionsFailed), rank: monthly.ranks['fallen-legend'] },
    { label: 'Vaults sealed', value: String(stats.vaultsSealed) },
    { label: 'Expedition time', value: formatExpeditionTime(stats.expeditionMinutes), rank: monthly.ranks.pathfinder },
    { label: 'Current streak', value: `${stats.currentStreak} day${stats.currentStreak === 1 ? '' : 's'}` },
    { label: 'Best streak', value: `${stats.bestStreak} day${stats.bestStreak === 1 ? '' : 's'}`, rank: monthly.ranks.unbroken },
    { label: 'NIM delivered', value: `${trimNim(stats.nimDelivered)} NIM`, rank: monthly.ranks['golden-hand'] },
  ]
  return <section className={styles.monthPanel} aria-labelledby="your-month-heading">
    <span id="your-month-heading" className={styles.monthTitle}>Your month · {monthLabel(monthly.monthKey)}</span>
    <div className={styles.monthGrid}>
      {cells.map(cell => <div key={cell.label} className={styles.monthMetric}>
        <strong>{cell.value}</strong>
        <span>{cell.label}</span>
        {cell.rank !== null && cell.rank !== undefined && <span className={styles.monthRank}>Ranked #{cell.rank}</span>}
      </div>)}
    </div>
  </section>
}

export function MonthlyHeroesBlock({ selfWallet }: { readonly selfWallet?: string | null }) {
  const state = useMonthlyHeroes()
  if (state.status === 'loading') {
    return <section className={styles.heroes} aria-labelledby="monthly-heroes-heading">
      <div className={styles.heroesEyebrow}><span>MONTHLY HEROES</span></div>
      <h2 id="monthly-heroes-heading" className={styles.heroesTitle}>Hall of Heroes</h2>
      <p className={styles.heroesState} role="status">Loading this month&apos;s heroes…</p>
    </section>
  }
  if (state.status === 'unavailable') {
    return <section className={styles.heroes} aria-labelledby="monthly-heroes-heading">
      <div className={styles.heroesEyebrow}><span>MONTHLY HEROES</span></div>
      <h2 id="monthly-heroes-heading" className={styles.heroesTitle}>Hall of Heroes</h2>
      <p className={styles.heroesState} role="status">Hero standings are unavailable right now.</p>
      <button className={styles.heroesRetry} type="button" onClick={state.retry}>Retry</button>
    </section>
  }
  return <MonthlyHeroesSection heroes={state.heroes} selfWallet={selfWallet} />
}

export function YourMonthBlock({ enabled, sessionKey, onUnauthorized }: {
  readonly enabled: boolean
  readonly sessionKey?: string | number
  readonly onUnauthorized?: () => void
}) {
  const state = useWalletMonthlyStats({ enabled, sessionKey, onUnauthorized })
  if (!enabled || state.status === 'unauthorized') return null
  if (state.status === 'loading') {
    return <section className={styles.monthPanel} aria-label="Your month">
      <span className={styles.monthTitle}>Your month</span>
      <p className={styles.heroesState} role="status">Loading your month…</p>
    </section>
  }
  if (state.status === 'unavailable') {
    return <section className={styles.monthPanel} aria-label="Your month">
      <span className={styles.monthTitle}>Your month</span>
      <p className={styles.heroesState} role="status">Your monthly stats are unavailable right now.</p>
      <button className={styles.heroesRetry} type="button" onClick={state.retry}>Retry</button>
    </section>
  }
  return <YourMonthSection monthly={state.monthly} />
}

function formatExpeditionTime(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`
}

function trimNim(value: number): string {
  return String(Math.round(value * 100000) / 100000)
}
