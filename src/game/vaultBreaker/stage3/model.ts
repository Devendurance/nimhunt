import { calculateMove } from '../../systems/movement.js'
import { CHEST_POTION_HEAL } from '../../systems/chests.js'
import { DIRECTION_VECTORS,type Direction,type GridCoord } from '../../world/grid.js'
import { copyCarry,copyItems,freshCarry,type StageCarry,type CarriedItems,type VaultObjectives,type VaultResult } from '../contracts.js'
import { stageMap,GOLEM_ROOT,GOLEM_ZONE,ACTIVATION_ZONE,ANCHORS,SEAL_PASSAGE,VAULT_DOOR,SHRINE,GEMS,POTION,DART_GUARDIANS,DART_TIMING,GOLEM_TIMING,inZone,type AnchorId } from './level.js'
export const SIMULATION_TICK_MS=150,IMMUNITY_TICKS=6
export const DAMAGE={golem:30,dart:16} as const
export type StageAction={type:'MOVE';direction:Direction}|{type:'TICK'}
export type GolemMode='DORMANT'|'AWAKENING'|'READY'|'WINDUP'|'SMASH'|'RECOVER'|'STUNNED'
type EventPayload=
 | {type:'MOVE';direction:Direction;from:GridCoord;to:GridCoord}
 | {type:'DAMAGE';source:keyof typeof DAMAGE;amount:number;hp:number}
 | {type:'GEM_COLLECTED';id:string;optionalGemCount:number}
 | {type:'POTION_COLLECTED';id:string;healed:number}
 | {type:'GOLEM_AWAKENED'}
 | {type:'GOLEM_WINDUP'|'FINAL_VAULT_TELEGRAPH';target:GridCoord;cells:GridCoord[];impactTick:number;phase:number}
 | {type:'GOLEM_SMASH'|'GOLEM_FINAL_SMASH';target:GridCoord;cells:GridCoord[];hit:boolean}
 | {type:'VAULT_ANCHOR_BROKEN';id:AnchorId}
 | {type:'GOLEM_PHASE_ADVANCED';phase:number}
 | {type:'BROKEN_SEAL_PASSAGE_OPENED'|'VAULT_DOOR_BROKEN'|'GOLEM_STUNNED'}
 | {type:'DART_GUARDIAN_TELEGRAPH';id:string;lane:GridCoord[];fireTick:number;impactTick:number}
 | {type:'DART_GUARDIAN_IMPACT';id:string;lane:GridCoord[];hit:boolean}
 | {type:'STAGE_COMPLETE'|'EXPEDITION_COMPLETE';hp:number}
