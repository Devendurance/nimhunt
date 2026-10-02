import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import Phaser from 'phaser'
import { DirectionalDpad } from '../components/play/DirectionalDpad'
import { traversalViewport } from '../game/traversal/angkorV2/camera'
import { StageScene } from '../game/stage1/StageScene'
import { initialStageState, type StageState } from '../game/stage1/model'
import { GEM_RUNNER_STAGES } from '../game/gemRunner/contracts'
import { expeditionCarry, type GemRunnerState } from '../game/gemRunner/model'
import { GemRunnerRuntime } from '../game/gemRunner/runtime'
import { outerRuinsAdapter } from '../game/gemRunner/outerRuinsAdapter'
import './angkorV2Stage1.css'
import './gemRunnerExpedition.css'

interface OuterRuinsProps { runtime: GemRunnerRuntime; expedition: GemRunnerState; onSnapshot: (state: GemRunnerState) => void; debug: boolean }
function ExpeditionOuterRuins({ runtime, expedition, onSnapshot, debug }: OuterRuinsProps) {
  const host = useRef<HTMLDivElement>(null), scene = useRef<StageScene | null>(null), heading = useRef<HTMLHeadingElement>(null)
  const [stage, setStage] = useState<StageState>(initialStageState), [ready, setReady] = useState(false), [error, setError] = useState('')
  useEffect(() => {
    if (!host.current) return
    let mounted = true
    const run = runtime.attachStage(outerRuinsAdapter), carry = expeditionCarry(runtime.state)
    const instance = new StageScene({ carry, viewport: traversalViewport(window.innerWidth, window.innerHeight),
      reduceAction: action => {
        if (action.type === 'RESET') throw new Error('An expedition attempt cannot reset its current stage')
        const next = run.dispatch(action); if (mounted) onSnapshot(runtime.state); return next
      },
      onReady: value => { scene.current = value; value.start(); if (mounted) setReady(true) },
      onState: value => { if (mounted) setStage(value) }, onError: message => { if (mounted) setError(message) }, onSound: () => {},
    })
    const game = new Phaser.Game({ type: Phaser.CANVAS, parent: host.current, ...instance.options.viewport, backgroundColor: '#132a26', render: { antialias: true }, scale: { mode: Phaser.Scale.NONE }, fps: { target: 60 }, scene: [instance] })
    return () => { mounted = false; scene.current = null; game.destroy(true) }
  }, [runtime, onSnapshot])
  useEffect(() => { scene.current?.setDebug(debug) }, [debug, ready])
  const finished = expedition.status === 'TRANSITION', failed = expedition.status === 'FAILED'
  useEffect(() => { if (finished || failed) heading.current?.focus() }, [finished, failed])
  const result = expedition.stageResults[0]
  return <>
    <div className="stage-hud"><strong>STAGE GEMS {stage.stageGems} / 6</strong><span className="health" aria-label={'Health ' + expedition.hp + ' of 100'}><span style={{ width: expedition.hp + '%' }} /></span><strong>HP {expedition.hp}</strong></div>
    <p className="runtime-total">Expedition Gems: {expedition.expeditionGems}<span>One attempt · HP carries forward</span></p>
    <div className="stage-viewport"><div ref={host} />
      {!ready && !error && <div className="stage-overlay" role="status">Loading Outer Ruins…</div>}
      {(finished || failed) && <div className="stage-overlay runtime-transition" role="region" aria-label={finished ? 'Stage I complete' : 'Expedition failed'}>
        <p className="eyebrow">{finished ? 'STAGE I COMPLETE' : 'EXPEDITION FAILED'}</p>
        <h2 ref={heading} tabIndex={-1}>OUTER RUINS</h2>
        {finished ? <><dl><div><dt>Gems secured</dt><dd>{result.stageGems}</dd></div><div><dt>Total expedition Gems</dt><dd>{result.expeditionGems}</dd></div><div><dt>HP remaining</dt><dd>{result.hpRemaining}</dd></div></dl><p className="small">NEXT: STAGE II — OVERGROWN TEMPLE</p><button type="button" onClick={() => onSnapshot(runtime.continue())}>Continue deeper</button></> : <><p>HP remaining: 0<br />This expedition attempt has ended.</p><p className="small">Completed results remain available in Debug.</p></>}
      </div>}
    </div>
    {error && <p role="alert">{error}</p>}
    <div className="stage-controls"><DirectionalDpad inputLocked={!ready || Boolean(error) || expedition.status !== 'PLAYING'} onMove={direction => scene.current?.traversal?.tap(direction)} heldInput={{ press: (source, direction) => scene.current?.traversal?.press(source, direction), release: source => scene.current?.traversal?.release(source), cancel: source => scene.current?.traversal?.cancel(source) }} /></div>
  </>
}
export function GemRunnerExpeditionQA() {
  const [runtime] = useState(() => new GemRunnerRuntime()), [expedition, setExpedition] = useState(runtime.state)
  const [started, setStarted] = useState(false), [debug, setDebug] = useState(false)
  const contractHeading = useRef<HTMLHeadingElement>(null)
  const definition = GEM_RUNNER_STAGES[expedition.currentStageIndex], contractOnly = expedition.currentStage !== 'outer-ruins'
  useEffect(() => { if (contractOnly) contractHeading.current?.focus() }, [contractOnly])
  const exportEnvelope = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(runtime.envelope(), null, 2)], { type: 'application/json' }))
    const link = document.createElement('a'); link.href = url; link.download = 'angkor-v2-gem-runner-local.json'; link.click(); URL.revokeObjectURL(url)
  }
  return <main className="stage-shell runtime-shell" data-expedition={JSON.stringify(expedition)}>
    <header><div><p className="eyebrow">GEM RUNNER · STAGE {definition.numeral}</p><h1>{definition.name}</h1></div><label><input type="checkbox" checked={debug} onChange={e => setDebug(e.target.checked)} /> Debug</label></header>
    {!started ? <section className="runtime-contract"><h2>Enter Angkor</h2><p>Start one expedition through the ruins.<br />Carry your remaining HP and secured Gems deeper.</p><p className="small">Outer Ruins is playable. Stages II and III are contracts awaiting gameplay.</p><button type="button" onClick={() => setStarted(true)}>Start fresh expedition</button></section> : contractOnly ? <section className="runtime-contract" aria-label="Stage II contract ready">
      <p className="eyebrow">STAGE II — OVERGROWN TEMPLE</p><h2 ref={contractHeading} tabIndex={-1}>READY_FOR_STAGE_2</h2><p>NOT BUILT YET</p><dl><div><dt>HP carried</dt><dd>{expedition.hp}</dd></div><div><dt>Total expedition Gems</dt><dd>{expedition.expeditionGems}</dd></div><div><dt>Stage Gems</dt><dd>{expedition.stageGems}</dd></div></dl><p className="small">The expedition is prepared for Stage II.<br />Its gameplay adapter and map have not been built.</p>
    </section> : <ExpeditionOuterRuins runtime={runtime} expedition={expedition} onSnapshot={setExpedition} debug={debug} />}
    <p className="runtime-footer">Isolated development runtime · <a href="/dev/angkor-v2-stage1.html">Standalone Stage I QA</a></p>
    {debug && <section className="stage-debug" aria-label="Expedition debug"><button type="button" onClick={exportEnvelope}>Export expedition envelope</button><p>Current stage: {expedition.currentStage}<br />Status: {expedition.status}<br />Zero-based stage index: {expedition.currentStageIndex}</p><h3>Carry state</h3><pre>{JSON.stringify(expeditionCarry(expedition), null, 2)}</pre><h3>Completed stage results</h3><pre>{JSON.stringify(expedition.stageResults, null, 2)}</pre><h3>Expedition event log</h3><pre>{JSON.stringify(expedition.events, null, 2)}</pre><h3>Expedition state</h3><pre>{JSON.stringify(expedition, null, 2)}</pre></section>}
  </main>
}
if (import.meta.env.DEV) {
  const root = createRoot(document.getElementById('root')!)
  root.render(<GemRunnerExpeditionQA />)
  import.meta.hot?.dispose(() => root.unmount())
}
