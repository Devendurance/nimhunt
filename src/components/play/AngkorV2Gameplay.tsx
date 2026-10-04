import { useEffect, useRef, useState, type ReactNode } from 'react'
import { DirectionalDpad } from './DirectionalDpad'
import { SoundToggle } from './SoundToggle'
import { traversalViewport } from '../../game/traversal/angkorV2/camera'
import { createProofScene, type ProofScene } from '../../game/angkorV2Proof/createScene'
import type { V2Session } from '../../game/angkorV2Proof/session'
import { getSharedAudio } from '../../audio/nimhuntAudio'
import { useMissionBgm } from '../../audio/useNimhuntAudio'
import { getMissionTitle } from '../../game/domain/mission'
import './AngkorV2Gameplay.css'

export function AngkorV2Gameplay({ session, practice, onLeave, completion }: { session: V2Session; practice: boolean; onLeave: () => void; completion?: ReactNode }) {
  const [, render] = useState(0), host = useRef<HTMLDivElement>(null), scene = useRef<ProofScene | null>(null)
  const terminalHeading = useRef<HTMLHeadingElement>(null)
  const [loadedStage, setLoadedStage] = useState(''), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const v2 = session.state.angkorV2!, e = v2.expedition, stageId = e.currentStage
  useMissionBgm(e.mission)
  useEffect(() => session.subscribe(() => render(n => n + 1)), [session])
  useEffect(() => {
    let alive = true, destroy: (() => void) | undefined
    void (async () => {
      const [{ default: Phaser }, instance] = await Promise.all([import('phaser'), createProofScene(session, {
        viewport: traversalViewport(window.innerWidth, window.innerHeight),
        onReady: s => { if (alive) { scene.current = s; s.start(); setLoadedStage(stageId) } },
        onError: message => { if (alive) setError(message) }, onNotice: message => { if (alive) setNotice(message) }, onSound: kind => { getSharedAudio().playSfx(kind === 'gem' ? 'treasure' : kind === 'unlock' ? 'open-gate' : 'lose-life') },
      })])
      if (!alive || !host.current) return
      const viewport = traversalViewport(window.innerWidth, window.innerHeight)
      const game = new Phaser.Game({ type: Phaser.CANVAS, parent: host.current, ...viewport, backgroundColor: '#132a26',
        render: { antialias: true }, scale: { mode: Phaser.Scale.NONE }, scene: [instance] })
      destroy = () => game.destroy(true)
    })().catch(() => { if (alive) setError('The ruins could not load. Reload to try again.') })
    return () => { alive = false; scene.current = null; destroy?.() }
  }, [session, stageId])
  useEffect(() => {
    const flush = () => { void session.flush().catch(() => undefined) }
    window.addEventListener('pagehide', flush); window.addEventListener('blur', flush)
    return () => { window.removeEventListener('pagehide', flush); window.removeEventListener('blur', flush) }
  }, [session])
  const stageName = stageId.split('-').map(s => s[0].toUpperCase() + s.slice(1)).join(' ')
  const objective = e.mission === 'gem-runner' ? `GEMS ${e.stageGems} / ${[6, 7, 8][e.currentStageIndex]} · Expedition ${e.expeditionGems}`
    : e.mission === 'chest-hunter' ? `CHESTS ${e.stageChestsOpened} / ${[4, 5, 6][e.currentStageIndex]} · Expedition ${e.expeditionChestsOpened}`
    : stageId === 'temple-approach' ? 'Breach the Outer Seal · activate the Mechanism Gate'
    : stageId === 'ancient-mechanism' ? 'Align the seals · awaken the Core · open the Inner Lock'
    : 'Bait the guardian onto three anchors · break the vault · reach the Shrine'
  const finished = e.status === 'COMPLETE', failed = e.status === 'FAILED', transition = e.status === 'TRANSITION'
  useEffect(() => { if (transition || finished || failed) terminalHeading.current?.focus({ preventScroll: true }) }, [transition, finished, failed, stageId])
  const locked = loadedStage !== stageId || !session.canAct || Boolean(error)
  return <main className="angkor-v2-play">
    <header><div><span className="v2-kicker">ANGKOR RUINS · {practice ? 'PRACTICE' : 'REWARD EXPEDITION'}</span><h1>{getMissionTitle(e.mission)}</h1></div><SoundToggle /></header>
    <div className="v2-stage-heading"><h2>Stage {['I', 'II', 'III'][e.currentStageIndex]} — {stageName}</h2><strong>HP {e.hp}</strong></div>
    <p className="v2-objective">{objective}</p>
    {e.mission === 'chest-hunter' && e.currentStageIndex === 2 && <p>Secure the Royal Cache before leaving.</p>}
    {e.mission === 'gem-runner' && e.currentStageIndex === 2 && <p>Land three environmental boulder hits on the Anaconda.</p>}
    <p className="v2-carry">{e.carriedItems.sword ? 'Sword carried' : 'No sword'} · Potion {e.carriedItems.potion.consumed ? 'used' : e.carriedItems.potion.owned ? 'available' : 'not acquired'}</p>
    <div className="v2-room"><div ref={host} />
      {loadedStage !== stageId && !error && <div className="v2-overlay" role="status">Entering {stageName}…</div>}
      {(transition || finished || failed) && <div className="v2-overlay" role="region" aria-label={transition ? 'Stage complete' : finished ? 'Expedition complete' : 'Expedition failed'}>
        <h2 ref={terminalHeading} tabIndex={-1}>{failed ? 'EXPEDITION FAILED' : finished ? `${getMissionTitle(e.mission).toUpperCase()} COMPLETE` : `STAGE ${['I', 'II', 'III'][e.currentStageIndex]} COMPLETE`}</h2>
        <p>{stageName}<br />HP remaining: {e.hp}</p>
        {e.mission === 'gem-runner' && <p>{e.stageResults.map((r, i) => <span key={r.stageId}>Stage {['I', 'II', 'III'][i]} Gems: {r.stageGems}<br /></span>)}Total Gems: {e.expeditionGems}</p>}
        {e.mission === 'chest-hunter' && <p>{e.stageResults.map((r, i) => <span key={r.stageId}>Stage {['I', 'II', 'III'][i]} chests: {r.stageChestsOpened}<br /></span>)}Total chests: {e.expeditionChestsOpened}<br />Treasure Gems: {e.expeditionGems}</p>}
        {finished && e.mission === 'vault-breaker' && <p>Outer Seal breached<br />Ancient Mechanism solved<br />Inner Vault broken<br />Optional Gems: {e.stageResults.reduce((n, r) => n + r.optionalGemCount, 0)}<br /><strong>THE VAULT IS OPEN</strong></p>}
        {transition && <button disabled={session.syncing || Boolean(session.error)} onClick={() => void session.continue().catch(() => setNotice('Connection interrupted. Retry synchronization to continue.'))}>Continue deeper</button>}
        {(finished || failed) && practice && <><p>Practice only · no reward or attempt consumed</p><button onClick={onLeave}>Back to missions</button></>}
      </div>}
    </div>
    <DirectionalDpad inputLocked={locked} onMove={d => scene.current?.traversal?.tap(d)} heldInput={{ press: (source, d) => scene.current?.traversal?.press(source, d), release: source => scene.current?.traversal?.release(source), cancel: source => scene.current?.traversal?.cancel(source) }} />
    <p className="v2-notice" role="status">{session.error || error || notice || (practice ? 'Explore all three stages. Practice never creates a reward expedition.' : session.syncing ? 'Saving expedition…' : 'Progress saves to the expedition checkpoint.')}</p>
    {!practice && <button onClick={() => void session.flush().then(() => setNotice('Expedition saved.')).catch(() => setNotice('Connection interrupted. Retry to save.'))}>Retry synchronization</button>}
    <button onClick={() => void session.flush().then(onLeave).catch(() => setNotice('Save did not finish. Retry before leaving.'))}>{practice ? 'Leave practice' : 'Save and leave'}</button>
    {(finished || failed) && completion}
  </main>
}
