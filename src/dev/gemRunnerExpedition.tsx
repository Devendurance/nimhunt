import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import Phaser from 'phaser'
import { DirectionalDpad } from '../components/play/DirectionalDpad'
import { traversalViewport } from '../game/traversal/angkorV2/camera'
import { STAGE_AREAS as sanctuaryAreas } from '../game/stage3/level'
import { inZone } from '../game/stage1/level'
import { Stage3Scene } from '../game/stage3/Stage3Scene'
import { initialStageState as initialStage3, type StageState as Stage3State } from '../game/stage3/model'
import { innerSanctuaryAdapter } from '../game/gemRunner/innerSanctuaryAdapter'
import { Stage2Scene } from '../game/stage2/Stage2Scene'
import { initialStageState as initialStage2, type StageState as Stage2State } from '../game/stage2/model'
import { overgrownTempleAdapter } from '../game/gemRunner/overgrownTempleAdapter'
import { StageScene } from '../game/stage1/StageScene'
import { initialStageState, type StageState } from '../game/stage1/model'
import { GEM_RUNNER_STAGES } from '../game/gemRunner/contracts'
import { expeditionCarry, type GemRunnerState } from '../game/gemRunner/model'
import { GemRunnerRuntime } from '../game/gemRunner/runtime'
import { outerRuinsAdapter } from '../game/gemRunner/outerRuinsAdapter'
import './angkorV2Stage1.css'
import './gemRunnerExpedition.css'

