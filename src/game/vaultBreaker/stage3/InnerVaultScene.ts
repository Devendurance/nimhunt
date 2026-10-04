import { restorePresentation } from '../../angkorV2Proof/restorePresentation'
import Phaser from 'phaser'
import { AngkorV2Environment,angkorV2TextureKey,preloadAngkorV2Environment } from '../../rendering/angkorV2/environment'
import { environmentDepth } from '../../rendering/angkorV2/geometry'
import { TileTraversal,ANGKOR_V2_MOVE_MS } from '../../traversal/angkorV2/movement'
import { TraversalPlayer } from '../../traversal/angkorV2/player'
import { bindTraversalKeyboard } from '../../traversal/angkorV2/input'
import { cameraTarget,followCamera } from '../../traversal/angkorV2/camera'
import { tileToPixel,type GridCoord } from '../../world/grid'
import { ANGKOR_V2_BY_KEY,type AngkorV2AssetKey } from '../../assets/angkorV2Manifest'
import type { StageCarry } from '../contracts'
import { stageMap,DECOR,GOLEM_FOOT,GOLEM_ROOT,ANCHORS,SEAL_PASSAGE,VAULT_DOOR,SHRINE,GEMS,POTION,DART_GUARDIANS,DART_TIMING,GOLEM_TIMING } from './level'
import { initialStageState,planStageMove,isBlocked,SIMULATION_TICK_MS,type StageState,type StageAction,type StageEvent } from './model'
import { golemPose } from './presentation'
interface Options{
  initialState?: StageState
  canAct?: () => boolean
 carry:StageCarry;viewport:{width:number;height:number};reduceAction:(a:StageAction)=>StageState
 onReady:(scene:InnerVaultScene)=>void;onState:(s:StageState)=>void;onError:(message:string)=>void
 onNotice:(message:string)=>void;onSound:(kind:'gem'|'unlock'|'hurt')=>void
}
export const GOLEM_POSES:readonly AngkorV2AssetKey[]=['golem-dormant-v2','golem-awaken-v2','golem-idle-v2','golem-windup-v2','golem-smash-v2','golem-recoil-v2','golem-stunned-v2']
const additional:AngkorV2AssetKey[]=[...GOLEM_POSES,'vault-anchor-intact-v2','vault-anchor-broken-v2','inner-vault-door-sealed-v2','inner-vault-door-broken-v2','mechanism-core-v2','blue-gem-v2','potion-v2','side-gate-locked-v2','side-gate-open-v2','dust-small-v2','rock-impact-v2','gem-sparkle-v2']
/** All boss animation derives from reducer ticks. No tween callback changes
 * targets, collision, damage, anchors, doors or completion authority. */
