import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import Phaser from 'phaser'
import { DirectionalDpad } from '../components/play/DirectionalDpad'
import { traversalViewport } from '../game/traversal/angkorV2/camera'
import { ChestHunterScene } from '../game/chestHunter/stage1/ChestHunterScene'
import { initialStageState } from '../game/chestHunter/stage1/model'
import { AREAS, inZone } from '../game/chestHunter/stage1/level'
import './angkorV2Stage1.css'
import './chestHunterStage1.css'

export function LostCourtyard() {
  const host = useRef<HTMLDivElement>(null), scene = useRef<ChestHunterScene | null>(null), audio = useRef<AudioContext | null>(null), soundOn = useRef(true)
  const [ready, setReady] = useState(false), [started, setStarted] = useState(false), [debug, setDebug] = useState(false), [sound, setSound] = useState(true), [error, setError] = useState('')
  const [continued, setContinued] = useState(false), [notice, setNotice] = useState('Walk onto treasure to open it.')
  const [state, setState] = useState(initialStageState)
  useEffect(() => {
    if (!host.current) return
    let mounted = true
    const instance = new ChestHunterScene({ viewport: traversalViewport(window.innerWidth, window.innerHeight),
      onReady: value => { scene.current = value; if (mounted) setReady(true) }, onState: value => { if (mounted) setState(value) }, onError: message => { if (mounted) setError(message) },
      onNotice: setNotice, onSound: kind => {
        const context = audio.current
        if (!soundOn.current || !context || context.state !== 'running') return
        const frequencies = kind === 'unlock' ? [440, 660, 880] : kind === 'gem' ? [880, 1174] : [180]
        frequencies.forEach((frequency, i) => {
          const oscillator = context.createOscillator(), gain = context.createGain(), time = context.currentTime + i * .08
          oscillator.frequency.value = frequency; gain.gain.setValueAtTime(.035, time); gain.gain.exponentialRampToValueAtTime(.001, time + .12)
          oscillator.connect(gain); gain.connect(context.destination); oscillator.start(time); oscillator.stop(time + .13)
        })
      },
    })
    const game = new Phaser.Game({ type: Phaser.CANVAS, parent: host.current, ...instance.options.viewport, backgroundColor: '#132a26', render: { antialias: true }, scale: { mode: Phaser.Scale.NONE }, fps: { target: 60 }, scene: [instance] })
    return () => { mounted = false; scene.current = null; game.destroy(true); void audio.current?.close(); audio.current = null }
  }, [])
  useEffect(() => { scene.current?.setDebug(debug) }, [debug])
  const start = () => {
    if (!ready || !scene.current || error) return
    audio.current ??= new AudioContext(); void audio.current.resume()
    scene.current?.start(); setStarted(true); setContinued(false)
  }
  const area = AREAS.find(a => inZone(state.player, a))?.name ?? 'Ruined connector'
  return <main className="stage-shell chest-hunter">
    <header><div><p className="eyebrow">CHEST HUNTER · STAGE I</p><h1>Lost Courtyard</h1></div><label><input type="checkbox" checked={debug} disabled={!ready} onChange={e => setDebug(e.target.checked)} /> Debug</label></header>
    <div className="stage-hud"><strong>CHESTS {state.stageChestsOpened} / 4</strong><span className="health" aria-label={'Health ' + state.hp + ' of 100'}><span style={{ width: state.hp + '%' }} /></span><strong>HP {state.hp}</strong></div>
    <p className="area-name">{area}<span>{state.exitUnlocked ? 'Passage open' : 'Open 4 of 6 chests'}</span></p>
    <p className="treasure-notice" role="status">{notice}</p>
    <div className="stage-viewport"><div ref={host} />
      {(!started || state.status !== 'playing') && <div className="stage-overlay" role="dialog" aria-modal="true" aria-label={state.status === 'complete' ? 'Stage complete' : 'Lost Courtyard'}>
        {state.status === 'complete' ? continued ? <><p className="eyebrow">STAGE II — FORGOTTEN GALLERIES</p><h2>READY_FOR_STAGE_2</h2><p>NOT BUILT YET</p><p className="small">Lost Courtyard result preserved. No Stage II gameplay is loaded.</p></> : <><p className="eyebrow">STAGE I COMPLETE</p><h2>LOST COURTYARD</h2><p>Chests opened: {state.result?.stageChestsOpened} / 6<br />HP remaining: {state.result?.hpRemaining}</p><strong>NEXT: STAGE II — FORGOTTEN GALLERIES</strong><button type="button" onClick={() => setContinued(true)}>Continue deeper</button></> : state.status === 'failed' ? <><h2>Lost in the courtyard</h2><p>Read rock targets and leave the spike lanes.</p></> : <><p className="eyebrow">STAGE I</p><h2>Find the lost treasure</h2><p>Open 4 of 6 chests. Find a bronze key, slide stone, unlock the Lower Vault.</p><p className="small">Walk onto chests to open them.<br />Hold arrows / WASD or the D-pad.</p></>}
        <button type="button" disabled={!ready || Boolean(error)} onClick={start}>{state.status === 'playing' ? 'Start exploration' : 'Play again'}</button>
      </div>}
    </div>
    {error && <p role="alert">{error}</p>}
    <div className="stage-controls"><DirectionalDpad inputLocked={!ready || !started || state.status !== 'playing'} onMove={direction => scene.current?.traversal?.tap(direction)}
      heldInput={{ press: (source, direction) => scene.current?.traversal?.press(source, direction), release: source => scene.current?.traversal?.release(source), cancel: source => scene.current?.traversal?.cancel(source) }} onReset={start} /></div>
    <div className="stage-options"><label><input type="checkbox" checked={sound} onChange={e => { soundOn.current = e.target.checked; setSound(e.target.checked) }} /> Sound</label><span>Development playtest</span></div>
    {debug && <section className="stage-debug"><p>Tile {state.player.x}, {state.player.y} · tick {state.tick} · HP {state.hp}<br />Chests {state.stageChestsOpened} / 6 · Expedition chests {state.expeditionChestsOpened}<br />Key {state.keyHeld ? 'held' : state.keyCollected ? 'used' : 'not found'} · Gate {state.gateUnlocked ? 'open' : 'locked'}<br />Snake {state.snakes[0].mode}/{state.snakes[0].index} · Monkey {state.monkey.mode}<br />Boulders {state.boulders.map(b => b.id + ': ' + b.x + ',' + b.y).join(' · ')}</p><button type="button" onClick={() => scene.current?.exportReplay()}>Export local replay</button><pre>{JSON.stringify({ chests: state.chests, carry: state.carriedItems, events: state.events.slice(-12) }, null, 2)}</pre></section>}
  </main>
}
if (import.meta.env.DEV) {
  const root = createRoot(document.getElementById('root')!)
  root.render(<LostCourtyard />)
  import.meta.hot?.dispose(() => root.unmount())
}
