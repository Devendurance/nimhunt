import { calculateMove } from '../../systems/movement'
import { CHEST_POTION_HEAL } from '../../systems/chests'
import { DIRECTION_VECTORS,type Direction,type GridCoord } from '../../world/grid'
import { copyCarry,copyItems,freshCarry,type StageCarry,type CarriedItems,type MechanismObjectives,type MechanismResult } from '../contracts'
import { BOULDERS,PLATE,ROTARY,CORE,EXIT,GATES,GEMS,POTION,SNAKES,DART_GUARDIANS,DART_TIMING,AREAS,linkedGates,inZone,stageMap,type RotaryState,type GateId } from './level'
export const SIMULATION_TICK_MS=150,IMMUNITY_TICKS=6
export const DAMAGE={snake:12,dart:16} as const
export type StageAction={type:'MOVE';direction:Direction}|{type:'TICK'}
type EventPayload=
 | {type:'MOVE';direction:Direction;from:GridCoord;to:GridCoord}
 | {type:'BOULDER_PUSH';id:string;from:GridCoord;to:GridCoord}
 | {type:'DAMAGE';source:keyof typeof DAMAGE;amount:number;hp:number}
 | {type:'GEM_COLLECTED';id:string;optionalGemCount:number}
 | {type:'POTION_COLLECTED';id:string;healed:number}
 | {type:'COUNTERWEIGHT_ACTIVATED'|'COUNTERWEIGHT_RELEASED'}
 | {type:'ROTARY_SEAL_ACTIVATED';at:GridCoord}
 | {type:'ROTARY_SEAL_CHANGED';from:RotaryState;to:RotaryState}
 | {type:'LINKED_GATE_OPENED'|'LINKED_GATE_CLOSED';id:GateId}
 | {type:'RELAY_REACHED'|'MECHANISM_CORE_ACTIVATED'|'INNER_LOCK_OPENED'}
 | {type:'SNAKE_ACTIVATED';id:string}
 | {type:'SNAKE_MOVED';id:string;from:GridCoord;to:GridCoord}
 | {type:'DART_GUARDIAN_TELEGRAPH';id:string;lane:GridCoord[];fireTick:number;impactTick:number}
 | {type:'DART_GUARDIAN_IMPACT';id:string;lane:GridCoord[];hit:boolean}
 | {type:'STAGE_COMPLETE';hp:number}