interface PlayableStageProps { runtime: GemRunnerRuntime; expedition: GemRunnerState; onSnapshot: (state: GemRunnerState) => void; debug: boolean }
function ExpeditionPlayableStage({ runtime, expedition, onSnapshot, debug }: PlayableStageProps) {
  const host = useRef<HTMLDivElement>(null), scene = useRef<StageScene | Stage2Scene | Stage3Scene | null>(null), heading = useRef<HTMLHeadingElement>(null)
  const [stage, setStage] = useState<StageState | Stage2State | Stage3State>(() => runtime.state.currentStage === 'outer-ruins' ? initialStageState(expeditionCarry(runtime.state)) : runtime.state.currentStage === 'overgrown-temple' ? initialStage2(expeditionCarry(runtime.state)) : initialStage3(expeditionCarry(runtime.state))), [ready, setReady] = useState(false), [error, setError] = useState('')
  useEffect(() => {
    if (!host.current) return
    let mounted = true
    const carry = expeditionCarry(runtime.state)
    const common = { carry, viewport: traversalViewport(window.innerWidth, window.innerHeight),
      onReady: (value: StageScene | Stage2Scene | Stage3Scene) => { scene.current = value; value.start(); if (mounted) setReady(true) },
      onState: (value: StageState | Stage2State | Stage3State) => { if (mounted) setStage(value) },
      onError: (message: string) => { if (mounted) setError(message) }, onSound: () => {},
    }
    let instance: StageScene | Stage2Scene | Stage3Scene
    if (runtime.state.currentStage === 'outer-ruins') {
      const run = runtime.attachStage(outerRuinsAdapter)
      instance = new StageScene({ ...common, reduceAction: action => {
        if (action.type === 'RESET') throw new Error('An expedition attempt cannot reset its current stage')
        const next = run.dispatch(action); if (mounted) onSnapshot(runtime.state); return next
      } })
    } else if (runtime.state.currentStage === 'overgrown-temple') {
      const run = runtime.attachStage(overgrownTempleAdapter)
      instance = new Stage2Scene({ ...common, reduceAction: action => {
        const next = run.dispatch(action); if (mounted) onSnapshot(runtime.state); return next
      } })
    } else {
      const run = runtime.attachStage(innerSanctuaryAdapter)
      instance = new Stage3Scene({ ...common, reduceAction: action => {
        const next = run.dispatch(action); if (mounted) onSnapshot(runtime.state); return next
      } })
    }
    const game = new Phaser.Game({ type: Phaser.CANVAS, parent: host.current, ...instance.options.viewport, backgroundColor: '#132a26', render: { antialias: true }, scale: { mode: Phaser.Scale.NONE }, fps: { target: 60 }, scene: [instance] })
    return () => { mounted = false; scene.current = null; game.destroy(true) }
  }, [runtime, onSnapshot])
  useEffect(() => { scene.current?.setDebug(debug) }, [debug, ready])
  const complete = expedition.status === 'COMPLETE', finished = expedition.status === 'TRANSITION', failed = expedition.status === 'FAILED'
  useEffect(() => { if (finished || failed || complete) heading.current?.focus() }, [finished, failed, complete])
  const result = expedition.stageResults[expedition.currentStageIndex]
  const definition = GEM_RUNNER_STAGES[expedition.currentStageIndex], nextStage = GEM_RUNNER_STAGES[expedition.currentStageIndex + 1]
  const requirement = definition.id === 'outer-ruins' ? 6 : definition.id === 'overgrown-temple' ? 7 : 8
  return <>
    <div className="stage-hud"><strong>STAGE GEMS {stage.stageGems} / {requirement}</strong><span className="health" aria-label={'Health ' + expedition.hp + ' of 100'}><span style={{ width: expedition.hp + '%' }} /></span><strong>HP {expedition.hp}</strong></div>
    <p className="runtime-total">Expedition Gems: {expedition.expeditionGems}<span>One attempt · HP carries forward</span></p>
    {definition.id === 'inner-sanctuary' && <p className="area-name">{sanctuaryAreas.find(area => inZone(stage.player, area))?.name ?? 'Carved connector'}</p>}
    {definition.id === 'inner-sanctuary' && <p className="encounter-hint" aria-live="polite">{'anaconda' in stage && stage.anaconda.mode === 'retreated' ? 'The Anaconda retreats. Escape Passage is open.' : 'anaconda' in stage && stage.anaconda.mode !== 'dormant' ? `Marked strikes survived: ${Math.min(stage.anaconda.strikesResolved, 3)} / 3 · Sanctum: ${Math.min(stage.anaconda.sanctumStrikes, 1)} / 1. Secure 8 Gems to escape.` : 'Survive 3 marked strikes, including 1 in the Sanctum. Secure 8 Gems to escape.'}</p>}
    <div className="stage-viewport"><div ref={host} />
      {!ready && !error && <div className="stage-overlay" role="status">Loading {definition.name}…</div>}
      {(finished || failed || complete) && <div className="stage-overlay runtime-transition" role="region" aria-label={complete ? 'Gem Runner complete' : finished ? 'Stage ' + definition.numeral + ' complete' : 'Expedition failed'}>
        <p className="eyebrow">{complete ? 'GEM RUNNER COMPLETE' : finished ? 'STAGE ' + definition.numeral + ' COMPLETE' : 'EXPEDITION FAILED'}</p>
        <h2 ref={heading} tabIndex={-1}>{complete ? 'ANGKOR RUINS' : definition.name.toUpperCase()}</h2>
        {complete ? <><dl>{expedition.stageResults.map((r, i) => <div key={r.stageId}><dt>Stage {GEM_RUNNER_STAGES[i].numeral} Gems</dt><dd>{r.stageGems}</dd></div>)}<div><dt>Total Gems</dt><dd>{expedition.expeditionGems}</dd></div><div><dt>HP remaining</dt><dd>{expedition.hp}</dd></div></dl><p className="small">EXPEDITION COMPLETE</p></> : finished ? <><dl><div><dt>Gems secured</dt><dd>{result.stageGems}</dd></div><div><dt>Total expedition Gems</dt><dd>{result.expeditionGems}</dd></div><div><dt>HP remaining</dt><dd>{result.hpRemaining}</dd></div></dl><p className="small">NEXT: STAGE {nextStage.numeral} — {nextStage.name.toUpperCase()}</p><button type="button" onClick={() => onSnapshot(runtime.continue())}>Continue deeper</button></> : <><p>HP remaining: 0<br />This expedition attempt has ended.</p><p className="small">Completed results remain available in Debug.</p></>}
      </div>}
    </div>
    {error && <p role="alert">{error}</p>}
    <div className="stage-controls"><DirectionalDpad inputLocked={!ready || Boolean(error) || expedition.status !== 'PLAYING'} onMove={direction => scene.current?.traversal?.tap(direction)} heldInput={{ press: (source, direction) => scene.current?.traversal?.press(source, direction), release: source => scene.current?.traversal?.release(source), cancel: source => scene.current?.traversal?.cancel(source) }} /></div>
    {debug && <section className="stage-debug" aria-label="Stage debug"><h3>Stage state · coordinate, Anaconda, blocked cells, wildlife and events</h3><pre>{JSON.stringify(stage, null, 2)}</pre></section>}
  </>
}
export function GemRunnerExpeditionQA() {
  const [runtime] = useState(() => new GemRunnerRuntime()), [expedition, setExpedition] = useState(runtime.state)
  const [started, setStarted] = useState(false), [debug, setDebug] = useState(false)
  const definition = GEM_RUNNER_STAGES[expedition.currentStageIndex]
  const exportEnvelope = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(runtime.envelope(), null, 2)], { type: 'application/json' }))
    const link = document.createElement('a'); link.href = url; link.download = 'angkor-v2-gem-runner-local.json'; link.click(); URL.revokeObjectURL(url)
  }
  return <main className="stage-shell runtime-shell" data-expedition={JSON.stringify(expedition)}>
    <header><div><p className="eyebrow">GEM RUNNER · STAGE {definition.numeral}</p><h1>{definition.name}</h1></div><label><input type="checkbox" checked={debug} onChange={e => setDebug(e.target.checked)} /> Debug</label></header>
    {!started ? <section className="runtime-contract"><h2>Enter Angkor</h2><p>Start one expedition through the ruins.<br />Carry your remaining HP and secured Gems deeper.</p><p className="small">Explore three stages. Read marked danger tiles and move before impacts.</p><button type="button" onClick={() => setStarted(true)}>Start fresh expedition</button></section> : <ExpeditionPlayableStage key={expedition.currentStage} runtime={runtime} expedition={expedition} onSnapshot={setExpedition} debug={debug} />}
    <p className="runtime-footer">Isolated development runtime · <a href="/dev/angkor-v2-stage1.html">Standalone Stage I QA</a></p>
    {debug && <section className="stage-debug" aria-label="Expedition debug"><button type="button" onClick={exportEnvelope}>Export expedition envelope</button><p>Current stage: {expedition.currentStage}<br />Status: {expedition.status}<br />Zero-based stage index: {expedition.currentStageIndex}</p><h3>Carry state</h3><pre>{JSON.stringify(expeditionCarry(expedition), null, 2)}</pre><h3>Completed stage results</h3><pre>{JSON.stringify(expedition.stageResults, null, 2)}</pre><h3>Expedition event log</h3><pre>{JSON.stringify(expedition.events, null, 2)}</pre><h3>Expedition state</h3><pre>{JSON.stringify(expedition, null, 2)}</pre></section>}
  </main>
}
if (import.meta.env.DEV) {
  const root = createRoot(document.getElementById('root')!)
  root.render(<GemRunnerExpeditionQA />)
  import.meta.hot?.dispose(() => root.unmount())
}
