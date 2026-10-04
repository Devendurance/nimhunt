import { describe,it,expect } from 'vitest'
import { freshCarry } from '../contracts'
import { AREAS,BOULDERS,EXIT,GATE,GEMS,KEY,PLATE,POTION,PRESSURE_GATE,RUBBLE,SNAKES,MONKEY,SPIKES,stageMap } from './level'
import { DAMAGE,initialStageState,planStageMove,reduceStage,replayStage,sameCell,type StageState,type StageAction } from './model'
import { solveApproach,walkTo } from './testRoutes'
const ticks=(s:StageState,n:number)=>Array.from({length:n}).reduce<StageState>(state=>reduceStage(state,{type:'TICK'}),s)
const enter=(s:StageState,p:{x:number;y:number})=>reduceStage({...s,player:{x:p.x,y:p.y+1}},{type:'MOVE',direction:'UP'})
function flood(start:{x:number;y:number},blocked:readonly {x:number;y:number}[]){
  const q=[start],seen=new Set([start.x+','+start.y])
  for(let i=0;i<q.length;i++)for(const[dx,dy]of[[0,1],[0,-1],[1,0],[-1,0]]){
    const p={x:q[i].x+dx,y:q[i].y+dy},id=p.x+','+p.y
    if(seen.has(id)||stageMap.collision.layout[p.y]?.[p.x]===undefined||stageMap.collision.layout[p.y][p.x]==='#'||blocked.some(b=>sameCell(b,p)))continue
    seen.add(id);q.push(p)
  }return seen
}
describe('Temple Approach access, not treasure quotas',()=>{
  it('authors 32x24, six connected areas, two stones, three optional Gems, one snake and one monkey',()=>{
    expect(stageMap.world).toEqual({width:1024,height:768});expect(AREAS).toHaveLength(6);expect(BOULDERS).toHaveLength(2);expect(GEMS).toHaveLength(3);expect(SNAKES).toHaveLength(1);expect(MONKEY.perches).toHaveLength(2)
    for(const p of [KEY,GATE,PLATE,PRESSURE_GATE,EXIT,POTION,...GEMS,...BOULDERS,...RUBBLE.tiles,...SNAKES.flatMap(s=>s.path)])expect(stageMap.collision.layout[p.y][p.x]).not.toBe('#')
    expect(flood(stageMap.collision.playerStart,[]).size).toBeGreaterThan(140)
  })
  it('starts fresh100 or exact HP/items without local carry, and reset is a new exact initial state',()=>{
    const initial=initialStageState();expect(initial.hp).toBe(100)
    const carry={hp:37,carriedItems:{sword:true,potion:{owned:true,consumed:true}}}
    const s=initialStageState(carry);expect(s).toMatchObject({...carry,bronzeKeyCollected:false,keyHeld:false,outerSealUnlocked:false,mechanismActivated:false,pressurePlateActive:false,collected:[]})
    expect(s.carriedItems).not.toBe(carry.carriedItems);expect(s.carriedItems.potion).not.toBe(carry.carriedItems.potion)
    expect(initialStageState()).toEqual(initial);expect(()=>initialStageState({...carry,hp:0})).toThrow()
  })
  it('key cannot be bypassed and is collected once; seal impossible without it and stays open after consuming it',()=>{
    const initial=initialStageState()
    expect(flood(initial.player,[BOULDERS[0]]).has(KEY.x+','+KEY.y)).toBe(false)
    expect(flood(initial.player,[GATE]).has(PLATE.x+','+PLATE.y)).toBe(false)
    expect(planStageMove({...initial,player:{x:GATE.x-1,y:GATE.y}},'RIGHT')).toBeNull()
    let s=enter(initial,KEY);s=enter(s,KEY);expect(s.events.filter(e=>e.type==='KEY_COLLECTED')).toHaveLength(1)
    s=reduceStage({...s,player:{x:GATE.x-1,y:GATE.y}},{type:'MOVE',direction:'RIGHT'})
    expect(s.outerSealUnlocked).toBe(true);expect(s.keyHeld).toBe(false)
    expect(planStageMove({...s,player:{x:GATE.x-1,y:GATE.y}},'RIGHT')).not.toBeNull()
    expect(s.events.filter(e=>e.type==='OUTER_SEAL_UNLOCKED')).toHaveLength(1)
  })
  it('boulders cannot move diagonally/off tracks/through solids; ALL SIX legal configurations still complete without optional pickups',()=>{
    for(const keyY of [5,6])for(const plateY of [10,11,12]){
      let s=initialStageState();s.boulders[0].y=keyY;s.boulders[1].y=plateY
      solveApproach(()=>s,a=>s=reduceStage(s,a),false)
      expect(s.status).toBe('complete');expect(s.result).toMatchObject({bronzeKeyCollected:true,outerSealUnlocked:true,mechanismActivated:true,optionalGemCount:0})
      expect(s.events.filter(e=>e.type==='STAGE_COMPLETE')).toHaveLength(1)
    }
    const s=initialStageState();expect(planStageMove({...s,player:{x:26,y:10}},'RIGHT')).toBeNull()
    expect(planStageMove({...s,player:{x:27,y:11}},'UP')).toBeNull()
  })
  it('plate is authored-stone-only; reversible gate follows occupancy and never grants out-of-order completion',()=>{
    const start=initialStageState();expect(enter(start,PLATE).pressurePlateActive).toBe(false)
    let s=reduceStage({...start,player:{x:27,y:9},bronzeKeyCollected:true,outerSealUnlocked:true},{type:'MOVE',direction:'DOWN'})
    expect(s.pressurePlateActive).toBe(true);expect(s.mechanismGateOpen).toBe(true);expect(s.mechanismActivated).toBe(true)
    s=reduceStage({...s,player:{x:27,y:10}},{type:'MOVE',direction:'DOWN'})
    expect(s.mechanismGateOpen).toBe(false);expect(s.mechanismActivated).toBe(true)
    expect(s.events.filter(e=>e.type==='MECHANISM_GATE_CLOSED')).toHaveLength(1)
    expect(planStageMove({...s,player:{x:27,y:8}},'UP')).toBeNull()
    const outOfOrder=reduceStage({...start,player:{x:27,y:9}},{type:'MOVE',direction:'DOWN'})
    expect(outOfOrder.mechanismActivated).toBe(false);expect(outOfOrder.exitUnlocked).toBe(false);expect(enter(start,EXIT).status).toBe('playing')
    expect(enter({...start,boulders:[{id:'key-stone',...PLATE}]},PLATE).pressurePlateActive).toBe(false)
  })
  it('rockfall warns for10ticks, impacts22 once, recovers14 and rearms after leaving; continuous safe lane exists',()=>{
    const tell=enter(initialStageState(),RUBBLE.tiles[0]);expect(tell.rubble).toMatchObject({mode:'tell',nextTick:10})
    expect(ticks(tell,9).hp).toBe(100);const impact=ticks(tell,10);expect(impact.hp).toBe(78);expect(impact.rubble).toMatchObject({mode:'recover',nextTick:24})
    expect(impact.events.filter(e=>e.type==='RUBBLE_IMPACT')).toHaveLength(1)
    expect(ticks({...tell,player:{x:23,y:9}},10).hp).toBe(100)
    for(let y=9;y<=11;y++){expect(stageMap.collision.layout[y][23]).toBe('.');expect(RUBBLE.tiles.some(p=>sameCell(p,{x:23,y}))).toBe(false)}
    expect(ticks({...impact,player:{x:23,y:12}},14).rubble.mode).toBe('armed')
    expect(ticks(tell,30)).toEqual(ticks(tell,30));expect(DAMAGE.rubble).toBe(22)
  })
  it('one snake patrol and monkey target snapshot/impact remain deterministic and dodgeable',()=>{
    const snake=ticks({...initialStageState(),player:{x:9,y:10}},1);expect(snake.snakes[0].mode).toBe('alert');expect(ticks(snake,25)).toEqual(ticks(snake,25));expect(ticks(snake,25).events.some(e=>e.type==='SNAKE_MOVED')).toBe(true)
    const m=ticks({...initialStageState(),player:{x:28,y:12}},1);expect(m.monkey.mode).toBe('tell');expect(ticks(m,8).hp).toBe(80);expect(ticks({...m,player:{x:29,y:12}},8).hp).toBe(100)
    expect(ticks(m,25)).toEqual(ticks(m,25))
  })
  it('optional Gems open nothing, collect once; potion immediately heals25/caps100, records consumed rather than restored inventory',()=>{
    let s=enter(initialStageState(),GEMS[0]);s=enter(s,GEMS[0]);expect(s.collected).toEqual([GEMS[0].id]);expect(s.exitUnlocked).toBe(false)
    const p=enter(initialStageState({...freshCarry(),hp:50}),POTION);expect(p.hp).toBe(75);expect(p.carriedItems.potion).toEqual({owned:true,consumed:true});expect(enter(p,POTION).hp).toBe(75)
    expect(enter(initialStageState(),POTION).hp).toBe(100)
  })
  it('damage shares6tick immunity; zero HP freezes state and cannot complete',()=>{
    const damaged=enter(initialStageState(),SPIKES[0].tiles[0]);expect(damaged.hp).toBe(82);expect(ticks(damaged,5).hp).toBe(82);expect(ticks(damaged,6).hp).toBe(64)
    const failed=enter(initialStageState({...freshCarry(),hp:10}),SPIKES[0].tiles[0]);expect(failed.status).toBe('failed');expect(failed.result).toBeNull();expect(reduceStage(failed,{type:'TICK'})).toBe(failed);expect(planStageMove(failed,'UP')).toBeNull()
  })
  it('full legal traversal/result replays identically; all optional pickups work and completion is once',()=>{
    let s=initialStageState();const actions:StageAction[]=[]
    solveApproach(()=>s,a=>{actions.push(a);s=reduceStage(s,a)})
    expect(s.status).toBe('complete');expect(s.result).toMatchObject({stageId:'temple-approach',optionalGemCount:3,hpRemaining:s.hp,carriedItems:s.carriedItems})
    expect(replayStage(actions)).toEqual(s);expect(reduceStage(s,{type:'MOVE',direction:'DOWN'})).toBe(s)
    expect(s.result).not.toHaveProperty('keyHeld');expect(s.result).not.toHaveProperty('boulders');expect(s.events.filter(e=>e.type==='STAGE_COMPLETE')).toHaveLength(1)
    expect(()=>walkTo(()=>initialStageState(),()=>{},EXIT)).toThrow()
  })
})
