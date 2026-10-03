import { describe,it,expect } from 'vitest'
import { initialStageState,reduceStage,planStageMove,replayStage,DAMAGE,type StageState,type StageAction } from './model'
import { freshCarry } from '../contracts'
import { AREAS,CHESTS,CHEST_REQUIREMENT,ROYAL_CACHE_ID,KEY,GATE,PLATES,PRESSURE_GATE,BOULDERS,EXIT,DART_GUARDIANS,DART_TIMING,MONKEY,SNAKES,stageMap } from './level'
import { solveTreasure } from './testRoutes'
const ticks=(s:StageState,n:number)=>Array.from({length:n}).reduce<StageState>(state=>reduceStage(state,{type:'TICK'}),s)
const enter=(s:StageState,p:{x:number;y:number})=>reduceStage({...s,player:{x:p.x,y:p.y+1}},{type:'MOVE',direction:'UP'})
const royal=CHESTS.find(c=>c.id===ROYAL_CACHE_ID)!
describe('Royal Treasury isolated final treasure access',()=>{
 it('authors 32x26, six areas, ten fixed chests / six required, exactly one snake/monkey and one trapped chest',()=>{
  expect(stageMap.world).toEqual({width:1024,height:832});expect(AREAS).toHaveLength(6);expect(CHESTS).toHaveLength(10);expect(CHEST_REQUIREMENT).toBe(6)
  expect(CHESTS.filter(c=>c.loot==='TRAP')).toHaveLength(1);expect(CHESTS.map(c=>c.loot)).toEqual(['GEMS','POTION','EMPTY','TRAP','GEMS','SWORD','GEMS','POTION','EMPTY','GEMS'])
  expect(royal.loot).toBe('GEMS');expect(SNAKES).toHaveLength(1);expect(MONKEY.perches).toHaveLength(2)
  for(const p of [...CHESTS,KEY,GATE,PRESSURE_GATE,EXIT,...PLATES,...BOULDERS,...DART_GUARDIANS.flatMap(g=>g.lane)])expect(stageMap.collision.layout[p.y][p.x]).not.toBe('#')
 })
 it('receives exact Stage II HP/counters/items while every local mechanic starts fresh',()=>{
  const carry={hp:29,expeditionChestsOpened:14,expeditionGems:10,carriedItems:{sword:true,potion:{owned:true,consumed:true}}}
  const s=initialStageState(carry);expect(s).toMatchObject({...carry,stageChestsOpened:0,keyCollected:false,keyHeld:false,gateUnlocked:false,pressurePlateA:false,pressurePlateB:false,pressureGateOpen:false,royalCacheOpened:false})
  expect(s.snakes[0].mode).toBe('dormant');expect(s.monkey.mode).toBe('dormant');expect(s.darts.every(d=>d.mode==='dormant'&&d.lane.length===0)).toBe(true);expect(s.chests.every(c=>!c.resolved)).toBe(true)
  expect(s.boulders.map(b=>b.y)).toEqual([20,20]);s.carriedItems.potion.owned=false;expect(carry.carriedItems.potion.owned).toBe(true)
 })
 it('Royal Cache alone is insufficient; count alone is insufficient; both unlock once and optional treasure remains',()=>{
  const early=enter(initialStageState(),royal);expect(early.royalCacheOpened).toBe(true);expect(early.exitUnlocked).toBe(false)
  let s=initialStageState();for(const c of CHESTS.filter(c=>c.id!==ROYAL_CACHE_ID).slice(0,6))s=enter(s,c)
  expect(s.stageChestsOpened).toBe(6);expect(s.exitUnlocked).toBe(false);expect(planStageMove({...s,player:{x:EXIT.x,y:EXIT.y+1}},'UP')).toBeNull()
  s=enter(s,royal);expect(s.stageChestsOpened).toBe(7);expect(s.exitUnlocked).toBe(true)
  for(const c of CHESTS)s=enter(s,c)
  expect(s.stageChestsOpened).toBe(10);expect(s.events.filter(e=>e.type==='ROYAL_CACHE_OPENED')).toHaveLength(1);expect(s.events.filter(e=>e.type==='EXIT_UNLOCKED')).toHaveLength(1)
  expect(s.status).toBe('playing')
 })
 it('fixed loot resolves once; traps use 18, potions heal at most25 and duplicate sword has no bonus',()=>{
  for(const c of CHESTS){
   let s=enter(initialStageState({...freshCarry(),hp:60,carriedItems:{sword:true,potion:{owned:true,consumed:true}}}),c);s=enter(s,c)
   expect(s.stageChestsOpened).toBe(1);expect(s.expeditionGems).toBe(c.loot==='GEMS'?2:0);expect(s.hp).toBe(c.loot==='TRAP'?42:c.loot==='POTION'?85:60)
   expect(s.events.filter(e=>e.type==='CHEST_OPENED')).toHaveLength(1)
   if(c.loot==='SWORD')expect(s.events.find(e=>e.type==='CHEST_LOOT_RESOLVED')).toMatchObject({swordAlreadyOwned:true,gems:0})
  }
 })
 it('Royal Seal Key is collected/consumed once on its one permanent gate; no bypass reaches twin tracks',()=>{
  const s=initialStageState();expect(planStageMove({...s,player:{x:14,y:23}},'RIGHT')).toBeNull()
  let next=enter(s,KEY);next=enter(next,KEY);expect(next.events.filter(e=>e.type==='KEY_COLLECTED')).toHaveLength(1)
  next=enter(next,GATE);next=enter(next,GATE);expect(next.gateUnlocked).toBe(true);expect(next.keyHeld).toBe(false);expect(next.events.filter(e=>e.type==='GATE_UNLOCKED')).toHaveLength(1)
  const flood=(start:{x:number;y:number},blocked:{x:number;y:number})=>{
   const q=[start],seen=new Set([start.x+','+start.y]);for(let i=0;i<q.length;i++)for(const [dx,dy]of [[0,1],[0,-1],[1,0],[-1,0]]){const p={x:q[i].x+dx,y:q[i].y+dy},id=p.x+','+p.y;if(seen.has(id)||!stageMap.collision.layout[p.y]||stageMap.collision.layout[p.y][p.x]==='#'||(p.x===blocked.x&&p.y===blocked.y))continue;seen.add(id);q.push(p)}return seen
  }
  expect(flood(s.player,GATE).has('18,19')).toBe(false);expect(flood(s.player,PRESSURE_GATE).has('10,19')).toBe(false)
 })
 it('requires BOTH authored stones simultaneously, releases either independently and ignores player/incorrect stone',()=>{
  let s={...initialStageState(),player:{x:18,y:19}}
  expect(enter(s,PLATES[0]).pressurePlateA).toBe(false)
  s=reduceStage(s,{type:'MOVE',direction:'DOWN'});expect(s.pressurePlateA).toBe(true);expect(s.pressurePlateB).toBe(false);expect(s.pressureGateOpen).toBe(false)
  s=reduceStage({...s,player:{x:21,y:19}},{type:'MOVE',direction:'DOWN'});expect(s.pressureGateOpen).toBe(true)
  s=reduceStage(s,{type:'MOVE',direction:'DOWN'});expect(s.pressurePlateB).toBe(false);expect(s.pressureGateOpen).toBe(false)
  s=reduceStage({...s,player:{x:21,y:23}},{type:'MOVE',direction:'UP'});expect(s.pressureGateOpen).toBe(true)
  s=reduceStage({...s,player:{x:18,y:20}},{type:'MOVE',direction:'DOWN'});expect(s.pressurePlateA).toBe(false);expect(s.pressureGateOpen).toBe(false)
  expect(s.events.filter(e=>e.type.includes('PLATE_')||e.type.includes('VAULT_GATE')).map(e=>e.type)).toEqual(['PRESSURE_PLATE_A_ACTIVATED','PRESSURE_PLATE_B_ACTIVATED','ROYAL_VAULT_GATE_OPENED','PRESSURE_PLATE_B_RELEASED','ROYAL_VAULT_GATE_CLOSED','PRESSURE_PLATE_B_ACTIVATED','ROYAL_VAULT_GATE_OPENED','PRESSURE_PLATE_A_RELEASED','ROYAL_VAULT_GATE_CLOSED'])
  const wrong=enter({...initialStageState(),boulders:[{id:'seal-stone-b',x:PLATES[0].x,y:PLATES[0].y}]},PLATES[1]);expect(wrong.pressurePlateA).toBe(false)
  expect(planStageMove({...initialStageState(),player:{x:17,y:20}},'RIGHT')).toBeNull()
 })
 it('ALL nine legal dual-track configurations recover every treasure and final exit',()=>{
  for(let a=20;a<=22;a++)for(let b=20;b<=22;b++){
   let s=initialStageState();s.boulders[0].y=a;s.boulders[1].y=b;s.pressurePlateA=a===21;s.pressurePlateB=b===21;s.pressureGateOpen=s.pressurePlateA&&s.pressurePlateB
   solveTreasure(()=>s,action=>s=reduceStage(s,action));expect(s.status).toBe('complete');expect(s.stageChestsOpened).toBe(10);expect(s.royalCacheOpened).toBe(true)
  }
 })
 it('dart lanes snapshot at tell, fixed8+2 ticks impact for16; recovery fixed16 and safe recesses always exist',()=>{
  for(const [i,g]of DART_GUARDIANS.entries()){
   const player=i===0?{x:4,y:12}:{x:6,y:14};const tell=ticks({...initialStageState(),player},1)
   expect(tell.darts[i].mode).toBe('tell');expect(tell.darts[i].lane).toEqual(g.lane)
   const moved=ticks({...tell,player:{x:4,y:14}},DART_TIMING.warning);expect(moved.darts[i].mode).toBe('flight');expect(moved.darts[i].lane).toEqual(g.lane)
   const impact=ticks(tell,DART_TIMING.warning+DART_TIMING.flight);expect(impact.hp).toBe(84);expect(impact.darts[i].mode).toBe('recover');expect(impact.darts[i].nextTick).toBe(impact.tick+16)
   expect(ticks(tell,10)).toEqual(ticks(tell,10));expect(ticks({...tell,player:{x:4,y:14}},10).hp).toBe(100)
   const safe=[];for(let y=g.zone.y;y<g.zone.y+g.zone.height;y++)for(let x=g.zone.x;x<g.zone.x+g.zone.width;x++)if(stageMap.collision.layout[y][x]!=='#'&&!DART_GUARDIANS.some(d=>d.lane.some(p=>p.x===x&&p.y===y)))safe.push({x,y})
   expect(safe.length).toBeGreaterThan(0)
  }
  const immune=ticks({...initialStageState(),player:{x:4,y:12},invulnerableUntil:20},11);expect(immune.hp).toBe(100);expect(DAMAGE.dart).toBe(16)
 })
 it('one snake and monkey preserve deterministic patrol/target/impact patterns',()=>{
  const s=ticks({...initialStageState(),player:{x:22,y:6}},1);expect(s.snakes[0].mode).toBe('alert');expect(ticks(s,25)).toEqual(ticks(s,25));expect(ticks(s,25).events.some(e=>e.type==='SNAKE_MOVED')).toBe(true)
  const m=ticks({...initialStageState(),player:{x:25,y:6}},1);expect(m.monkey.mode).toBe('tell');expect(ticks(m,8).hp).toBe(80);expect(ticks({...m,player:{x:24,y:6}},8).hp).toBe(100)
 })
 it('completion preserves HP/counters/items/IDs and excludes local keys; failed state cannot complete',()=>{
  let s=initialStageState({...freshCarry(),hp:70,expeditionChestsOpened:14,expeditionGems:10});solveTreasure(()=>s,a=>s=reduceStage(s,a))
  expect(s.result).toMatchObject({stageId:'royal-treasury',stageChestsOpened:10,expeditionChestsOpened:24,expeditionGems:18,hpRemaining:s.hp,openedChestIds:CHESTS.map(c=>c.id)})
  expect(s.result).not.toHaveProperty('keyHeld');expect(s.result).not.toHaveProperty('pressurePlateA');expect(reduceStage(s,{type:'TICK'})).toBe(s)
  expect(s.events.filter(e=>e.type==='STAGE_COMPLETE')).toHaveLength(1)
  const failed=enter(initialStageState({...freshCarry(),hp:10}),CHESTS[3]);expect(failed.status).toBe('failed');expect(reduceStage(failed,{type:'MOVE',direction:'UP'})).toBe(failed);expect(failed.result).toBeNull()
 })
 it('replay reproduces identical state and reset restores exact initial local state',()=>{
  let s=initialStageState();const actions:StageAction[]=[];solveTreasure(()=>s,a=>{actions.push(a);return s=reduceStage(s,a)})
  expect(replayStage(JSON.parse(JSON.stringify(actions)))).toEqual(s);expect(reduceStage(s,{type:'RESET'})).toEqual(initialStageState())
  const start=initialStageState(),copy=JSON.stringify(start);reduceStage(start,{type:'TICK'});expect(JSON.stringify(start)).toBe(copy)
  for(const e of s.events)if(e.type==='MOVE')expect(Math.abs(e.to.x-e.from.x)+Math.abs(e.to.y-e.from.y)).toBe(1)
 })
})
