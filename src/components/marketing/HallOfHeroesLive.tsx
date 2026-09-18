import { heroCategories } from '../../data/marketing'
import { formatHeroValue, HERO_CATEGORIES, monthLabel, type MonthlyHeroesResponse } from '../../domain/monthlyHeroes'
import { useMonthlyHeroes } from '../play/useMonthlyHeroes'

/**
 * Production Hall of Heroes: live current-month standings from verified
 * expeditions. No fixtures, no demo names, masked wallets only.
 */
export function HallOfHeroesLive() {
  const state = useMonthlyHeroes()
  return <section className="section heroes-section" id="heroes" aria-labelledby="heroes-heading">
    <div className="section-heading">
      <div><span className="section-label">05 / Hall of Heroes</span><h2 id="heroes-heading">The ruins remember.</h2></div>
      <p>Track points, streaks, chests, active expedition time, and NIM collected. Each month, the leaders become Monthly Heroes.</p>
    </div>
    {state.status === 'loading' && <p role="status">Loading this month&apos;s heroes…</p>}
    {state.status === 'unavailable' && <div>
      <p role="status">Hero standings are unavailable right now. Proven runs still count toward next month&apos;s board.</p>
      <button className="button secondary" type="button" onClick={state.retry}>Retry</button>
    </div>}
    {(state.status === 'ready' || state.status === 'empty') && <LiveBoards heroes={state.heroes} />}
  </section>
}

function LiveBoards({ heroes }: { heroes: MonthlyHeroesResponse }) {
  const relic = heroes.categories.find(category => category.heroId === 'relic-keeper')
  const top = (relic?.leaders ?? []).slice(0, 3)
  return <>
    <p className="footnote">Live standings · {monthLabel(heroes.monthKey)}</p>
    <div className="heroes-layout">
      <div className="leaderboard">
        <div className="board-heading"><h3>Most Points</h3><span>Live rankings</span></div>
        {top.length === 0
          ? <><ol /><p>No heroes crowned yet.<br />The next name could be yours.</p></>
          : <ol>{top.map(row => <li key={row.rank}><span className="rank">0{row.rank}</span><span>{row.maskedWallet}</span><strong>{formatHeroValue('points', row.value)}</strong></li>)}</ol>}
      </div>
      <div className="honours"><span className="section-label">Six ways to be remembered</span><ul>{heroCategories.map(hero => <li key={hero.title}><h3>{hero.title}</h3><span>{hero.category}</span></li>)}</ul></div>
    </div>
    <div className="heroes-live-grid">{heroes.categories.map(category => {
      const def = HERO_CATEGORIES.find(entry => entry.heroId === category.heroId)
      if (!def) return null
      const leaders = category.leaders.slice(0, 3)
      return <div className="leaderboard" key={category.heroId}>
        <div className="board-heading"><h3>{category.title}</h3><span>{category.metricLabel}</span></div>
        {leaders.length === 0
          ? <p>No heroes crowned yet.<br />The next name could be yours.</p>
          : <ol>{leaders.map(row => <li key={row.rank}><span className="rank">0{row.rank}</span><span>{row.maskedWallet}</span><strong>{formatHeroValue(def.metricKey, row.value)}</strong></li>)}</ol>}
      </div>
    })}</div>
  </>
}