export type StageEvent=EventPayload & {seq:number;tick:number}
export interface StageState{
 version:1;tick:number;actionCount:number;player:GridCoord;hp:number;invulnerableUntil:number;status:'playing'|'complete'|'failed'
 carriedItems:CarriedItems;counterweightActive:boolean;rotaryState:RotaryState;mechanismCoreActivated:boolean;innerLockOpen:boolean
 objectives:{-readonly [K in keyof MechanismObjectives]:MechanismObjectives[K]};gates:Record<GateId,boolean>;boulders:{id:string;x:number;y:number}[];collected:string[];potionCollected:boolean
 snakes:{id:string;mode:'dormant'|'alert'|'patrol';index:number;nextTick:number}[]
 darts:{id:string;mode:'dormant'|'tell'|'flight'|'recover';nextTick:number;lane:GridCoord[]}[]
 result:MechanismResult|null;events:StageEvent[]
}
export const sameCell=(a:GridCoord,b:GridCoord)=>a.x===b.x&&a.y===b.y
export const emptyMechanismObjectives=():MechanismObjectives=>({counterweightSolved:false,rotaryAligned:false,relayReached:false,mechanismCoreActivated:false,finalCombinationSet:false,innerLockOpened:false})
export function initialStageState(input:StageCarry=freshCarry()):StageState{
 const carry=copyCarry(input);if(!carry.hp)throw new Error('Cannot enter Ancient Mechanism with zero HP')
 return {version:1,tick:0,actionCount:0,player:{...stageMap.collision.playerStart},...carry,invulnerableUntil:0,status:'playing',
  counterweightActive:false,rotaryState:'A',mechanismCoreActivated:false,innerLockOpen:false,objectives:emptyMechanismObjectives(),gates:linkedGates(false,'A',false),
  boulders:BOULDERS.map(({id,x,y})=>({id,x,y})),collected:[],potionCollected:false,
  snakes:SNAKES.map(s=>({id:s.id,mode:'dormant',index:0,nextTick:0})),darts:DART_GUARDIANS.map(d=>({id:d.id,mode:'dormant',nextTick:0,lane:[]})),result:null,events:[]}
}
export function planStageMove(state:StageState,direction:Direction){
 if(state.status!=='playing'||!Object.hasOwn(DIRECTION_VECTORS,direction))return null
 const move=calculateMove(stageMap.collision,state.player,direction)
 if(!move.success||(sameCell(move.to,EXIT)&&!state.innerLockOpen)||GATES.some(g=>sameCell(g,move.to)&&!state.gates[g.id]))return null
 const stone=state.boulders.find(b=>sameCell(b,move.to));if(!stone)return {...move,push:null}
 const track=BOULDERS.find(b=>b.id===stone.id)!,push=calculateMove(stageMap.collision,stone,direction)
 if(!push.success||push.to.x!==track.x||push.to.y<track.minY||push.to.y>track.maxY||state.boulders.some(b=>sameCell(b,push.to)))return null
 return {...move,push:{id:stone.id,from:{x:stone.x,y:stone.y},to:push.to}}
}
export function reduceStage(state:StageState,action:StageAction):StageState{
 if(state.status!=='playing')return state
 const plan=action.type==='MOVE'?planStageMove(state,action.direction):null;if(action.type==='MOVE'&&!plan)return state
 const next:StageState={...state,actionCount:state.actionCount+1,player:{...state.player},carriedItems:copyItems(state.carriedItems),objectives:{...state.objectives},gates:{...state.gates},boulders:state.boulders.map(b=>({...b})),collected:[...state.collected],snakes:state.snakes.map(s=>({...s})),darts:state.darts.map(d=>({...d,lane:d.lane.map(p=>({...p}))})),events:[...state.events]}
 const emit=(event:EventPayload)=>next.events.push({...event,seq:next.events.length+1,tick:next.tick})
 const hurt=(source:keyof typeof DAMAGE)=>{
  if(next.tick<next.invulnerableUntil||next.status!=='playing')return
  const amount=Math.min(next.hp,DAMAGE[source]);next.hp-=amount;next.invulnerableUntil=next.tick+IMMUNITY_TICKS;emit({type:'DAMAGE',source,amount,hp:next.hp});if(!next.hp)next.status='failed'
 }
 if(action.type==='TICK')next.tick++
 if(action.type==='MOVE'&&plan){
  next.player={...plan.to}
  if(plan.push){Object.assign(next.boulders.find(b=>b.id===plan.push!.id)!,plan.push.to);emit({type:'BOULDER_PUSH',...plan.push})}
  emit({type:'MOVE',direction:action.direction,from:plan.from,to:plan.to})
  const occupied=next.boulders.some(b=>b.id===BOULDERS[0].id&&sameCell(b,PLATE))
  if(occupied!==next.counterweightActive){next.counterweightActive=occupied;emit({type:occupied?'COUNTERWEIGHT_ACTIVATED':'COUNTERWEIGHT_RELEASED'})}
  if(occupied)next.objectives.counterweightSolved=true
  if(sameCell(next.player,ROTARY)){
   const from=next.rotaryState;next.rotaryState=from==='A'?'B':from==='B'?'C':'A'
   emit({type:'ROTARY_SEAL_ACTIVATED',at:{...ROTARY}});emit({type:'ROTARY_SEAL_CHANGED',from,to:next.rotaryState})
  }
  if(next.objectives.counterweightSolved&&next.rotaryState==='B')next.objectives.rotaryAligned=true
  if(next.counterweightActive&&next.rotaryState==='B'&&next.objectives.rotaryAligned&&inZone(next.player,AREAS[3])&&!next.objectives.relayReached){next.objectives.relayReached=true;emit({type:'RELAY_REACHED'})}
  if(sameCell(next.player,CORE)&&next.objectives.relayReached&&!next.mechanismCoreActivated){next.mechanismCoreActivated=true;next.objectives.mechanismCoreActivated=true;emit({type:'MECHANISM_CORE_ACTIVATED'})}
  const gates=linkedGates(next.counterweightActive,next.rotaryState,next.mechanismCoreActivated)
  for(const gate of GATES)if(gates[gate.id]!==next.gates[gate.id])emit({type:gates[gate.id]?'LINKED_GATE_OPENED':'LINKED_GATE_CLOSED',id:gate.id})
  next.gates=gates;next.innerLockOpen=gates['inner-lock']
  if(next.innerLockOpen){next.objectives.finalCombinationSet=true;if(!next.objectives.innerLockOpened){next.objectives.innerLockOpened=true;emit({type:'INNER_LOCK_OPENED'})}}
  for(const gem of GEMS)if(sameCell(next.player,gem)&&!next.collected.includes(gem.id)){next.collected.push(gem.id);emit({type:'GEM_COLLECTED',id:gem.id,optionalGemCount:next.collected.length})}
  if(sameCell(next.player,POTION)&&!next.potionCollected){next.potionCollected=true;const healed=Math.min(CHEST_POTION_HEAL,100-next.hp);next.hp+=healed;next.carriedItems={...next.carriedItems,potion:{owned:true,consumed:true}};emit({type:'POTION_COLLECTED',id:POTION.id,healed})}
 }
 next.snakes.forEach((snake,i)=>{
  const authored=SNAKES[i]
  if(snake.mode==='dormant'&&inZone(next.player,authored.zone)){snake.mode='alert';snake.nextTick=next.tick+3;emit({type:'SNAKE_ACTIVATED',id:snake.id})}
  else if(action.type==='TICK'&&snake.mode!=='dormant'&&next.tick>=snake.nextTick){const from=authored.path[snake.index],index=(snake.index+1)%authored.path.length,to=authored.path[index];snake.index=index;snake.mode='patrol';snake.nextTick=next.tick+4;emit({type:'SNAKE_MOVED',id:snake.id,from,to})}
  if(snake.mode!=='dormant'&&sameCell(next.player,authored.path[snake.index]))hurt('snake')
 })
 if(action.type==='TICK'&&next.status==='playing')next.darts.forEach((dart,i)=>{
  const authored=DART_GUARDIANS[i]
  if(dart.mode==='tell'&&next.tick>=dart.nextTick){dart.mode='flight';dart.nextTick=next.tick+DART_TIMING.flight}
  else if(dart.mode==='flight'&&next.tick>=dart.nextTick){const hit=dart.lane.some(p=>sameCell(p,next.player));emit({type:'DART_GUARDIAN_IMPACT',id:dart.id,lane:dart.lane.map(p=>({...p})),hit});if(hit)hurt('dart');dart.mode='recover';dart.nextTick=next.tick+DART_TIMING.recovery;dart.lane=[]}
  else if((dart.mode==='dormant'||dart.mode==='recover')&&next.tick>=dart.nextTick&&inZone(next.player,authored.zone)){dart.mode='tell';dart.lane=authored.lane.map(p=>({...p}));dart.nextTick=next.tick+DART_TIMING.warning;emit({type:'DART_GUARDIAN_TELEGRAPH',id:dart.id,lane:dart.lane.map(p=>({...p})),fireTick:dart.nextTick,impactTick:dart.nextTick+DART_TIMING.flight})}
 })
 if(action.type==='MOVE'&&next.status==='playing'&&next.innerLockOpen&&sameCell(next.player,EXIT)){
  next.status='complete';next.result={stageId:'ancient-mechanism',hpRemaining:next.hp,carriedItems:copyItems(next.carriedItems),...next.objectives,counterweightActive:next.counterweightActive,rotaryState:next.rotaryState,optionalGemCount:next.collected.length,completion:{tick:next.tick,actionCount:next.actionCount}};emit({type:'STAGE_COMPLETE',hp:next.hp})
 }
 return next
}
export const replayStage=(actions:readonly StageAction[],carry?:StageCarry)=>actions.reduce(reduceStage,initialStageState(carry))
