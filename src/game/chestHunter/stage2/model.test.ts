import { describe,expect,it } from 'vitest'
import { initialStageState,reduceStage,planStageMove,replayStage,sameCell,DAMAGE,type StageState } from './model'
import { AREAS,BOULDERS,CHESTS,CHEST_REQUIREMENT,EXIT,GATE,KEY,PLATE,PRESSURE_GATE,SNAKES,MONKEY,SPIKES,stageMap } from './level'
import { freshCarry } from '../contracts'
import { solveTreasure } from './testRoutes'
const ticks=(s:StageState,n:number)=>Array.from({length:n}).reduce<StageState>(state=>reduceStage(state,{type:'TICK'}),s)
const enter=(s:StageState,p:{x:number;y:number})=>reduceStage({...s,player:{x:p.x,y:p.y+1}},{type:'MOVE',direction:'UP'})
describe('Forgotten Galleries deterministic access puzzles',()=>{
 it('authors 32x24, six areas, eight fixed chests / five required, two snakes, one monkey and one spike section',()=>{
  expect(stageMap.world).toEqual({width:1024,height:768});expect(AREAS).toHaveLength(6);expect(CHESTS).toHaveLength(8);expect(CHEST_REQUIREMENT).toBe(5)
  expect(CHESTS.map(c=>c.loot)).toEqual(['GEMS','POTION','EMPTY','TRAP','GEMS','SWORD','GEMS','POTION'])
  expect(SNAKES).toHaveLength(2);expect(MONKEY.perches).toHaveLength(2);expect(SPIKES).toHaveLength(1)
  for(const p of [...CHESTS,KEY,GATE,PRESSURE_GATE,PLATE,EXIT,...SNAKES.flatMap<{x:number;y:number}>(s=>s.path)])expect(stageMap.collision.layout[p.y][p.x]).not.toBe('#')
 })
 it('accepts exact HP/chest/Gem/item carry and starts with fresh stage-local state',()=>{
  const carry={hp:37,expeditionChestsOpened:6,expeditionGems:4,carriedItems:{sword:true,potion:{owned:true,consumed:true}}}
  const s=initialStageState(carry);expect(s).toMatchObject({...carry,stageChestsOpened:0,keyCollected:false,gateUnlocked:false,pressureGateOpen:false,pressurePlateActive:false})
  expect(s.snakes.every(v=>v.mode==='dormant')).toBe(true);expect(s.chests.every(c=>!c.resolved)).toBe(true);expect(s.boulders[0].y).toBe(12)
  s.carriedItems.potion.owned=false;expect(carry.carriedItems.potion.owned).toBe(true)
 })
 it('opens each chest once, gives deterministic loot, immediate potion healing and no duplicate sword/bonus',()=>{
  for(const c of CHESTS) {
   let s=enter(initialStageState({...freshCarry(),hp:60,carriedItems:{sword:true,potion:{owned:true,consumed:true}}}),c)
   const snapshot=structuredClone(s);s=enter(s,c)
   expect(s.stageChestsOpened).toBe(1);expect(s.chests.find(v=>v.id===c.id)?.resolved).toBe(true)
   expect(s.events.filter(e=>e.type==='CHEST_OPENED')).toHaveLength(1)
   expect(s.expeditionGems).toBe(c.loot==='GEMS'?2:0);expect(s.hp).toBe(c.loot==='POTION'?85:c.loot==='TRAP'?42:60)
   expect(s.carriedItems).toEqual(snapshot.carriedItems)
   if(c.loot==='SWORD')expect(s.events.find(e=>e.type==='CHEST_LOOT_RESOLVED')).toMatchObject({swordAlreadyOwned:true,gems:0})
  }
 })
 it('uses exact Stage I damage/immunity and fails at zero without completion',()=>{
  expect(DAMAGE).toEqual({snake:12,monkey:20,spikes:18,trap:18})
  const s=enter(initialStageState(),CHESTS[3]);expect(s.hp).toBe(82);expect(s.invulnerableUntil).toBe(6)
  expect(ticks({...s,player:SPIKES[0].tiles[0]},5).hp).toBe(82)
  const failed=enter(initialStageState({...freshCarry(),hp:10}),CHESTS[3]);expect(failed.status).toBe('failed');expect(failed.result).toBeNull();expect(reduceStage(failed,{type:'TICK'})).toBe(failed)
 })
 it('collects Silver Key once, permanently opens only the archive gate and blocks entry without it',()=>{
  const s=initialStageState();expect(planStageMove({...s,player:{x:4,y:6}},'UP')).toBeNull()
  let next=enter(s,KEY);next=enter(next,KEY);expect(next.events.filter(e=>e.type==='KEY_COLLECTED')).toHaveLength(1)
  next=enter(next,GATE);expect(next.keyHeld).toBe(false);expect(next.gateUnlocked).toBe(true)
  next=enter(next,GATE);expect(next.events.filter(e=>e.type==='GATE_UNLOCKED')).toHaveLength(1)
 })
 it('plate responds only to stone, opens/closes reversibly and emits exactly ordered explicit events',()=>{
  let s={...initialStageState(),player:{x:18,y:11}}
  expect(planStageMove({...s,player:{x:9,y:21}},'UP')).toBeNull()
  expect(enter(s,PLATE).pressurePlateActive).toBe(false)
  s=reduceStage(s,{type:'MOVE',direction:'DOWN'});expect(s.pressureGateOpen).toBe(true);expect(s.boulders[0]).toMatchObject(PLATE)
  s=reduceStage(s,{type:'MOVE',direction:'DOWN'});expect(s.pressureGateOpen).toBe(false)
  s=reduceStage({...s,player:{x:18,y:15}},{type:'MOVE',direction:'UP'});expect(s.pressurePlateActive).toBe(true)
  expect(s.events.filter(e=>e.type.startsWith('PRESSURE')).map(e=>e.type)).toEqual(['PRESSURE_PLATE_ACTIVATED','PRESSURE_GATE_OPENED','PRESSURE_PLATE_RELEASED','PRESSURE_GATE_CLOSED','PRESSURE_PLATE_ACTIVATED','PRESSURE_GATE_OPENED'])
  expect(planStageMove({...s,player:{x:17,y:13}},'RIGHT')).toBeNull()
 })
 it('ALL legal stone states keep every treasure and exit reachable, including the open cache; a closed cache cannot be occupied during a legal solo push',()=>{
  for(let y:number=BOULDERS[0].minY;y<=BOULDERS[0].maxY;y++)for(const player of y===13 ? [stageMap.collision.playerStart,{x:7,y:18}] : [stageMap.collision.playerStart]) {
   let s=initialStageState();s.boulders[0].y=y;s.player={...player};s.pressurePlateActive=s.pressureGateOpen=y===13
   solveTreasure(()=>s,a=>s=reduceStage(s,a));expect(s.status).toBe('complete');expect(s.stageChestsOpened).toBe(8)
  }
 })
 it('ordinary wildlife follows fixed activation/patrol/tell/impact timing',()=>{
  for(const [i,snake]of SNAKES.entries()) {
   const s=ticks({...initialStageState(),player:{x:snake.zone.x,y:snake.zone.y}},1);expect(s.snakes[i].mode).toBe('alert')
   expect(ticks(s,26)).toEqual(ticks(s,26));expect(ticks(s,26).events.some(e=>e.type==='SNAKE_MOVED'&&e.id===snake.id)).toBe(true)
  }
  const m=ticks({...initialStageState(),player:{x:25,y:6}},1);expect(m.monkey.mode).toBe('tell')
  expect(ticks(m,8).hp).toBe(80);expect(ticks({...m,player:{x:24,y:6}},8).hp).toBe(100)
  expect(ticks(m,8).monkey.perch).toBe(1)
 })
 it('exit locks below five, unlocks exactly at five and all optional chests stay available',()=>{
  let s=initialStageState();expect(planStageMove({...s,player:{x:27,y:19}},'UP')).toBeNull()
  for(const [i,c]of CHESTS.entries()){s=enter(s,c);expect(s.exitUnlocked).toBe(i>=4);expect(s.status).toBe('playing')}
  expect(s.events.filter(e=>e.type==='EXIT_UNLOCKED')).toHaveLength(1)
  const done=enter(s,EXIT);expect(done.result).toMatchObject({stageId:'forgotten-galleries',stageChestsOpened:8,expeditionChestsOpened:8,expeditionGems:6,hpRemaining:s.hp,openedChestIds:CHESTS.map(c=>c.id)})
  expect(done.result).not.toHaveProperty('keyHeld');expect(done.result).not.toHaveProperty('boulders');expect(done.result).not.toHaveProperty('pressurePlateActive')
  expect(reduceStage(done,{type:'TICK'})).toBe(done);expect(done.events.filter(e=>e.type==='STAGE_COMPLETE')).toHaveLength(1)
 })
 it('reset is exact and ordered actions replay without mutation, diagonal or skipped moves',()=>{
  let s=initialStageState();const actions:Parameters<typeof reduceStage>[1][]=[]
  solveTreasure(()=>s,a=>{actions.push(a);return s=reduceStage(s,a)})
  expect(replayStage(actions)).toEqual(s);expect(replayStage(JSON.parse(JSON.stringify(actions)))).toEqual(s)
  expect(reduceStage(s,{type:'RESET'})).toEqual(initialStageState())
  const initial=initialStageState(),copy=JSON.stringify(initial);reduceStage(initial,{type:'TICK'});expect(JSON.stringify(initial)).toBe(copy)
  for(const e of s.events)if(e.type==='MOVE')expect(Math.abs(e.from.x-e.to.x)+Math.abs(e.from.y-e.to.y)).toBe(1)
  expect(planStageMove(initial,'DIAGONAL' as 'UP')).toBeNull();expect(sameCell(initial.player,s.player)).toBe(false)
 })
})