export class InnerVaultScene extends Phaser.Scene{
 readonly options:Options;state:StageState;traversal?:TileTraversal
 private environment?:AngkorV2Environment;private explorer?:TraversalPlayer;private unbind?:()=>void
 private scroll={x:0,y:0};private accumulator=0;private running=false;private debug=false;private reportMs=0
 private reduced=window.matchMedia('(prefers-reduced-motion: reduce)');private failures:string[]=[]
 private gems=new Map<string,Phaser.GameObjects.Image>();private anchors:Phaser.GameObjects.Image[]=[];private gates:Phaser.GameObjects.Image[]=[]
 private boss?:Phaser.GameObjects.Image;private door?:Phaser.GameObjects.Image;private potion?:Phaser.GameObjects.Image
 private warnings?:Phaser.GameObjects.Graphics;private darts?:Phaser.GameObjects.Graphics;private collision?:Phaser.GameObjects.Graphics;private glow?:Phaser.GameObjects.Graphics
 constructor(options:Options){super('InnerVault');this.options=options;this.state=options.initialState ?? initialStageState(options.carry)}
 preload(){this.load.on('loaderror',(file:Phaser.Loader.File)=>this.failures.push(file.key));preloadAngkorV2Environment(this,[...additional,...DECOR.map(p=>p.key)])}
 create(){
  if(this.failures.length){this.options.onError('Inner Vault assets could not load. Reload to retry.');return}
  const env=this.environment=new AngkorV2Environment(this,stageMap.visual)
  for(const p of [...stageMap.structures,...DECOR])env.addSprite(p)
  const sprite=(key:AngkorV2AssetKey,p:GridCoord)=>env.addSprite({key,...tileToPixel(p),depthClass:'ground-item',occludesPlayer:false})
  for(const gem of GEMS)this.gems.set(gem.id,sprite('blue-gem-v2',gem))
  this.potion=sprite('potion-v2',POTION)
  sprite('mechanism-core-v2',SHRINE)
  const ring=this.add.graphics().setDepth(environmentDepth('floor-overlay',0))
  // Carved impact sockets beside each seal communicate baiting without labels.
  for(const a of ANCHORS){
   const p=tileToPixel(a.bait);ring.lineStyle(2,0xcab26f,.65).strokeCircle(p.x,p.y,10).lineStyle(1,0x91bbb0,.45).lineBetween(p.x,p.y,tileToPixel(a).x,tileToPixel(a).y)
   this.anchors.push(env.addSprite({key:'vault-anchor-intact-v2',x:a.x*32+16,y:a.y*32+30,depthY:a.y*32+24,shadow:true}))
  }
  this.gates=SEAL_PASSAGE.map(p=>env.addSprite({key:'side-gate-locked-v2',x:p.x*32+16,y:p.y*32+32,depthY:p.y*32+24,occludesPlayer:false}))
  this.door=env.addSprite({key:'inner-vault-door-sealed-v2',x:VAULT_DOOR.x*32+16,y:VAULT_DOOR.y*32+32,depthY:VAULT_DOOR.y*32+24,shadow:true})
  this.boss=env.addSprite({key:'golem-dormant-v2',...GOLEM_FOOT,depthY:GOLEM_FOOT.y-8,shadow:true,occludesPlayer:true})
  this.traversal=new TileTraversal({...stageMap.collision, playerStart: this.state.player},()=>{},ANGKOR_V2_MOVE_MS,{
   canEnter:(_from,direction)=>this.running&&(this.options.canAct?.()??true)&&Boolean(planStageMove(this.state,direction)),onArrive:move=>this.dispatch({type:'MOVE',direction:move.direction}),
  })
  this.explorer=new TraversalPlayer(this,env,this.traversal);this.unbind=bindTraversalKeyboard(this.traversal)
  this.scroll=cameraTarget(this.traversal.foot,stageMap.world,this.options.viewport)
  this.cameras.main.setBounds(0,0,stageMap.world.width,stageMap.world.height).setScroll(this.scroll.x,this.scroll.y)
  this.warnings=this.add.graphics().setDepth(environmentDepth('floor-overlay',0)+1)
  this.darts=this.add.graphics().setDepth(environmentDepth('effect',0));this.glow=this.add.graphics().setDepth(environmentDepth('effect',0))
  this.collision=this.add.graphics().setDepth(100000).setVisible(false)
  const canvas=this.game.canvas;canvas.id='vault-breaker-stage3-room';canvas.tabIndex=0
  canvas.setAttribute('aria-label','Inner Vault. Bait the guardian onto the carved sockets beside three anchors, leave the amber smash area, then bait the final vault door.')
  canvas.dataset.collision=JSON.stringify(stageMap.collision.layout);canvas.dataset.world='1024,832';canvas.dataset.state=JSON.stringify(this.state);canvas.dataset.ready='true'
  this.events.once('shutdown',()=>{this.unbind?.();this.explorer?.destroy();env.destroy()})
  if (this.options.initialState) restorePresentation(this.state, {gems: this.gems, potion: this.potion}); this.options.onReady(this);this.options.onState(this.state)
 }
 start(){this.running=true;this.game.canvas.focus()}
 setDebug(visible:boolean){this.debug=visible;this.collision?.setVisible(visible);this.options.onState(this.state)}
 private dispatch(a:StageAction){
  const before=this.state;this.state=this.options.reduceAction(a)
  for(const e of this.state.events.slice(before.events.length))this.present(e)
  this.game.canvas.dataset.state=JSON.stringify(this.state)
  if(this.state.status!=='playing'){this.running=false;this.traversal?.clearInput();this.options.onState(this.state)}
  else if(this.state.events.length!==before.events.length)this.options.onState(this.state)
 }
 private effect(key:AngkorV2AssetKey,p:GridCoord,large=false){
  const foot=tileToPixel(p),image=this.add.image(foot.x,foot.y-8,angkorV2TextureKey(key)).setDisplaySize(large?64:28,large?48:22)
   // Smash debris sits in front of the impacted 3×3 masonry footprint, rather
   // than disappearing beneath its south wall faces. This is transient only.
   .setDepth(environmentDepth('effect',large?(p.y+2)*32+24:foot.y))
  this.tweens.add({targets:image,alpha:0,duration:this.reduced.matches?100:large?650:360,onComplete:()=>image.destroy()})
 }
 private present(e:StageEvent){
  if(e.type==='GEM_COLLECTED'){this.gems.get(e.id)?.setVisible(false);this.effect('gem-sparkle-v2',this.state.player);this.options.onSound('gem')}
  if(e.type==='POTION_COLLECTED'){this.potion?.setVisible(false);this.options.onSound('gem');this.options.onNotice('Potion used · +'+e.healed+' HP')}
  if(e.type==='GOLEM_AWAKENED'){this.effect('dust-small-v2',{x:20,y:14},true);this.options.onNotice('The guardian wakes · stand beside a seal, then escape its smash')}
  if(e.type==='GOLEM_WINDUP')this.options.onNotice('Smash incoming · leave the amber footprint')
  if(e.type==='FINAL_VAULT_TELEGRAPH')this.options.onNotice('Vault door targeted · get clear!')
  if(e.type==='GOLEM_SMASH'||e.type==='GOLEM_FINAL_SMASH'){
   // A rooted guardian sends its stone shock through the carved foundation.
   // Fixed visual crack vertices connect its fists to the snapshotted impact.
   const p=tileToPixel(e.target),crack=this.add.graphics().setDepth(environmentDepth('floor-overlay',0)+2)
   crack.lineStyle(3,0x312b20,.8).beginPath().moveTo(GOLEM_FOOT.x,GOLEM_FOOT.y)
   for(let i=1;i<=8;i++){const t=i/8;crack.lineTo(GOLEM_FOOT.x+(p.x-GOLEM_FOOT.x)*t+(i%2?3:-3),GOLEM_FOOT.y+(p.y-GOLEM_FOOT.y)*t)}
   crack.strokePath();this.tweens.add({targets:crack,alpha:0,duration:this.reduced.matches?100:650,onComplete:()=>crack.destroy()})
   this.effect('rock-impact-v2',e.target,true);for(const p of e.cells.filter((_,i)=>i%2===0))this.effect('dust-small-v2',p)
   if(!this.reduced.matches)this.cameras.main.shake(e.type==='GOLEM_FINAL_SMASH'?330:220,.006)
   this.options.onSound('hurt')
  }
  if(e.type==='VAULT_ANCHOR_BROKEN'){const anchor=ANCHORS.find(a=>a.id===e.id)!;this.effect('rock-impact-v2',anchor,true);this.options.onNotice('Vault anchor broken · '+this.state.golem.brokenAnchors.length+' / 3');this.options.onSound('unlock')}
  if(e.type==='BROKEN_SEAL_PASSAGE_OPENED')this.options.onNotice('Three anchors shattered · bait the guardian beside the final vault door')
  if(e.type==='VAULT_DOOR_BROKEN'){this.effect('rock-impact-v2',VAULT_DOOR,true);this.options.onNotice('THE VAULT IS OPEN · reach the shrine');this.options.onSound('unlock')}
  if(e.type==='DART_GUARDIAN_TELEGRAPH')this.options.onNotice('Guardian eyes awake · leave the amber lane')
  if(e.type==='DART_GUARDIAN_IMPACT')for(const p of e.lane)this.effect('dust-small-v2',p)
  if(e.type==='DAMAGE'){this.options.onSound('hurt');if(!this.reduced.matches)this.cameras.main.flash(90,90,22,15,false)}
 }
 private syncBoss(time:number){
  if(!this.boss)return
  const boss=this.state.golem,elapsed=this.state.tick-boss.startedTick+this.accumulator/SIMULATION_TICK_MS
  const pose=golemPose(boss.mode,elapsed)
  const anchor=ANGKOR_V2_BY_KEY[pose].anchor
  this.boss.setTexture(angkorV2TextureKey(pose)).setOrigin(anchor.x,anchor.y)
  // Stable root/scale/depth through every pose; restrained stone tremor only.
  this.boss.setX(GOLEM_FOOT.x+(!this.reduced.matches&&boss.mode==='AWAKENING'?Math.sin(time/45)*.7:0))
  this.anchors.forEach((image,i)=>image.setTexture(angkorV2TextureKey(boss.brokenAnchors.includes(ANCHORS[i].id)?'vault-anchor-broken-v2':'vault-anchor-intact-v2')))
  this.gates.forEach(image=>image.setTexture(angkorV2TextureKey(this.state.objectives.anchorsBroken?'side-gate-open-v2':'side-gate-locked-v2')))
  this.door?.setTexture(angkorV2TextureKey(boss.finalVaultBroken?'inner-vault-door-broken-v2':'inner-vault-door-sealed-v2'))
  this.glow?.clear()
  if(boss.mode==='AWAKENING'||boss.mode==='WINDUP')this.glow?.lineStyle(1,0x9fe1d1,.25).strokeEllipse(GOLEM_FOOT.x,GOLEM_FOOT.y-8,58,20)
 }
 private syncWarnings(time:number){
  this.warnings?.clear();this.darts?.clear()
  const boss=this.state.golem
  if(boss.mode==='WINDUP'||boss.mode==='SMASH'){
   for(const p of boss.telegraphedCells)this.warnings?.fillStyle(boss.finalAttack?0xebae64:0xd67b45,boss.mode==='SMASH'?.48:.26).fillRect(p.x*32+1,p.y*32+1,30,30).lineStyle(2,0xffd38c,.95).strokeRect(p.x*32+2,p.y*32+2,28,28)
   if(boss.target){const p=tileToPixel(boss.target),left=Math.max(0,boss.nextTick-this.state.tick-this.accumulator/SIMULATION_TICK_MS),duration=boss.finalAttack?GOLEM_TIMING.finalWindup:GOLEM_TIMING.windup[boss.phase-1]
    this.warnings?.lineStyle(2,0xffedbe,1).strokeCircle(p.x,p.y,4+10*left/duration)
   }
  }
  this.state.darts.forEach((d,i)=>{
   if(d.mode!=='tell'&&d.mode!=='flight')return
   const origin=tileToPixel(DART_GUARDIANS[i].origin)
   for(const p of d.lane)this.warnings?.fillStyle(0xdd945e,.22).fillRect(p.x*32+2,p.y*32+2,28,28).lineStyle(1,0xffcb7e,.85).strokeRect(p.x*32+3,p.y*32+3,26,26)
   this.darts?.fillStyle(0xffd86a,this.reduced.matches ? .8 : .6+Math.sin(time/120)*.2).fillCircle(origin.x-4,origin.y-25,2).fillCircle(origin.x+4,origin.y-25,2)
   if(d.mode==='flight'){const first=tileToPixel(d.lane[0]),last=tileToPixel(d.lane.at(-1)!),t=Math.min(1,(DART_TIMING.flight-(d.nextTick-this.state.tick)+this.accumulator/SIMULATION_TICK_MS)/DART_TIMING.flight),x=first.x+(last.x-first.x)*t,y=first.y
    this.darts?.lineStyle(2,0xd3bd91,1).lineBetween(x-7,y,x,y).fillStyle(0xffd86a,1).fillTriangle(x+4,y,x-1,y-3,x-1,y+3)
   }
  })
 }
 update(time:number,delta:number){
  if(!this.environment||!this.explorer||!this.traversal)return
  const active=this.running&&(this.options.canAct?.() ?? true)&&!document.hidden&&document.hasFocus();this.tweens.timeScale=active?1:0
  if(active){this.traversal.update(delta);this.accumulator+=Math.min(delta,50);if(this.accumulator>=SIMULATION_TICK_MS&&this.running){this.accumulator-=SIMULATION_TICK_MS;this.dispatch({type:'TICK'})}}
  else this.traversal.clearInput()
  this.explorer.update(active?delta:0,this.reduced.matches);this.environment.update(delta);this.syncBoss(time);this.syncWarnings(time)
  this.explorer.sprite.setAlpha(this.state.tick<this.state.invulnerableUntil ? .7 : 1)
  this.scroll=followCamera(this.scroll,this.traversal.foot,stageMap.world,delta,this.reduced.matches,this.options.viewport);this.cameras.main.setScroll(this.scroll.x,this.scroll.y)
  if(this.debug){this.collision?.clear().lineStyle(1,0x63dbe0,.45);stageMap.collision.layout.forEach((row,y)=>[...row].forEach((c,x)=>{
   this.collision?.strokeRect(x*32,y*32,32,32);if(c==='#'||isBlocked(this.state,{x,y}))this.collision?.fillStyle(0xff8072,.2).fillRect(x*32,y*32,32,32)
  }));for(const p of GOLEM_ROOT)this.collision?.fillStyle(0x7795ff,.25).fillRect(p.x*32,p.y*32,32,32)}
  const d=this.game.canvas.dataset;d.logical=this.state.player.x+','+this.state.player.y;d.moving=String(this.traversal.moving);d.to=this.traversal.activeMove?this.traversal.activeMove.to.x+','+this.traversal.activeMove.to.y:d.logical
  d.status=this.state.status;d.running=String(this.running);d.hp=String(this.state.hp);d.tick=String(this.state.tick);d.scroll=this.scroll.x+','+this.scroll.y;d.faded=String(this.environment.fadedStructureCount)
  this.reportMs+=delta;if(this.reportMs>100){d.state=JSON.stringify(this.state);this.reportMs=0;if(this.debug)this.options.onState(this.state)}
 }
}
