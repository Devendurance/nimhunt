import { calculateMove } from '../../systems/movement'
import { CHEST_POTION_HEAL } from '../../systems/chests'
import { DIRECTION_VECTORS, type Direction, type GridCoord } from '../../world/grid'
import { copyCarry, copyItems, freshCarry, type CarriedItems, type StageCarry, type StageResult } from '../contracts'
import { BOULDERS, EXIT, GATE, KEY, PLATE, PRESSURE_GATE, GEMS, POTION, MONKEY, RUBBLE, SNAKES, SPIKES, inZone, stageMap } from './level'

export const SIMULATION_TICK_MS = 150
export const DAMAGE = { spikes: 18, snake: 12, monkey: 20, rubble: 22 } as const
export const IMMUNITY_TICKS = 6
export type StageAction = { type: 'MOVE'; direction: Direction } | { type: 'TICK' }
type EventPayload =
  | { type: 'MOVE'; direction: Direction; from: GridCoord; to: GridCoord }
  | { type: 'GEM_COLLECTED'; id: string; optionalGemCount: number }
  | { type: 'POTION_CONSUMED'; id: string; healed: number }
  | { type: 'DAMAGE'; source: keyof typeof DAMAGE; amount: number; hp: number }
  | { type: 'KEY_COLLECTED'; id: string }
  | { type: 'OUTER_SEAL_UNLOCKED' }
  | { type: 'SNAKE_ACTIVATED'; id: string }
  | { type: 'SNAKE_MOVED'; id: string; from: GridCoord; to: GridCoord }
  | { type: 'MONKEY_ATTACK_TELEGRAPH'; target: GridCoord; impactTick: number; perch: number }
  | { type: 'MONKEY_ROCK_IMPACT'; target: GridCoord; hit: boolean }
  | { type: 'BOULDER_PUSH'; id: string; from: GridCoord; to: GridCoord }
  | { type: 'MECHANISM_PLATE_ACTIVATED' | 'MECHANISM_PLATE_RELEASED' | 'MECHANISM_GATE_OPENED' | 'MECHANISM_GATE_CLOSED' }
  | { type: 'RUBBLE_TELEGRAPH'; tiles: readonly GridCoord[]; impactTick: number }
  | { type: 'RUBBLE_IMPACT'; tiles: readonly GridCoord[]; hit: boolean }
  | { type: 'EXIT_UNLOCKED' }
  | { type: 'STAGE_COMPLETE'; hp: number }
