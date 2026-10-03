import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import Phaser from 'phaser'
import { DirectionalDpad } from '../components/play/DirectionalDpad'
import { traversalViewport } from '../game/traversal/angkorV2/camera'
import { ChestHunterScene } from '../game/chestHunter/stage1/ChestHunterScene'
import { ForgottenGalleriesScene } from '../game/chestHunter/stage2/ForgottenGalleriesScene'
import { initialStageState as initialI, type StageState as StateI } from '../game/chestHunter/stage1/model'
import { initialStageState as initialII, type StageState as StateII } from '../game/chestHunter/stage2/model'
import { AREAS as areasI, inZone } from '../game/chestHunter/stage1/level'
import { RoyalTreasuryScene } from '../game/chestHunter/stage3/RoyalTreasuryScene'
import { initialStageState as initialIII, type StageState as StateIII } from '../game/chestHunter/stage3/model'
import { AREAS as areasIII } from '../game/chestHunter/stage3/level'
import { AREAS as areasII } from '../game/chestHunter/stage2/level'
import { CHEST_HUNTER_STAGES } from '../game/chestHunter/contracts'
import { expeditionCarry, type ChestHunterState } from '../game/chestHunter/model'
import { ChestHunterRuntime } from '../game/chestHunter/runtime'
import { lostCourtyardAdapter, forgottenGalleriesAdapter, royalTreasuryAdapter } from '../game/chestHunter/adapters'
import './angkorV2Stage1.css'
import './chestHunterStage1.css'