export type StageEvent=EventPayload & {seq:number;tick:number}
export interface GolemState{
 mode:GolemMode;phase:number;startedTick:number;nextTick:number;target:GridCoord|null;telegraphedCells:GridCoord[]
 brokenAnchors:AnchorId[];finalAttack:boolean;finalVaultBroken:boolean
}
export interface StageState{
 version:1;tick:number;actionCount:number;player:GridCoord;hp:number;invulnerableUntil:number;status:'playing'|'complete'|'failed'
 carriedItems:CarriedItems;objectives:{-readonly [K in keyof VaultObjectives]:VaultObjectives[K]}
 golem:GolemState;collected:string[];potionCollected:boolean
 darts:{id:string;mode:'dormant'|'tell'|'flight'|'recover';nextTick:number;lane:GridCoord[]}[]
 result:VaultResult|null;events:StageEvent[]
}
export const sameCell=(a:GridCoord,b:GridCoord)=>a.x===b.x&&a.y===b.y
export const emptyVaultObjectives=():VaultObjectives=>({golemAwakened:false,anchorsBroken:false,finalVaultBroken:false,shrineReached:false})
export function initialStageState(input:StageCarry=freshCarry()):StageState{
 const carry=copyCarry(input);if(!carry.hp)throw new Error('Cannot enter Inner Vault with zero HP')
 return {version:1,tick:0,actionCount:0,player:{...stageMap.collision.playerStart},...carry,invulnerableUntil:0,status:'playing',objectives:emptyVaultObjectives(),
  golem:{mode:'DORMANT',phase:1,startedTick:0,nextTick:0,target:null,telegraphedCells:[],brokenAnchors:[],finalAttack:false,finalVaultBroken:false},collected:[],potionCollected:false,
  darts:DART_GUARDIANS.map(d=>({id:d.id,mode:'dormant',nextTick:0,lane:[]})),result:null,events:[]}
}
/** Explicit logical blockers. Rendering and alpha never determine legality. */
export function isBlocked(state:StageState,p:GridCoord):boolean{
 return GOLEM_ROOT.some(c=>sameCell(c,p))||ANCHORS.some(a=>sameCell(a,p)&&!state.golem.brokenAnchors.includes(a.id))
  ||(!state.objectives.anchorsBroken&&SEAL_PASSAGE.some(c=>sameCell(c,p)))||(!state.golem.finalVaultBroken&&sameCell(VAULT_DOOR,p))
  ||(!state.golem.finalVaultBroken&&sameCell(SHRINE,p))
}
export function planStageMove(state:StageState,direction:Direction){
 if(state.status!=='playing'||!Object.hasOwn(DIRECTION_VECTORS,direction))return null
 const move=calculateMove(stageMap.collision,state.player,direction)
 return move.success&&!isBlocked(state,move.to)?move:null
}
/** Frozen 3×3 footprint around the windup snapshot. Anchors are >3 tiles apart. */
export function smashCells(target:GridCoord):GridCoord[]{
 const cells:GridCoord[]=[]
 for(let y=target.y-1;y<=target.y+1;y++)for(let x=target.x-1;x<=target.x+1;x++)if(x>=0&&y>=0&&x<32&&y<26)cells.push({x,y})
 return cells
}
export function reduceStage(state:StageState,action:StageAction):StageState{
 if(state.status!=='playing')return state
 const plan=action.type==='MOVE'?planStageMove(state,action.direction):null;if(action.type==='MOVE'&&!plan)return state
 const next:StageState={...state,actionCount:state.actionCount+1,player:{...state.player},carriedItems:copyItems(state.carriedItems),objectives:{...state.objectives},
  golem:{...state.golem,target:state.golem.target?{...state.golem.target}:null,brokenAnchors:[...state.golem.brokenAnchors],telegraphedCells:state.golem.telegraphedCells.map(p=>({...p}))},
  collected:[...state.collected],darts:state.darts.map(d=>({...d,lane:d.lane.map(p=>({...p}))})),events:[...state.events]}
 const emit=(e:EventPayload)=>next.events.push({...e,seq:next.events.length+1,tick:next.tick})
 const hurt=(source:keyof typeof DAMAGE)=>{
  if(next.tick<next.invulnerableUntil||next.status!=='playing')return
  const amount=Math.min(next.hp,DAMAGE[source]);next.hp-=amount;next.invulnerableUntil=next.tick+IMMUNITY_TICKS;emit({type:'DAMAGE',source,amount,hp:next.hp});if(!next.hp)next.status='failed'
 }
 const boss=next.golem
 const enter=(mode:GolemMode,duration:number)=>{boss.mode=mode;boss.startedTick=next.tick;boss.nextTick=next.tick+duration}
 if(action.type==='TICK')next.tick++
 if(action.type==='MOVE'&&plan){
  next.player={...plan.to};emit({type:'MOVE',direction:action.direction,from:plan.from,to:plan.to})
  for(const gem of GEMS)if(sameCell(next.player,gem)&&!next.collected.includes(gem.id)){next.collected.push(gem.id);emit({type:'GEM_COLLECTED',id:gem.id,optionalGemCount:next.collected.length})}
  if(sameCell(next.player,POTION)&&!next.potionCollected){next.potionCollected=true;const healed=Math.min(CHEST_POTION_HEAL,100-next.hp);next.hp+=healed;next.carriedItems={...next.carriedItems,potion:{owned:true,consumed:true}};emit({type:'POTION_COLLECTED',id:POTION.id,healed})}
 }
 if(boss.mode==='DORMANT'&&inZone(next.player,ACTIVATION_ZONE)){enter('AWAKENING',GOLEM_TIMING.awakening);next.objectives.golemAwakened=true;emit({type:'GOLEM_AWAKENED'})}
 if(action.type==='TICK'&&next.status==='playing'&&next.tick>=boss.nextTick){
  if(boss.mode==='AWAKENING')enter('READY',GOLEM_TIMING.ready)
  else if(boss.mode==='READY'&&inZone(next.player,GOLEM_ZONE)){
   boss.target={...next.player};boss.telegraphedCells=smashCells(boss.target)
   boss.finalAttack=boss.brokenAnchors.length===3&&boss.telegraphedCells.some(p=>sameCell(p,VAULT_DOOR))
   enter('WINDUP',boss.finalAttack?GOLEM_TIMING.finalWindup:GOLEM_TIMING.windup[boss.phase-1])
   emit({type:boss.finalAttack?'FINAL_VAULT_TELEGRAPH':'GOLEM_WINDUP',target:{...boss.target},cells:boss.telegraphedCells.map(p=>({...p})),impactTick:boss.nextTick,phase:boss.phase})
  }else if(boss.mode==='WINDUP'){
   const hit=boss.telegraphedCells.some(p=>sameCell(p,next.player))
   emit({type:boss.finalAttack?'GOLEM_FINAL_SMASH':'GOLEM_SMASH',target:{...boss.target!},cells:boss.telegraphedCells.map(p=>({...p})),hit});if(hit)hurt('golem')
   // Lethal impact ends the attempt before any success/objective authority.
   if(next.status==='playing'){
    if(boss.finalAttack&&boss.brokenAnchors.length===3){boss.finalVaultBroken=true;next.objectives.finalVaultBroken=true;emit({type:'VAULT_DOOR_BROKEN'});enter('STUNNED',0);emit({type:'GOLEM_STUNNED'})}
    else{
     for(const anchor of ANCHORS)if(!boss.brokenAnchors.includes(anchor.id)&&boss.telegraphedCells.some(p=>sameCell(p,anchor))){boss.brokenAnchors.push(anchor.id);emit({type:'VAULT_ANCHOR_BROKEN',id:anchor.id})}
     const phase=Math.min(3,boss.brokenAnchors.length+1)
     if(phase!==boss.phase){boss.phase=phase;emit({type:'GOLEM_PHASE_ADVANCED',phase})}
     if(boss.brokenAnchors.length===3&&!next.objectives.anchorsBroken){next.objectives.anchorsBroken=true;emit({type:'BROKEN_SEAL_PASSAGE_OPENED'})}
     enter('SMASH',GOLEM_TIMING.smash)
    }
   }
  }else if(boss.mode==='SMASH'){boss.telegraphedCells=[];enter('RECOVER',GOLEM_TIMING.recovery)}
  else if(boss.mode==='RECOVER')enter('READY',GOLEM_TIMING.ready)
 }
 if(action.type==='TICK'&&next.status==='playing')next.darts.forEach((dart,i)=>{
  const authored=DART_GUARDIANS[i]
  if(dart.mode==='tell'&&next.tick>=dart.nextTick){dart.mode='flight';dart.nextTick=next.tick+DART_TIMING.flight}
  else if(dart.mode==='flight'&&next.tick>=dart.nextTick){const hit=dart.lane.some(p=>sameCell(p,next.player));emit({type:'DART_GUARDIAN_IMPACT',id:dart.id,lane:dart.lane.map(p=>({...p})),hit});if(hit)hurt('dart');dart.mode='recover';dart.nextTick=next.tick+DART_TIMING.recovery;dart.lane=[]}
  else if((dart.mode==='dormant'||dart.mode==='recover')&&next.tick>=dart.nextTick&&inZone(next.player,authored.zone)){dart.mode='tell';dart.lane=authored.lane.map(p=>({...p}));dart.nextTick=next.tick+DART_TIMING.warning;emit({type:'DART_GUARDIAN_TELEGRAPH',id:dart.id,lane:dart.lane.map(p=>({...p})),fireTick:dart.nextTick,impactTick:dart.nextTick+DART_TIMING.flight})}
 })
 if(action.type==='MOVE'&&next.status==='playing'&&boss.finalVaultBroken&&sameCell(next.player,SHRINE)){
  next.objectives.shrineReached=true;next.status='complete';next.result={stageId:'inner-vault',hpRemaining:next.hp,carriedItems:copyItems(next.carriedItems),...next.objectives,brokenAnchors:[...boss.brokenAnchors],golemState:'STUNNED',optionalGemCount:next.collected.length,completion:{tick:next.tick,actionCount:next.actionCount}}
  emit({type:'STAGE_COMPLETE',hp:next.hp});emit({type:'EXPEDITION_COMPLETE',hp:next.hp})
 }
 return next
}
export const replayStage=(actions:readonly StageAction[],carry?:StageCarry)=>actions.reduce(reduceStage,initialStageState(carry))
