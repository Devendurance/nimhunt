import { useEffect,useRef,useState } from 'react'
import Phaser from 'phaser'
import { DirectionalDpad } from '../components/play/DirectionalDpad'
import { traversalViewport } from '../game/traversal/angkorV2/camera'
import { AncientMechanismScene } from '../game/vaultBreaker/stage2/AncientMechanismScene'
import { initialStageState,type StageState } from '../game/vaultBreaker/stage2/model'
import { AREAS,inZone } from '../game/vaultBreaker/stage2/level'
import { expeditionCarry,type VaultBreakerState } from '../game/vaultBreaker/model'
import { VaultBreakerRuntime } from '../game/vaultBreaker/runtime'
import { ancientMechanismAdapter } from '../game/vaultBreaker/adapters'
interface PlayProps { runtime:VaultBreakerRuntime;expedition:VaultBreakerState;onSnapshot:(state:VaultBreakerState)=>void;debug:boolean;sound:boolean }
export function AncientMechanism({runtime,expedition,onSnapshot,debug,sound}:PlayProps){
  const host=useRef<HTMLDivElement>(null),scene=useRef<AncientMechanismScene|null>(null),audio=useRef<AudioContext|null>(null),soundOn=useRef(sound),heading=useRef<HTMLHeadingElement>(null)
  const [local,setLocal]=useState<StageState>(()=>initialStageState(expeditionCarry(runtime.state)))
  const [ready,setReady]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('Weight the counterweight, then step onto the Rotary Seal. B + weight opens the Relay.')
  useEffect(()=>{soundOn.current=sound},[sound])
  useEffect(()=>{
    if(!host.current)return
    let mounted=true
    audio.current=new AudioContext();void audio.current.resume()
    const run=runtime.attachStage(ancientMechanismAdapter)
    const instance=new AncientMechanismScene({carry:expeditionCarry(runtime.state),viewport:traversalViewport(window.innerWidth,window.innerHeight),
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
  const objective=!local.objectives.counterweightSolved?'Configure counterweight':!local.mechanismCoreActivated&&!local.counterweightActive?'Hold counterweight for Relay':!local.mechanismCoreActivated&&local.rotaryState!=='B'?'Align Rotary Seal B':!local.objectives.relayReached?'Enter Relay Chamber':!local.mechanismCoreActivated?'Awaken Mechanism Core':!local.innerLockOpen?'Set Seal C + held counterweight':'Reach Inner Lock'
  return <>
    <div className="stage-hud"><strong>SOLVE THE TEMPLE</strong><span className="health" aria-label={'Health '+expedition.hp+' of 100'}><span style={{width:expedition.hp+'%'}} /></span><strong>HP {expedition.hp}</strong></div>
    <p className="vault-objective">{objective}<span>Optional Gems: {local.collected.length} · {expedition.carriedItems.sword?'Blade carried':'No blade'}</span></p>
    <p className="area-name">{AREAS.find(a=>inZone(local.player,a))?.name??'Mechanism connector'}<span>{'Seal '+local.rotaryState+' · '+(local.counterweightActive?'Counterweight held':'Counterweight released')}</span></p>
    <p className="vault-notice" role="status">{notice}</p>
    <div className="stage-viewport"><div ref={host} />
      {!ready&&!error&&<div className="stage-overlay" role="status">Loading Ancient Mechanism…</div>}
      {(finished||failed)&&<div className="stage-overlay" role="region" aria-label={finished?'Stage II complete':'Expedition failed'}>
        <p className="eyebrow">{finished?'STAGE II COMPLETE':'EXPEDITION FAILED'}</p><h2 ref={heading} tabIndex={-1}>ANCIENT MECHANISM</h2>
        {finished&&result?<><p>Mechanism Core awakened<br />Inner Lock opened<br />HP remaining: {result.hpRemaining}<br />Optional Gems: {result.optionalGemCount}</p><strong>NEXT: STAGE III — INNER VAULT</strong><button type="button" onClick={()=>onSnapshot(runtime.continue())}>Continue deeper</button></>:<p>HP remaining: 0<br />This attempt has ended. Reset starts a new expedition.</p>}
      </div>}
    </div>
    {error&&<p role="alert">{error}</p>}
    <div className="stage-controls"><DirectionalDpad inputLocked={!ready||Boolean(error)||expedition.status!=='PLAYING'} onMove={direction=>scene.current?.traversal?.tap(direction)} heldInput={{press:(source,direction)=>scene.current?.traversal?.press(source,direction),release:source=>scene.current?.traversal?.release(source),cancel:source=>scene.current?.traversal?.cancel(source)}} /></div>
    {debug&&<section className="stage-debug" aria-label="Stage debug"><h3>Coords · HP · counterweight · seal/gates · Core · guardians · wildlife · events</h3><pre>{JSON.stringify(local,null,2)}</pre></section>}
  </>
}
