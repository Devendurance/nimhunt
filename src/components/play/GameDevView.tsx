import { useEffect, useMemo, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Gem, Heart, LogOut, RotateCcw, Triangle, Droplets, KeyRound, Sword, Package } from 'lucide-react'
import { getMissionObjective, getMissionTitle, parseMissionParam } from '../../game/domain/mission'
import type { Direction } from '../../game/world/grid'
import { useAngkorRun } from './useAngkorRun'
import styles from './GameDevView.module.css'

const directions = [
  { direction: 'UP', label: 'Up', Icon: ArrowUp },
  { direction: 'LEFT', label: 'Left', Icon: ArrowLeft },
  { direction: 'RIGHT', label: 'Right', Icon: ArrowRight },
  { direction: 'DOWN', label: 'Down', Icon: ArrowDown },
] as const

export function GameDevView() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const mission = parseMissionParam(params.get('mission'))
  const isChestHunter = mission === 'chest-hunter'
  const isVault = mission === 'vault-breaker'
  const gameOptions = useMemo(() => ({ mode: 'dev' as const, mission }), [mission])
  const { containerRef: canvasContainerRef, hud, move, reset } = useAngkorRun(gameOptions)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const upRef = useRef<HTMLButtonElement>(null)
  const previousStatus = useRef('PLAYING')
  const terminal = hud.runStatus !== 'PLAYING'

  useEffect(() => {
    if (hud.runStatus !== 'PLAYING') headingRef.current?.focus({ preventScroll: true })
    else if (previousStatus.current !== 'PLAYING') upRef.current?.focus({ preventScroll: true })
    previousStatus.current = hud.runStatus
  }, [hud.runStatus])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement && (event.target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName))) return
      const mapping: Record<string, Direction> = { ArrowUp: 'UP', w: 'UP', ArrowDown: 'DOWN', s: 'DOWN', ArrowLeft: 'LEFT', a: 'LEFT', ArrowRight: 'RIGHT', d: 'RIGHT' }
      const direction = mapping[event.key] ?? mapping[event.key.toLowerCase()]
      if (direction) { event.preventDefault(); if (!terminal) move(direction) }
      if (!terminal && event.key.toLowerCase() === 'r') { event.preventDefault(); reset() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [move, reset, terminal])

  const returnToMissions = () => navigate('/play', { state: { initialTab: 'missions' } })
  const missionTitle = getMissionTitle(mission)
  const missionObjective = getMissionObjective(mission)

  return <div className={styles.shell}><main className={styles.viewport}>
    <header className={styles.header}>
      <div><span className={styles.kicker}>NIMHUNT · DEVELOPMENT</span><h1 className={styles.title}>Angkor Ruins · Room 01</h1></div>
      <button type="button" className={styles.exitBtn} onClick={() => navigate('/play')}><LogOut size={16} aria-hidden="true" />Exit</button>
    </header>
    <section className={styles.hudCard} aria-label={`${missionTitle} mission progress`}>
      <div className={styles.missionLabel}>{missionTitle}<span>{missionObjective}</span></div>
      <div className={styles.metrics}>
        <div><span><Heart size={16} aria-hidden="true" /> HP <strong data-testid="hp">{hud.hp} / 100</strong></span><progress max={100} value={hud.hp} aria-label="Health" /></div>
        {isChestHunter
          ? <span><Package size={18} aria-hidden="true" /> CHESTS <strong data-testid="chests">{hud.chestsOpened} / {hud.chestTarget}</strong></span>
          : isVault
            ? <span><KeyRound size={18} aria-hidden="true" /> VAULT <strong data-testid="vault">{hud.objectiveReached ? 'Reached' : hud.hasTempleKey ? 'Key found' : 'Locked'}</strong></span>
            : <span><Gem size={18} aria-hidden="true" /> GEMS <strong data-testid="gems">{hud.gemsCollected} / {hud.gemTarget}</strong></span>}
      </div>
      <div className={styles.keyState}>
        <span className={styles.itemBadge}><KeyRound size={14} aria-hidden="true" />KEY <strong>{hud.hasTempleKey ? 'Found' : 'Not found'}</strong></span>
        <span className={styles.itemBadge}><Sword size={14} aria-hidden="true" />SWORD <strong>{hud.hasSword ? 'Ready' : 'None'}</strong></span>
        <span className={styles.notice} role="status">{hud.notice}</span>
      </div>
    </section>
    <div className={styles.canvasWrapper}><div ref={canvasContainerRef} className={styles.canvasInner} role="img" aria-label="Room 01: push the stone boulder to reach the Temple Key. The blue shrine is visible beyond the locked gate on the right. Eight sapphire gems, spikes and poison remain in the ruins. Use the directional controls to move." /></div>
    <p className={styles.legend}><span><Triangle size={14} aria-hidden="true" />Spikes −25 HP</span><span><Droplets size={14} aria-hidden="true" />Poison −20 HP</span></p>
    {hud.objectiveReached && !terminal && <section className={styles.chamber} role="status"><h2>INNER CHAMBER REACHED</h2><p>The path is open.</p><p>Development milestone only. No treasure claim is available yet.</p></section>}
    <div className={styles.controlsArea}>
      {terminal ? <section className={styles.outcome} aria-labelledby="run-outcome">
        <h2 id="run-outcome" ref={headingRef} tabIndex={-1}>{hud.runStatus === 'MISSION_COMPLETE' ? 'MISSION COMPLETE' : 'THE RUINS WON THIS ROUND'}</h2>
        {hud.runStatus === 'MISSION_COMPLETE'
          ? isChestHunter
            ? <><strong>Chest Hunter</strong><p>4 / 4 chests opened</p><p>You survived the expedition.</p><p>Development milestone only. No NIM claim is available yet.</p></>
            : <><strong>Gem Runner</strong><p>6 / 6 gems collected</p><p>You survived the expedition.</p><p>Development milestone only. No NIM claim is available yet.</p></>
          : <><p>Mission failed.</p><p>No NIM claim was created.</p></>}
        <div className={styles.actions}><button type="button" onClick={reset}>Reset run</button><button type="button" onClick={returnToMissions}>Return to missions</button></div>
      </section> : <div className={styles.dpad} role="group" aria-label="Directional Controls" onContextMenu={event => event.preventDefault()}>
        {directions.map(({ direction, label, Icon }) => <button key={direction} ref={direction === 'UP' ? upRef : undefined} type="button" className={styles.dpadBtn + ' ' + styles[direction.toLowerCase()]} aria-label={'Move ' + label} onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); move(direction) }} onClick={event => { if (event.detail === 0) move(direction) }}><Icon size={24} aria-hidden="true" /></button>)}
        <button type="button" className={styles.dpadBtn + ' ' + styles.dpadCenter} aria-label="Reset run" onClick={reset}><RotateCcw size={16} aria-hidden="true" /><span>Reset run</span></button>
      </div>}
    </div>
    <details className={styles.debug}><summary>Debug details</summary><p data-testid="coordinates">X {hud.gridX} · Y {hud.gridY} · {hud.facing} · Steps {hud.stepCount} · {hud.isMoving ? 'MOVING' : 'IDLE'}</p><p>{hud.missionStatus} · {hud.runStatus}</p><p>Arrow keys / WASD to move · R to reset</p></details>
  </main></div>
}
