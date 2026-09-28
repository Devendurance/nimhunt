import { useEffect, useRef, useState } from 'react'
import { heroCategories } from '../../data/marketing'
import { formatHeroValue, HERO_CATEGORIES, monthLabel, type MonthlyHeroLeader, type MonthlyHeroesResponse } from '../../domain/monthlyHeroes'
import { useMonthlyHeroes } from '../play/useMonthlyHeroes'
import { AdventurerAvatarToken } from '../play/AdventurerAvatar'
import { PublicAdventurerProfileSheet } from '../play/PublicAdventurerProfileSheet'

/**
 * Production Hall of Heroes: live current-month standings from verified
 * expeditions. No fixtures, no demo names, public Adventurer identity only.
 */
export function HallOfHeroesLive() {
  const state = useMonthlyHeroes()
  const [playerId, setPlayerId] = useState<string | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    if (playerId && dialogRef.current && !dialogRef.current.open) dialogRef.current.showModal()
  }, [playerId])

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
    {(state.status === 'ready' || state.status === 'empty') && <LiveBoards heroes={state.heroes} onOpenProfile={(nextPlayerId, trigger) => {
      triggerRef.current = trigger
      setPlayerId(nextPlayerId)
    }} />}
    {playerId && <dialog
      ref={dialogRef}
      className="public-adventurer-dialog"
      aria-label="Public Adventurer profile"
      onClose={() => {
        setPlayerId(null)
        requestAnimationFrame(() => triggerRef.current?.focus())
      }}
    >
      <PublicAdventurerProfileSheet playerId={playerId} onClose={() => dialogRef.current?.close()} />
    </dialog>}
  </section>
}

function LiveBoards({ heroes, onOpenProfile }: {
  readonly heroes: MonthlyHeroesResponse
  readonly onOpenProfile: (playerId: string, trigger: HTMLButtonElement) => void
}) {
  const relic = heroes.categories.find(category => category.heroId === 'relic-keeper')
  const top = (relic?.leaders ?? []).slice(0, 3)
  return <>
    <p className="footnote">Live standings · {monthLabel(heroes.monthKey)}</p>
    <div className="heroes-layout">
      <div className="leaderboard">
        <div className="board-heading"><h3>Most Points</h3><span>Live rankings</span></div>
        {top.length === 0
          ? <><ol /><p>No heroes crowned yet.<br />The next name could be yours.</p></>
          : <ol>{top.map(row => <li key={row.rank}><span className="rank">0{row.rank}</span><LeaderIdentity leader={row} onOpenProfile={onOpenProfile} /><strong>{formatHeroValue('points', row.value)}</strong></li>)}</ol>}
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
          : <ol>{leaders.map(row => <li key={row.rank}><span className="rank">0{row.rank}</span><LeaderIdentity leader={row} onOpenProfile={onOpenProfile} /><strong>{formatHeroValue(def.metricKey, row.value)}</strong></li>)}</ol>}
      </div>
    })}</div>
  </>
}

function LeaderIdentity({ leader, onOpenProfile }: {
  readonly leader: MonthlyHeroLeader
  readonly onOpenProfile: (playerId: string, trigger: HTMLButtonElement) => void
}) {
  const content = <>
    <AdventurerAvatarToken avatarId={leader.avatarId} size="small" />
    <span className="leader-adventurer-name">{leader.displayName}</span>
  </>
  if (!leader.playerId) return <span className="leader-adventurer">{content}</span>
  return <button
    type="button"
    className="leader-adventurer-button"
    aria-label={`Open Adventurer profile for ${leader.displayName}`}
    onClick={event => onOpenProfile(leader.playerId!, event.currentTarget)}
  >{content}</button>
}
