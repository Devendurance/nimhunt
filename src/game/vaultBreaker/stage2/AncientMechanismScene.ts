import Phaser from 'phaser'
import { AngkorV2Environment,angkorV2TextureKey,preloadAngkorV2Environment } from '../../rendering/angkorV2/environment'
import { environmentDepth } from '../../rendering/angkorV2/geometry'
import { TileTraversal,ANGKOR_V2_MOVE_MS,type TraversalMove } from '../../traversal/angkorV2/movement'
import { TraversalPlayer } from '../../traversal/angkorV2/player'
import { bindTraversalKeyboard } from '../../traversal/angkorV2/input'
import { cameraTarget,followCamera } from '../../traversal/angkorV2/camera'
import { tileToPixel,type GridCoord } from '../../world/grid'
import type { AngkorV2AssetKey } from '../../assets/angkorV2Manifest'
import type { StageCarry } from '../contracts'
import { stageMap,DECOR,BOULDERS,PLATE,ROTARY,CORE,EXIT,GATES,GEMS,POTION,SNAKES,DART_GUARDIANS,DART_TIMING } from './level'
import { initialStageState,planStageMove,SIMULATION_TICK_MS,type StageState,type StageAction,type StageEvent } from './model'
interface Options{
 carry:StageCarry;viewport:{width:number;height:number};reduceAction:(a:StageAction)=>StageState
 onReady:(scene:AncientMechanismScene)=>void;onState:(s:StageState)=>void;onError:(message:string)=>void
 onNotice:(message:string)=>void;onSound:(kind:'gem'|'unlock'|'hurt')=>void
}
const additional:AngkorV2AssetKey[]=['rotary-seal-v2','mechanism-core-v2','blue-gem-v2','potion-v2','pressure-plate-v2','side-gate-locked-v2','side-gate-open-v2','pushable-boulder-v2','snake-coiled-v2','snake-alert-v2','snake-slither-a-v2','snake-slither-b-v2','dust-small-v2','dust-push-v2','gem-sparkle-v2']
/** Presentation only. The existing traversal commits MOVE on arrival; explicit
 * fixed TICK actions own every guardian/patrol outcome in the isolated reducer. */
