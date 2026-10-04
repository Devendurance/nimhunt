import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import Phaser from 'phaser'
import { DirectionalDpad } from '../components/play/DirectionalDpad'
import { traversalViewport } from '../game/traversal/angkorV2/camera'
import { TempleApproachScene } from '../game/vaultBreaker/stage1/TempleApproachScene'
import { initialStageState, type StageState } from '../game/vaultBreaker/stage1/model'
import { AREAS, inZone } from '../game/vaultBreaker/stage1/level'
import { VAULT_BREAKER_STAGES } from '../game/vaultBreaker/contracts'
import { expeditionCarry, type VaultBreakerState } from '../game/vaultBreaker/model'
import { VaultBreakerRuntime } from '../game/vaultBreaker/runtime'
import { templeApproachAdapter } from '../game/vaultBreaker/adapters'
import './angkorV2Stage1.css'
import './vaultBreakerStage1.css'

interface PlayProps { runtime:VaultBreakerRuntime;expedition:VaultBreakerState;onSnapshot:(state:VaultBreakerState)=>void;debug:boolean;sound:boolean }
function TempleApproach({runtime,expedition,onSnapshot,debug,sound}:PlayProps){
  const host=useRef<HTMLDivElement>(null),scene=useRef<TempleApproachScene|null>(null),audio=useRef<AudioContext|null>(null),soundOn=useRef(sound),heading=useRef<HTMLHeadingElement>(null)
  const [local,setLocal]=useState<StageState>(()=>initialStageState(expeditionCarry(runtime.state)))
  const [ready,setReady]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('Find the Bronze Vault Key. Shift stones along their carved rails.')
  useEffect(()=>{soundOn.current=sound},[sound])
  useEffect(()=>{
    if(!host.current)return
    let mounted=true
    audio.current=new AudioContext();void audio.current.resume()
    const run=runtime.attachStage(templeApproachAdapter)
    const instance=new TempleApproachScene({carry:expeditionCarry(runtime.state),viewport:traversalViewport(window.innerWidth,window.innerHeight),
      reduceAction:action=>{const value=run.dispatch(action);if(mounted)onSnapshot(runtime.state);return value},
      onReady:value=>{scene.current=value;value.start();if(mounted)setReady(true)},onState:value=>{if(mounted)setLocal(value)},
      onError:value=>{if(mounted)setError(value)},onNotice:value=>{if(mounted)setNotice(value)},
      onSound:kind=>{
        const context=audio.current;if(!soundOn.current||!context||context.state!=='running')return
        const frequencies=kind==='unlock'?[330,440,660]:kind==='gem'?[880,1174]:[180]
        frequencies.forEach((frequency,i)=>{
          const oscillator=context.createOscillator(),gain=context.createGain(),time=context.currentTime+i*.08
          oscillator.frequency.value=frequency;gain.gain.setValueAtTime(.035,time);gain.gain.exponentialRampToValueAtTime(.001,time+.12)
          oscillator.connect(gain);gain.connect(context.destination);oscillator.start(time);oscillator.stop(time+.13)
        })
      },
    })
    const game=new Phaser.Game({type:Phaser.CANVAS,parent:host.current,...instance.options.viewport,backgroundColor:'#132a26',render:{antialias:true},scale:{mode:Phaser.Scale.NONE},fps:{target:60},scene:[instance]})
    return ()=>{mounted=false;scene.current=null;game.destroy(true);void audio.current?.close();audio.current=null}
  },[runtime,onSnapshot])
  useEffect(()=>{scene.current?.setDebug(debug)},[debug,ready])
  const finished=expedition.status==='TRANSITION',failed=expedition.status==='FAILED',result=expedition.stageResults.at(-1)
  useEffect(()=>{if(finished||failed)heading.current?.focus()},[finished,failed])
  const objective=!local.bronzeKeyCollected?'Find Bronze Vault Key':!local.outerSealUnlocked?'Breach Outer Seal':!local.mechanismActivated?'Weight the mechanism plate':'Reach inner passage'
  return <>
    <div className="stage-hud"><strong>BREACH THE TEMPLE</strong><span className="health" aria-label={'Health '+expedition.hp+' of 100'}><span style={{width:expedition.hp+'%'}} /></span><strong>HP {expedition.hp}</strong></div>
    <p className="vault-objective">{objective}<span>Optional Gems: {local.collected.length} · {expedition.carriedItems.sword?'Blade carried':'No blade'}</span></p>
    <p className="area-name">{AREAS.find(a=>inZone(local.player,a))?.name??'Fortified connector'}<span>{local.mechanismGateOpen?'Mechanism gate open':local.outerSealUnlocked?'Inside the seal':'Outer Seal locked'}</span></p>
    <p className="vault-notice" role="status">{notice}</p>
    <div className="stage-viewport"><div ref={host} />
      {!ready&&!error&&<div className="stage-overlay" role="status">Loading Temple Approach…</div>}
      {(finished||failed)&&<div className="stage-overlay" role="region" aria-label={finished?'Stage I complete':'Expedition failed'}>
        <p className="eyebrow">{finished?'STAGE I COMPLETE':'EXPEDITION FAILED'}</p><h2 ref={heading} tabIndex={-1}>TEMPLE APPROACH</h2>
        {finished&&result?<><p>Outer Seal breached<br />Mechanism activated<br />HP remaining: {result.hpRemaining}<br />Optional Gems: {result.optionalGemCount}</p><strong>NEXT: STAGE II — ANCIENT MECHANISM</strong><button type="button" onClick={()=>onSnapshot(runtime.continue())}>Continue deeper</button></>:<p>HP remaining: 0<br />This attempt has ended. Reset starts a new expedition.</p>}
      </div>}
    </div>
    {error&&<p role="alert">{error}</p>}
    <div className="stage-controls"><DirectionalDpad inputLocked={!ready||Boolean(error)||expedition.status!=='PLAYING'} onMove={direction=>scene.current?.traversal?.tap(direction)} heldInput={{press:(source,direction)=>scene.current?.traversal?.press(source,direction),release:source=>scene.current?.traversal?.release(source),cancel:source=>scene.current?.traversal?.cancel(source)}} /></div>
    {debug&&<section className="stage-debug" aria-label="Stage debug"><h3>Coords · HP · key/seal · stones · plate/gate · rubble · wildlife · events</h3><pre>{JSON.stringify(local,null,2)}</pre></section>}
  </>
}
export function VaultBreakerExpeditionQA(){
  const [runtime,setRuntime]=useState(()=>new VaultBreakerRuntime()),[expedition,setExpedition]=useState(runtime.state)
  const [started,setStarted]=useState(false),[debug,setDebug]=useState(false),[sound,setSound]=useState(true)
  const definition=VAULT_BREAKER_STAGES[expedition.currentStageIndex]
  const reset=()=>{const next=new VaultBreakerRuntime();setRuntime(next);setExpedition(next.state);setStarted(false)}
  const exportEnvelope=()=>{
    const url=URL.createObjectURL(new Blob([JSON.stringify(runtime.envelope(),null,2)],{type:'application/json'})),link=document.createElement('a')
    link.href=url;link.download='angkor-v2-vault-breaker-local.json';link.click();URL.revokeObjectURL(url)
  }
  return <main className="stage-shell vault-breaker" data-expedition={JSON.stringify(expedition)}>
    <header><div><p className="eyebrow">VAULT BREAKER · STAGE {definition.numeral}</p><h1>{definition.name}</h1></div><label><input type="checkbox" checked={debug} onChange={e=>setDebug(e.target.checked)} /> Debug</label></header>
    {!started?<section className="vault-contract"><h2>Break into the temple</h2><p>Find the Bronze Vault Key, breach the Outer Seal and hold the mechanism gate open.</p><p className="small">Temple Approach → Ancient Mechanism → Inner Vault.<br />Only Temple Approach is built. Hold arrows / WASD or the D-pad.</p><button type="button" onClick={()=>setStarted(true)}>Start fresh expedition</button></section>:definition.implemented?<TempleApproach runtime={runtime} expedition={expedition} onSnapshot={setExpedition} debug={debug} sound={sound}/>:<section className="vault-contract" aria-label="Stage II contract"><p className="eyebrow">STAGE II — ANCIENT MECHANISM</p><h2>READY_FOR_STAGE_2</h2><p>NOT BUILT YET</p><p>HP carried: {expedition.hp}<br />Outer Seal breached · Temple Approach result preserved</p><p className="small">Stage-local keys, gates, stones and mechanisms stay behind.</p></section>}
    <div className="stage-options"><label><input type="checkbox" checked={sound} onChange={e=>setSound(e.target.checked)} /> Sound</label><button type="button" onClick={reset}>Reset expedition</button></div>
    <p className="vault-footer">Isolated development playtest · No production proof or rewards</p>
    {debug&&<section className="stage-debug" aria-label="Expedition debug"><button type="button" onClick={exportEnvelope}>Export expedition envelope</button><h3>Carry · objective results · ordered expedition events</h3><pre>{JSON.stringify({carry:expeditionCarry(expedition),...expedition},null,2)}</pre></section>}
  </main>
}
if(import.meta.env.DEV){const root=createRoot(document.getElementById('root')!);root.render(<VaultBreakerExpeditionQA/>);import.meta.hot?.dispose(()=>root.unmount())}