interface PlayProps { runtime: ChestHunterRuntime; expedition: ChestHunterState; onSnapshot: (state: ChestHunterState) => void; debug: boolean; sound: boolean }
function PlayableStage({ runtime, expedition, onSnapshot, debug, sound }: PlayProps) {
  const host = useRef<HTMLDivElement>(null), scene = useRef<ChestHunterScene | ForgottenGalleriesScene | RoyalTreasuryScene | null>(null), audio = useRef<AudioContext | null>(null), soundOn = useRef(sound), heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => { soundOn.current = sound }, [sound])
  const [local, setLocal] = useState<StateI | StateII | StateIII>(() => runtime.state.currentStage === 'lost-courtyard' ? initialI(expeditionCarry(runtime.state)) : runtime.state.currentStage==='forgotten-galleries' ? initialII(expeditionCarry(runtime.state)) : initialIII(expeditionCarry(runtime.state)))
  const [ready, setReady] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('Walk onto treasure to open it.')
  useEffect(() => {
    if (!host.current) return
    let mounted = true
    audio.current = new AudioContext(); void audio.current.resume()
    const common = { carry: expeditionCarry(runtime.state), viewport: traversalViewport(window.innerWidth, window.innerHeight),
      onReady: (value: ChestHunterScene | ForgottenGalleriesScene | RoyalTreasuryScene) => { scene.current = value; value.start(); if (mounted) setReady(true) },
      onState: (value: StateI | StateII | StateIII) => { if (mounted) setLocal(value) }, onError: (value: string) => { if (mounted) setError(value) }, onNotice: setNotice,
      onSound: (kind: 'gem' | 'unlock' | 'hurt') => {
        const context = audio.current; if (!soundOn.current || !context || context.state !== 'running') return
        const frequencies = kind === 'unlock' ? [440,660,880] : kind === 'gem' ? [880,1174] : [180]
        frequencies.forEach((frequency,i) => {
          const oscillator = context.createOscillator(), gain = context.createGain(), time = context.currentTime + i*.08
          oscillator.frequency.value = frequency; gain.gain.setValueAtTime(.035,time); gain.gain.exponentialRampToValueAtTime(.001,time+.12)
          oscillator.connect(gain); gain.connect(context.destination); oscillator.start(time); oscillator.stop(time+.13)
        })
      },
    }
    let instance: ChestHunterScene | ForgottenGalleriesScene | RoyalTreasuryScene
    if (runtime.state.currentStage === 'lost-courtyard') {
      const run = runtime.attachStage(lostCourtyardAdapter)
      instance = new ChestHunterScene({ ...common, reduceAction: action => {
        if (action.type === 'RESET') throw new Error('Reset the entire expedition attempt')
        const value = run.dispatch(action); if (mounted) onSnapshot(runtime.state); return value
      } })
    } else if(runtime.state.currentStage==='forgotten-galleries') {
      const run = runtime.attachStage(forgottenGalleriesAdapter)
      instance = new ForgottenGalleriesScene({ ...common, reduceAction: action => {
        if (action.type === 'RESET') throw new Error('Reset the entire expedition attempt')
        const value = run.dispatch(action); if (mounted) onSnapshot(runtime.state); return value
      } })
    }
    else {
      const run=runtime.attachStage(royalTreasuryAdapter)
      instance=new RoyalTreasuryScene({...common,reduceAction:action=>{
        if(action.type==='RESET')throw new Error('Reset the entire expedition attempt')
        const value=run.dispatch(action);if(mounted)onSnapshot(runtime.state);return value
      }})
    }
    const game = new Phaser.Game({ type: Phaser.CANVAS, parent: host.current, ...instance.options.viewport, backgroundColor: '#132a26', render: { antialias: true }, scale: { mode: Phaser.Scale.NONE }, fps: { target: 60 }, scene: [instance] })
    return () => { mounted = false; scene.current = null; game.destroy(true); void audio.current?.close(); audio.current = null }
  }, [runtime,onSnapshot])
  useEffect(() => { scene.current?.setDebug(debug) }, [debug,ready])
  const complete=expedition.status==='COMPLETE', finished = expedition.status === 'TRANSITION', failed = expedition.status === 'FAILED'
  useEffect(() => { if (finished || failed || complete) heading.current?.focus() }, [finished,failed,complete])
  const definition = CHEST_HUNTER_STAGES[expedition.currentStageIndex], next = CHEST_HUNTER_STAGES[expedition.currentStageIndex+1]
  const result = expedition.stageResults.at(-1), areas = definition.id === 'lost-courtyard' ? areasI : definition.id==='forgotten-galleries' ? areasII : areasIII
  return <>
    <div className="stage-hud"><strong>CHESTS {local.stageChestsOpened} / {definition.required}</strong><span className="health" aria-label={'Health '+expedition.hp+' of 100'}><span style={{width:expedition.hp+'%'}} /></span><strong>HP {expedition.hp}</strong></div>
    <p className="chest-carry">Expedition chests: {expedition.expeditionChestsOpened} · Gems: {expedition.expeditionGems}<span>{expedition.carriedItems.sword ? 'Blade carried' : 'No blade'} · HP carries exactly</span></p>
    <p className="area-name">{areas.find(a=>inZone(local.player,a))?.name ?? 'Carved connector'}<span>{local.exitUnlocked ? 'Passage open' : 'Open '+definition.required+' of '+definition.available+' chests'+(definition.id==='royal-treasury'?' + Royal Cache':'')}</span></p>
    <p className="treasure-notice" role="status">{notice}</p>
    <div className="stage-viewport"><div ref={host} />
      {!ready && !error && <div className="stage-overlay" role="status">Loading {definition.name}…</div>}
      {(finished || failed || complete) && <div className="stage-overlay" role="region" aria-label={complete ? 'Chest Hunter complete' : finished ? 'Stage '+definition.numeral+' complete' : 'Expedition failed'}>
        <p className="eyebrow">{complete ? 'CHEST HUNTER COMPLETE' : finished ? 'STAGE '+definition.numeral+' COMPLETE' : 'EXPEDITION FAILED'}</p><h2 ref={heading} tabIndex={-1}>{complete ? 'ANGKOR RUINS' : definition.name.toUpperCase()}</h2>
        {complete ? <><p>{expedition.stageResults.map((r,i)=><span key={r.stageId}>Stage {CHEST_HUNTER_STAGES[i].numeral} chests: {r.stageChestsOpened}<br /></span>)}Total chests opened: {expedition.expeditionChestsOpened}<br />Treasure Gems secured: {expedition.expeditionGems}<br />HP remaining: {expedition.hp}</p><strong>ROYAL CACHE SECURED</strong><p className="small">EXPEDITION COMPLETE</p></> : finished && result ? <><p>Chests opened: {result.stageChestsOpened} / {definition.available}<br />Expedition chests: {result.expeditionChestsOpened}<br />HP remaining: {result.hpRemaining}</p><strong>NEXT: STAGE {next.numeral} — {next.name.toUpperCase()}</strong><button type="button" onClick={()=>onSnapshot(runtime.continue())}>Continue deeper</button></> : <p>HP remaining: 0<br />This attempt has ended. Reset starts a new expedition.</p>}
      </div>}
    </div>
    {error && <p role="alert">{error}</p>}
    <div className="stage-controls"><DirectionalDpad inputLocked={!ready || Boolean(error) || expedition.status !== 'PLAYING'} onMove={direction=>scene.current?.traversal?.tap(direction)} heldInput={{press:(source,direction)=>scene.current?.traversal?.press(source,direction),release:source=>scene.current?.traversal?.release(source),cancel:source=>scene.current?.traversal?.cancel(source)}} /></div>
    {debug && <section className="stage-debug" aria-label="Stage debug"><h3>Stage: HP, coords, chest states, key/gates, plates, boulders, darts, Royal Cache, wildlife and event log</h3><pre>{JSON.stringify(local,null,2)}</pre></section>}
  </>
}
export function ChestHunterExpeditionQA() {
  const [runtime,setRuntime] = useState(()=>new ChestHunterRuntime()), [expedition,setExpedition] = useState(runtime.state)
  const [started,setStarted] = useState(false), [debug,setDebug] = useState(false), [sound,setSound] = useState(true)
  const definition = CHEST_HUNTER_STAGES[expedition.currentStageIndex]
  const reset = () => { const next=new ChestHunterRuntime();setRuntime(next);setExpedition(next.state);setStarted(false) }
  const exportEnvelope = () => {
    const url=URL.createObjectURL(new Blob([JSON.stringify(runtime.envelope(),null,2)],{type:'application/json'})), link=document.createElement('a')
    link.href=url;link.download='angkor-v2-chest-hunter-local.json';link.click();URL.revokeObjectURL(url)
  }
  return <main className="stage-shell chest-hunter" data-expedition={JSON.stringify(expedition)}>
    <header><div><p className="eyebrow">CHEST HUNTER · STAGE {definition.numeral}</p><h1>{definition.name}</h1></div><label><input type="checkbox" checked={debug} onChange={e=>setDebug(e.target.checked)} /> Debug</label></header>
    {!started ? <section className="chest-contract"><h2>Find the lost treasure</h2><p>Explore sealed chambers. Find keys, shift stone and open treasure.</p><p className="small">Lost Courtyard → Forgotten Galleries → Royal Treasury.<br />Walk onto chests to open. Hold arrows / WASD or the D-pad.</p><button type="button" onClick={()=>setStarted(true)}>Start fresh expedition</button></section> : <PlayableStage key={expedition.currentStage} runtime={runtime} expedition={expedition} onSnapshot={setExpedition} debug={debug} sound={sound} />}
    <div className="stage-options"><label><input type="checkbox" checked={sound} onChange={e=>setSound(e.target.checked)} /> Sound</label><button type="button" onClick={reset}>Reset expedition</button></div>
    <p className="chest-footer">Isolated development playtest · No production proof or rewards</p>
    {debug && <section className="stage-debug" aria-label="Expedition debug"><button type="button" onClick={exportEnvelope}>Export expedition envelope</button><h3>Carry · completed results · ordered expedition events</h3><pre>{JSON.stringify({carry:expeditionCarry(expedition),...expedition},null,2)}</pre></section>}
  </main>
}
if (import.meta.env.DEV) {
  const root=createRoot(document.getElementById('root')!);root.render(<ChestHunterExpeditionQA />);import.meta.hot?.dispose(()=>root.unmount())
}