export class AncientMechanismScene extends Phaser.Scene{
 readonly options:Options;state:StageState;traversal?:TileTraversal
 private environment?:AngkorV2Environment;private explorer?:TraversalPlayer;private unbind?:()=>void
 private scroll={x:0,y:0};private accumulator=0;private running=false;private debug=false;private reportMs=0
 private reduced=window.matchMedia('(prefers-reduced-motion: reduce)');private failures:string[]=[]
 private stones=new Map<string,Phaser.GameObjects.Image>();private gems=new Map<string,Phaser.GameObjects.Image>()
 private gates:Phaser.GameObjects.Image[]=[];private snakes:Phaser.GameObjects.Image[]=[]
 private plate?:Phaser.GameObjects.Image;private core?:Phaser.GameObjects.Image;private potion?:Phaser.GameObjects.Image;private passage?:Phaser.GameObjects.Image
 private sealState?:Phaser.GameObjects.Graphics;private warnings?:Phaser.GameObjects.Graphics;private darts?:Phaser.GameObjects.Graphics;private collision?:Phaser.GameObjects.Graphics
 constructor(options:Options){super('AncientMechanism');this.options=options;this.state=initialStageState(options.carry)}
 preload(){this.load.on('loaderror',(file:Phaser.Loader.File)=>this.failures.push(file.key));preloadAngkorV2Environment(this,[...additional,...DECOR.map(p=>p.key)])}
 create(){
  if(this.failures.length){this.options.onError('Ancient Mechanism assets could not load. Reload to retry.');return}
  const env=this.environment=new AngkorV2Environment(this,stageMap.visual)
  for(const p of [...stageMap.structures,...DECOR])env.addSprite(p)
  const sprite=(key:AngkorV2AssetKey,p:GridCoord,depthClass:'ground-item'|'low-prop'|'actor'='ground-item')=>env.addSprite({key,...tileToPixel(p),depthClass,occludesPlayer:false})
  for(const gem of GEMS)this.gems.set(gem.id,sprite('blue-gem-v2',gem))
  this.potion=sprite('potion-v2',POTION);this.core=sprite('mechanism-core-v2',CORE)
  this.plate=sprite('pressure-plate-v2',PLATE);this.plate.setY(this.plate.y+15)
  sprite('rotary-seal-v2',ROTARY)
  this.sealState=this.add.graphics().setDepth(environmentDepth('ground-item',tileToPixel(ROTARY).y)+1)
  this.gates=GATES.map(g=>{
   const foot=tileToPixel(g),image=env.addSprite({key:'side-gate-locked-v2',...foot,depthY:foot.y+8,occludesPlayer:false});return image.setY(image.y+16)
  })
  const rails=this.add.graphics().setDepth(environmentDepth('floor-overlay',0))
  for(const b of BOULDERS){
   rails.lineStyle(1,0xc6b27e,.7)
   for(const x of [10,22])rails.lineBetween(b.x*32+x,b.minY*32+3,b.x*32+x,(b.maxY+1)*32-3)
   rails.lineStyle(2,0xc6b27e,.7).lineBetween(b.x*32+8,b.minY*32+2,b.x*32+24,b.minY*32+2).lineBetween(b.x*32+8,(b.maxY+1)*32-2,b.x*32+24,(b.maxY+1)*32-2)
  }
  // Restrained carved channels visually link seal → Relay / Inner Lock.
  rails.lineStyle(1,0x83b9b5,.38).lineBetween(ROTARY.x*32+16,ROTARY.y*32+16,ROTARY.x*32+16,10*32+16)
  for(const b of this.state.boulders)this.stones.set(b.id,sprite('pushable-boulder-v2',b,'low-prop'))
  this.snakes=SNAKES.map(s=>sprite('snake-coiled-v2',s.path[0],'actor'))
  this.passage=env.addSprite({key:'temple-passage-closed-height-v2',x:EXIT.x*32+16,y:EXIT.y*32+24,depthY:EXIT.y*32+8,shadow:true})
  this.traversal=new TileTraversal(stageMap.collision,move=>this.animatePush(move),ANGKOR_V2_MOVE_MS,{
   canEnter:(_from,direction)=>this.running&&Boolean(planStageMove(this.state,direction)),onArrive:move=>this.dispatch({type:'MOVE',direction:move.direction}),
  })
  this.explorer=new TraversalPlayer(this,env,this.traversal);this.unbind=bindTraversalKeyboard(this.traversal)
  this.scroll=cameraTarget(this.traversal.foot,stageMap.world,this.options.viewport)
  this.cameras.main.setBounds(0,0,stageMap.world.width,stageMap.world.height).setScroll(this.scroll.x,this.scroll.y)
  this.warnings=this.add.graphics().setDepth(environmentDepth('floor-overlay',0)+1);this.darts=this.add.graphics().setDepth(10000)
  this.collision=this.add.graphics().setDepth(100000).setVisible(false)
  const canvas=this.game.canvas;canvas.id='vault-breaker-stage2-room';canvas.tabIndex=0
  canvas.setAttribute('aria-label','Vault Breaker Ancient Mechanism. Hold arrows, WASD or directional controls. Step onto the Rotary Seal to cycle A, B, C.')
  canvas.dataset.collision=JSON.stringify(stageMap.collision.layout);canvas.dataset.world='1024,832';canvas.dataset.gems=JSON.stringify(GEMS);canvas.dataset.state=JSON.stringify(this.state);canvas.dataset.ready='true'
  this.syncMechanisms();this.events.once('shutdown',()=>{this.unbind?.();this.explorer?.destroy();env.destroy()})
  this.options.onReady(this);this.options.onState(this.state)
 }
 start(){this.running=true;this.game.canvas.focus()}
 setDebug(visible:boolean){this.debug=visible;this.collision?.setVisible(visible);this.options.onState(this.state)}
 private dispatch(a:StageAction){
  const before=this.state;this.state=this.options.reduceAction(a)
  for(const e of this.state.events.slice(before.events.length))this.present(e)
  this.syncMechanisms();this.game.canvas.dataset.state=JSON.stringify(this.state)
  if(this.state.status!=='playing'){this.running=false;this.traversal?.clearInput();this.options.onState(this.state)}
  else if(this.state.events.length!==before.events.length)this.options.onState(this.state)
 }
 private animatePush(move:TraversalMove){
  const plan=planStageMove(this.state,move.direction);if(!plan?.push)return
  const image=this.stones.get(plan.push.id)!,foot=tileToPixel(plan.push.to)
  this.tweens.add({targets:image,x:foot.x,y:foot.y,duration:ANGKOR_V2_MOVE_MS,onUpdate:()=>image.setDepth(environmentDepth('low-prop',image.y))});this.effect('dust-push-v2',plan.push.from)
 }
 private effect(key:AngkorV2AssetKey,p:GridCoord){
  const foot=tileToPixel(p),image=this.add.image(foot.x,foot.y-8,angkorV2TextureKey(key)).setDisplaySize(28,22).setDepth(environmentDepth('effect',foot.y))
  this.tweens.add({targets:image,alpha:0,duration:this.reduced.matches?100:360,onComplete:()=>image.destroy()})
 }
 private present(e:StageEvent){
  if(e.type==='GEM_COLLECTED'){this.gems.get(e.id)?.setVisible(false);this.effect('gem-sparkle-v2',this.state.player);this.options.onSound('gem');this.options.onNotice('Optional Gem secured · mechanisms unlock the route')}
  if(e.type==='POTION_COLLECTED'){this.potion?.setVisible(false);this.options.onSound('gem');this.options.onNotice('Potion used · +'+e.healed+' HP')}
  if(e.type==='COUNTERWEIGHT_ACTIVATED'||e.type==='COUNTERWEIGHT_RELEASED')this.options.onNotice(this.state.counterweightActive?'Counterweight held · upper route open, lower route sealed':'Counterweight released · lower route open, upper route sealed')
  if(e.type==='ROTARY_SEAL_CHANGED'){this.options.onSound('unlock');this.options.onNotice('Seal '+e.to+' · '+(e.to==='A'?'archive recess':e.to==='B'?'Relay requires held counterweight':'Inner Lock requires Core and counterweight'))}
  if(e.type==='MECHANISM_CORE_ACTIVATED'){this.core?.setVisible(false);this.effect('gem-sparkle-v2',CORE);this.options.onSound('unlock');this.options.onNotice('Mechanism Core awakened · set Seal C with counterweight held')}
  if(e.type==='INNER_LOCK_OPENED'){this.options.onSound('unlock');this.options.onNotice('Inner Lock open · cross the Guardian Run')}
  if(e.type==='DART_GUARDIAN_TELEGRAPH')this.options.onNotice('Guardian eyes awake · leave the amber lane')
  if(e.type==='DART_GUARDIAN_IMPACT')for(const p of e.lane)this.effect('dust-small-v2',p)
  if(e.type==='DAMAGE'){this.options.onSound('hurt');if(!this.reduced.matches)this.cameras.main.flash(90,90,22,15,false)}
  if(e.type==='SNAKE_MOVED'&&!this.reduced.matches){
   const image=this.snakes[SNAKES.findIndex(s=>s.id===e.id)],from=tileToPixel(e.from),to=tileToPixel(e.to)
   this.tweens.killTweensOf(image);image.setPosition(from.x,from.y);this.tweens.add({targets:image,x:to.x,y:to.y,duration:145,onUpdate:()=>image.setDepth(environmentDepth('actor',image.y))})
  }
 }
 private syncMechanisms(){
  this.gates.forEach((image,i)=>image.setTexture(angkorV2TextureKey(this.state.gates[GATES[i].id]?'side-gate-open-v2':'side-gate-locked-v2')))
  this.plate?.setTint(this.state.counterweightActive?0xb5fff3:0xffffff)
  this.passage?.setTexture(angkorV2TextureKey(this.state.innerLockOpen?'temple-passage-open-height-v2':'temple-passage-closed-height-v2'))
  const center={x:ROTARY.x*32+16,y:ROTARY.y*32+16},sockets=[{x:0,y:-9,color:0xf4cc76},{x:-7,y:3,color:0x9ce9ee},{x:7,y:3,color:0xbcdf8b}],active=['A','B','C'].indexOf(this.state.rotaryState)
  this.sealState?.clear()
  sockets.forEach((p,i)=>{
   this.sealState?.fillStyle(i===active?p.color:0x302e25,1).fillCircle(center.x+p.x,center.y+p.y,i===active?3.5:2)
   if(i===active)this.sealState?.lineStyle(1,0x203431,1).strokeCircle(center.x+p.x,center.y+p.y,3.5).lineStyle(1.5,p.color,.9).lineBetween(center.x,center.y-1,center.x+p.x,center.y+p.y)
  })
  this.state.snakes.forEach((s,i)=>{
   const image=this.snakes[i],foot=tileToPixel(SNAKES[i].path[s.index]),key=s.mode==='dormant'?'snake-coiled-v2':s.mode==='alert'?'snake-alert-v2':s.index%2?'snake-slither-a-v2':'snake-slither-b-v2'
   image.setTexture(angkorV2TextureKey(key));if(!this.tweens.isTweening(image))image.setPosition(foot.x,foot.y).setDepth(environmentDepth('actor',foot.y))
  })
 }
 private syncDarts(time:number){
  this.warnings?.clear();this.darts?.clear()
  this.state.darts.forEach((d,i)=>{
   if(d.mode!=='tell'&&d.mode!=='flight')return
   const authored=DART_GUARDIANS[i],origin=tileToPixel(authored.origin)
   for(const p of d.lane)this.warnings?.fillStyle(0xdd945e,.22).fillRect(p.x*32+2,p.y*32+2,28,28).lineStyle(1,0xffcb7e,.85).strokeRect(p.x*32+3,p.y*32+3,26,26)
   this.darts?.fillStyle(0xffd86a,this.reduced.matches ? .8 : .6+Math.sin(time/120)*.2).fillCircle(origin.x-4,origin.y-25,2).fillCircle(origin.x+4,origin.y-25,2)
   if(d.mode==='flight'){
    const first=tileToPixel(d.lane[0]),last=tileToPixel(d.lane.at(-1)!),t=Math.min(1,(DART_TIMING.flight-(d.nextTick-this.state.tick)+this.accumulator/SIMULATION_TICK_MS)/DART_TIMING.flight)
    const x=first.x+(last.x-first.x)*t,y=first.y+(last.y-first.y)*t,horizontal=authored.direction==='RIGHT'
    this.darts?.lineStyle(2,0xd3bd91,1).lineBetween(x-(horizontal?7:0),y+(horizontal?0:7),x,y)
    if(horizontal)this.darts?.fillStyle(0xffd86a,1).fillTriangle(x+4,y,x-1,y-3,x-1,y+3)
    else this.darts?.fillStyle(0xffd86a,1).fillTriangle(x,y-4,x-3,y+1,x+3,y+1)
   }
  })
 }
 update(time:number,delta:number){
  if(!this.environment||!this.explorer||!this.traversal)return
  const active=this.running&&!document.hidden&&document.hasFocus();this.tweens.timeScale=active?1:0
  if(active){this.traversal.update(delta);this.accumulator+=Math.min(delta,50);if(this.accumulator>=SIMULATION_TICK_MS&&this.running){this.accumulator-=SIMULATION_TICK_MS;this.dispatch({type:'TICK'})}}
  else this.traversal.clearInput()
  this.explorer.update(active?delta:0,this.reduced.matches);this.environment.update(delta);this.syncDarts(time)
  this.explorer.sprite.setAlpha(this.state.tick<this.state.invulnerableUntil ? .7 : 1)
  this.scroll=followCamera(this.scroll,this.traversal.foot,stageMap.world,delta,this.reduced.matches,this.options.viewport);this.cameras.main.setScroll(this.scroll.x,this.scroll.y)
  if(this.debug){
   this.collision?.clear().lineStyle(1,0x63dbe0,.45)
   stageMap.collision.layout.forEach((row,y)=>[...row].forEach((c,x)=>{
    this.collision?.strokeRect(x*32,y*32,32,32)
    if(c==='#'||GATES.some(g=>g.x===x&&g.y===y&&!this.state.gates[g.id])||this.state.boulders.some(b=>b.x===x&&b.y===y))this.collision?.fillStyle(0xff8072,.2).fillRect(x*32,y*32,32,32)
   }))
  }
  const d=this.game.canvas.dataset;d.logical=this.state.player.x+','+this.state.player.y;d.moving=String(this.traversal.moving);d.to=this.traversal.activeMove?this.traversal.activeMove.to.x+','+this.traversal.activeMove.to.y:d.logical
  d.status=this.state.status;d.running=String(this.running);d.hp=String(this.state.hp);d.tick=String(this.state.tick);d.scroll=this.scroll.x+','+this.scroll.y;d.faded=String(this.environment.fadedStructureCount)
  this.reportMs+=delta;if(this.reportMs>100){d.state=JSON.stringify(this.state);this.reportMs=0;if(this.debug)this.options.onState(this.state)}
 }
}
