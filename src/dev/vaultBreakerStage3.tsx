import { useEffect,useRef,useState } from 'react'
import Phaser from 'phaser'
import { DirectionalDpad } from '../components/play/DirectionalDpad'
import { traversalViewport } from '../game/traversal/angkorV2/camera'
import { InnerVaultScene } from '../game/vaultBreaker/stage3/InnerVaultScene'
import { initialStageState,type StageState } from '../game/vaultBreaker/stage3/model'
import { AREAS,inZone } from '../game/vaultBreaker/stage3/level'
import { expeditionCarry,type VaultBreakerState } from '../game/vaultBreaker/model'
import { VaultBreakerRuntime } from '../game/vaultBreaker/runtime'
import { innerVaultAdapter } from '../game/vaultBreaker/adapters'
interface PlayProps { runtime:VaultBreakerRuntime;expedition:VaultBreakerState;onSnapshot:(state:VaultBreakerState)=>void;debug:boolean;sound:boolean }
export function InnerVault({runtime,expedition,onSnapshot,debug,sound}:PlayProps){
  const host=useRef<HTMLDivElement>(null),scene=useRef<InnerVaultScene|null>(null),audio=useRef<AudioContext|null>(null),soundOn=useRef(sound),heading=useRef<HTMLHeadingElement>(null)
  const [local,setLocal]=useState<StageState>(()=>initialStageState(expeditionCarry(runtime.state)))
  const [ready,setReady]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('Bait the guardian beside each carved anchor. Leave the amber smash footprint before impact.')
  useEffect(()=>{soundOn.current=sound},[sound])
  useEffect(()=>{
    if(!host.current)return
    let mounted=true
    audio.current=new AudioContext();void audio.current.resume()
    const run=runtime.attachStage(innerVaultAdapter)
    const instance=new InnerVaultScene({carry:expeditionCarry(runtime.state),viewport:traversalViewport(window.innerWidth,window.innerHeight),
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
  const finished=expedition.status==='COMPLETE',failed=expedition.status==='FAILED',result=expedition.stageResults.at(-1)
  useEffect(()=>{if(finished||failed)heading.current?.focus()},[finished,failed])
  const objective=!local.objectives.golemAwakened?'Enter the guardian chamber':!local.objectives.anchorsBroken?'Bait smashes beside three Vault Anchors':!local.golem.finalVaultBroken?'Bait a final smash beside the vault door':'Reach the Inner Shrine'
  return <>
    <div className="stage-hud"><strong>BREAK THE VAULT</strong><span className="health" aria-label={'Health '+expedition.hp+' of 100'}><span style={{width:expedition.hp+'%'}} /></span><strong>HP {expedition.hp}</strong></div>
    <p className="vault-objective">{objective}<span>Optional Gems: {local.collected.length} · {expedition.carriedItems.sword?'Blade carried':'No blade'}</span></p>
    <p className="area-name">{AREAS.find(a=>inZone(local.player,a))?.name??'Vault connector'}<span>{'Anchors '+local.golem.brokenAnchors.length+' / 3 · '+(local.golem.finalVaultBroken?'Vault open':'Vault sealed')}</span></p>
    <p className="vault-notice" role="status">{notice}</p>
    <div className="stage-viewport"><div ref={host} />
      {!ready&&!error&&<div className="stage-overlay" role="status">Loading Inner Vault…</div>}
      {(finished||failed)&&<div className="stage-overlay" role="region" aria-label={finished?'Vault Breaker complete':'Expedition failed'}>
        <p className="eyebrow">{finished?'VAULT BREAKER COMPLETE':'EXPEDITION FAILED'}</p><h2 ref={heading} tabIndex={-1}>ANGKOR RUINS</h2>
        {finished&&result?<><p>Outer Seal breached<br />Ancient Mechanism solved<br />Inner Vault broken<br />HP remaining: {result.hpRemaining}<br />Optional Gems secured: {expedition.stageResults.reduce((total,r)=>total+r.optionalGemCount,0)}</p><strong>THE VAULT IS OPEN</strong><p>EXPEDITION COMPLETE</p></>:<p>HP remaining: 0<br />This attempt has ended. Reset starts a new expedition.</p>}
      </div>}
    </div>
    {error&&<p role="alert">{error}</p>}
    <div className="stage-controls"><DirectionalDpad inputLocked={!ready||Boolean(error)||expedition.status!=='PLAYING'} onMove={direction=>scene.current?.traversal?.tap(direction)} heldInput={{press:(source,direction)=>scene.current?.traversal?.press(source,direction),release:source=>scene.current?.traversal?.release(source),cancel:source=>scene.current?.traversal?.cancel(source)}} /></div>
    {debug&&<section className="stage-debug" aria-label="Stage debug"><h3>Coords · HP · Golem state/phase · anchors · frozen target · vault door · guardians · events</h3><pre>{JSON.stringify(local,null,2)}</pre></section>}
  </>
}