export type StageEvent = EventPayload & { seq: number; tick: number }
export interface StageState {
  version: 1; tick: number; actionCount: number; player: GridCoord; hp: number; invulnerableUntil: number
  status: 'playing' | 'complete' | 'failed'; carriedItems: CarriedItems
  bronzeKeyCollected: boolean; keyHeld: boolean; outerSealUnlocked: boolean; mechanismActivated: boolean
  pressurePlateActive: boolean; mechanismGateOpen: boolean; collected: string[]; potionCollected: boolean
  boulders: { id: string; x: number; y: number }[]
  snakes: { id: string; mode: 'dormant' | 'alert' | 'patrol'; index: number; nextTick: number }[]
  monkey: { mode: 'dormant' | 'tell' | 'recover'; perch: number; nextTick: number; target: GridCoord | null }
  rubble: { mode: 'armed' | 'tell' | 'recover'; nextTick: number }
  exitUnlocked: boolean; result: StageResult | null; events: StageEvent[]
}
export const sameCell = (a: GridCoord, b: GridCoord) => a.x === b.x && a.y === b.y
export function initialStageState(input: StageCarry = freshCarry()): StageState {
  const carry = copyCarry(input)
  if (carry.hp === 0) throw new Error('Cannot start Temple Approach with zero HP')
  return { version: 1, tick: 0, actionCount: 0, player: { ...stageMap.collision.playerStart }, ...carry, invulnerableUntil: 0,
    status: 'playing', bronzeKeyCollected: false, keyHeld: false, outerSealUnlocked: false, mechanismActivated: false,
    pressurePlateActive: false, mechanismGateOpen: false, collected: [], potionCollected: false,
    boulders: BOULDERS.map(({id,x,y})=>({id,x,y})), snakes: SNAKES.map(s=>({id:s.id,mode:'dormant',index:0,nextTick:0})),
    monkey: {mode:'dormant',perch:0,nextTick:0,target:null}, rubble:{mode:'armed',nextTick:0}, exitUnlocked:false,result:null,events:[] }
}
/** Both dynamic gates and masonry rails are logical authority, not PNG alpha. */
export function planStageMove(state: StageState, direction: Direction) {
  if (state.status !== 'playing' || !Object.hasOwn(DIRECTION_VECTORS,direction)) return null
  const move = calculateMove(stageMap.collision,state.player,direction)
  if (!move.success || (sameCell(move.to,EXIT) && !state.exitUnlocked)
    || (sameCell(move.to,PRESSURE_GATE) && !state.mechanismGateOpen)
    || (sameCell(move.to,GATE) && !state.outerSealUnlocked && !state.keyHeld)) return null
  const stone = state.boulders.find(b=>sameCell(b,move.to))
  if (!stone) return {...move,push:null}
  const track = BOULDERS.find(b=>b.id===stone.id)!, push = calculateMove(stageMap.collision,stone,direction)
  if (!push.success || push.to.x!==track.x || push.to.y<track.minY || push.to.y>track.maxY
    || (track.oneWay && (direction!=='UP' || stone.y!==track.y))
    || state.boulders.some(b=>sameCell(b,push.to)) || sameCell(push.to,KEY) || sameCell(push.to,GATE)
    || sameCell(push.to,PRESSURE_GATE) || sameCell(push.to,EXIT) || sameCell(push.to,POTION)
    || GEMS.some(g=>sameCell(g,push.to)) || SNAKES.some(s=>s.path.some(p=>sameCell(p,push.to)))) return null
  return {...move,push:{id:stone.id,from:{x:stone.x,y:stone.y},to:push.to}}
}
export function reduceStage(state: StageState, action: StageAction): StageState {
  if (state.status !== 'playing') return state
  const plan = action.type==='MOVE' ? planStageMove(state,action.direction) : null
  if (action.type==='MOVE' && !plan) return state
  const next: StageState = {...state,actionCount:state.actionCount+1,player:{...state.player},carriedItems:copyItems(state.carriedItems),
    collected:[...state.collected],boulders:state.boulders.map(b=>({...b})),snakes:state.snakes.map(s=>({...s})),
    monkey:{...state.monkey},rubble:{...state.rubble},events:[...state.events]}
  const emit = (event: EventPayload)=>next.events.push({...event,seq:next.events.length+1,tick:next.tick})
  const hurt = (source: keyof typeof DAMAGE)=>{
    if (next.tick<next.invulnerableUntil || next.status!=='playing') return
    const amount=Math.min(next.hp,DAMAGE[source]); next.hp-=amount;next.invulnerableUntil=next.tick+IMMUNITY_TICKS
    emit({type:'DAMAGE',source,amount,hp:next.hp});if(next.hp===0)next.status='failed'
  }
  if(action.type==='TICK')next.tick++
  if(action.type==='MOVE' && plan){
    next.player={...plan.to}
    if(plan.push){Object.assign(next.boulders.find(b=>b.id===plan.push!.id)!,plan.push.to);emit({type:'BOULDER_PUSH',...plan.push})}
    emit({type:'MOVE',direction:action.direction,from:plan.from,to:plan.to})
    if(!next.bronzeKeyCollected && sameCell(next.player,KEY)){
      next.bronzeKeyCollected=true;next.keyHeld=true;emit({type:'KEY_COLLECTED',id:KEY.id})
    }
    if(!next.outerSealUnlocked && next.keyHeld && sameCell(next.player,GATE)){
      next.keyHeld=false;next.outerSealUnlocked=true;emit({type:'OUTER_SEAL_UNLOCKED'})
    }
    // Historical objective never regresses, while the physical gate is reversible.
    const active=next.boulders.some(b=>b.id==='mechanism-stone' && sameCell(b,PLATE))
    if(active && next.outerSealUnlocked)next.mechanismActivated=true
    if(active!==next.pressurePlateActive){
      next.pressurePlateActive=active;next.mechanismGateOpen=active
      emit({type:active?'MECHANISM_PLATE_ACTIVATED':'MECHANISM_PLATE_RELEASED'})
      emit({type:active?'MECHANISM_GATE_OPENED':'MECHANISM_GATE_CLOSED'})
    }
    const gem=GEMS.find(g=>sameCell(g,next.player) && !next.collected.includes(g.id))
    if(gem){next.collected.push(gem.id);emit({type:'GEM_COLLECTED',id:gem.id,optionalGemCount:next.collected.length})}
    if(!next.potionCollected && sameCell(next.player,POTION)){
      next.potionCollected=true
      const healed=Math.min(CHEST_POTION_HEAL,100-next.hp);next.hp+=healed
      next.carriedItems={...next.carriedItems,potion:{owned:true,consumed:true}}
      emit({type:'POTION_CONSUMED',id:POTION.id,healed})
    }
    if(!next.exitUnlocked && next.bronzeKeyCollected && next.outerSealUnlocked && next.mechanismActivated){next.exitUnlocked=true;emit({type:'EXIT_UNLOCKED'})}
  }
  for(const g of SPIKES)if(g.tiles.some(p=>sameCell(p,next.player)))hurt('spikes')
  next.snakes.forEach((snake,i)=>{
    const authored=SNAKES[i]
    if(snake.mode==='dormant' && inZone(next.player,authored.zone)){
      snake.mode='alert';snake.nextTick=next.tick+3;emit({type:'SNAKE_ACTIVATED',id:snake.id})
    }else if(action.type==='TICK' && snake.mode!=='dormant' && next.tick>=snake.nextTick){
      const from=authored.path[snake.index],index=(snake.index+1)%authored.path.length,to=authored.path[index]
      if(!next.boulders.some(b=>sameCell(b,to))){snake.index=index;emit({type:'SNAKE_MOVED',id:snake.id,from,to})}
      snake.mode='patrol';snake.nextTick=next.tick+4
    }
    if(snake.mode!=='dormant' && sameCell(next.player,authored.path[snake.index]))hurt('snake')
  })
  const monkey=next.monkey
  if(action.type==='TICK'){
    if(monkey.mode==='tell' && next.tick>=monkey.nextTick && monkey.target){
      const hit=sameCell(next.player,monkey.target);emit({type:'MONKEY_ROCK_IMPACT',target:{...monkey.target},hit});if(hit)hurt('monkey')
      monkey.mode='recover';monkey.nextTick=next.tick+10;monkey.target=null;monkey.perch=(monkey.perch+1)%MONKEY.perches.length
    }else if(monkey.mode!=='tell' && next.tick>=monkey.nextTick && inZone(next.player,MONKEY.zone)){
      monkey.mode='tell';monkey.target={...next.player};monkey.nextTick=next.tick+8
      emit({type:'MONKEY_ATTACK_TELEGRAPH',target:{...monkey.target},impactTick:monkey.nextTick,perch:monkey.perch})
    }
  }
  const rubble=next.rubble
  if(rubble.mode==='armed' && inZone(next.player,RUBBLE.zone)){
    rubble.mode='tell';rubble.nextTick=next.tick+RUBBLE.tellTicks;emit({type:'RUBBLE_TELEGRAPH',tiles:RUBBLE.tiles,impactTick:rubble.nextTick})
  }else if(action.type==='TICK' && rubble.mode==='tell' && next.tick>=rubble.nextTick){
    const hit=RUBBLE.tiles.some(p=>sameCell(p,next.player));emit({type:'RUBBLE_IMPACT',tiles:RUBBLE.tiles,hit});if(hit)hurt('rubble')
    rubble.mode='recover';rubble.nextTick=next.tick+RUBBLE.recoveryTicks
  }else if(action.type==='TICK' && rubble.mode==='recover' && next.tick>=rubble.nextTick && !inZone(next.player,RUBBLE.zone))rubble.mode='armed'
  if(action.type==='MOVE' && next.status==='playing' && next.exitUnlocked && next.mechanismGateOpen && sameCell(next.player,EXIT)){
    next.status='complete';next.result={stageId:'temple-approach',hpRemaining:next.hp,carriedItems:copyItems(next.carriedItems),
      bronzeKeyCollected:next.bronzeKeyCollected,outerSealUnlocked:next.outerSealUnlocked,mechanismActivated:next.mechanismActivated,
      optionalGemCount:next.collected.length,completion:{tick:next.tick,actionCount:next.actionCount}}
    emit({type:'STAGE_COMPLETE',hp:next.hp})
  }
  return next
}
export function replayStage(actions: readonly StageAction[],carry?:StageCarry):StageState{return actions.reduce(reduceStage,initialStageState(carry))}
