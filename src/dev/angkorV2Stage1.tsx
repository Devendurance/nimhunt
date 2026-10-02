import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import Phaser from 'phaser'
import { DirectionalDpad } from '../components/play/DirectionalDpad'
import { traversalViewport } from '../game/traversal/angkorV2/camera'
import { StageScene } from '../game/stage1/StageScene'
import { initialStageState } from '../game/stage1/model'
import { STAGE_AREAS, inZone } from '../game/stage1/level'
import './angkorV2Stage1.css'

export function OuterRuins() {
  const host = useRef<HTMLDivElement>(null), scene = useRef<StageScene | null>(null), audio = useRef<AudioContext | null>(null), soundOn = useRef(true)
  const [ready, setReady] = useState(false), [started, setStarted] = useState(false), [debug, setDebug] = useState(false), [sound, setSound] = useState(true), [error, setError] = useState('')
  const [state, setState] = useState(initialStageState)
  useEffect(() => {
    if (!host.current) return
    let mounted = true
    const instance = new StageScene({ viewport: traversalViewport(window.innerWidth, window.innerHeight),
      onReady: value => { scene.current = value; if (mounted) setReady(true) }, onState: value => { if (mounted) setState(value) }, onError: message => { if (mounted) setError(message) },
      onSound: kind => {
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
    scene.current?.start(); setStarted(true)
  }
  const area = STAGE_AREAS.find(a => inZone(state.player, a))?.name ?? 'Ruined connector'
  return <main className="stage-shell">
    <header><div><p className="eyebrow">GEM RUNNER · STAGE I</p><h1>Outer Ruins</h1></div><label><input type="checkbox" checked={debug} disabled={!ready} onChange={e => setDebug(e.target.checked)} /> Debug</label></header>
    <div className="stage-hud"><strong>GEMS {state.stageGems} / 6</strong><span className="health" aria-label={'Health ' + state.hp + ' of 100'}><span style={{ width: state.hp + '%' }} /></span><strong>HP {state.hp}</strong></div>
    <p className="area-name">{area}<span>{state.exitUnlocked ? 'Passage open' : 'Find 6 Gems to open the passage'}</span></p>
    <div className="stage-viewport"><div ref={host} />
      {(!started || state.status !== 'playing') && <div className="stage-overlay" role="dialog" aria-modal="true" aria-label={state.status === 'complete' ? 'Stage complete' : 'Outer Ruins'}>
        {state.status === 'complete' ? <><p className="eyebrow">STAGE I COMPLETE</p><h2>OUTER RUINS</h2><p>Gems secured: {state.result?.gems}<br />HP remaining: {state.result?.hp}</p><strong>DESCEND INTO THE TEMPLE</strong><p className="small">Stage II awaits a future slice.</p></> : state.status === 'failed' ? <><h2>Lost in the ruins</h2><p>Watch the snakes and move off rock targets.</p></> : <><p className="eyebrow">STAGE I</p><h2>Enter the Outer Ruins</h2><p>Secure 6 of 8 Gems. Dodge wildlife, push stone, unlock the temple.</p><p className="small">Hold arrows / WASD or the D-pad.</p></>}
        <button type="button" disabled={!ready || Boolean(error)} onClick={start}>{state.status === 'playing' ? 'Start exploration' : 'Play again'}</button>
      </div>}
    </div>
    {error && <p role="alert">{error}</p>}
    <div className="stage-controls"><DirectionalDpad inputLocked={!ready || !started || state.status !== 'playing'} onMove={direction => scene.current?.traversal?.tap(direction)}
      heldInput={{ press: (source, direction) => scene.current?.traversal?.press(source, direction), release: source => scene.current?.traversal?.release(source), cancel: source => scene.current?.traversal?.cancel(source) }} onReset={start} /></div>
    <div className="stage-options"><label><input type="checkbox" checked={sound} onChange={e => { soundOn.current = e.target.checked; setSound(e.target.checked) }} /> Sound</label><span>Development playtest</span></div>
    {debug && <section className="stage-debug"><p>Tile {state.player.x}, {state.player.y} · tick {state.tick} · HP {state.hp}<br />Stage Gems {state.stageGems} · Expedition Gems {state.expeditionGems}<br />Snakes {state.snakes.map(s => s.id + ': ' + s.mode + '/' + s.index).join(' · ')}<br />Monkey {state.monkey.mode} · perch {state.monkey.perch + 1}</p><button type="button" onClick={() => scene.current?.exportReplay()}>Export local replay</button><pre>{JSON.stringify(state.events.slice(-12), null, 2)}</pre></section>}
  </main>
}
if (import.meta.env.DEV) {
  const root = createRoot(document.getElementById('root')!)
  root.render(<OuterRuins />)
  import.meta.hot?.dispose(() => root.unmount())
}
