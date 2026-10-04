import { describe,it,expect } from 'vitest'
import { DIRECTION_VECTORS,type Direction } from '../../world/grid'
import { freshCarry } from '../contracts'
import { initialStageState,reduceStage,planStageMove,replayStage,DAMAGE,type StageState,type StageAction } from './model'
import { stageMap,GEMS,GATES,PLATE,ROTARY,CORE,EXIT,DART_GUARDIANS,DART_TIMING,linkedGates,SNAKES,inZone,AREAS } from './level'
import { walkTo,setRotary,solveMechanism } from './testRoutes'
const ticks=(s:StageState,n:number)=>Array.from({length:n}).reduce<StageState>(s=>reduceStage(s,{type:'TICK'}),s)
function run(){let state=initialStageState();const actions:StageAction[]=[];return {read:()=>state,send:(a:StageAction)=>{actions.push(a);state=reduceStage(state,a)},actions}}
describe('Ancient Mechanism deterministic stage',()=>{
  it('32×26 map, six areas, exactly2 guardians/1snake/3optionalGems; exact HP/items carry, local reset',()=>{
    const carry={hp:57,carriedItems:{sword:true,potion:{owned:true,consumed:true}}},s=initialStageState(carry)
    expect(stageMap.world).toEqual({width:1024,height:832});expect(stageMap.collision.layout).toHaveLength(26);expect(AREAS).toHaveLength(6)
    expect(DART_GUARDIANS).toHaveLength(2);expect(SNAKES).toHaveLength(1);expect(GEMS).toHaveLength(3)
    expect(s).toMatchObject({...carry,rotaryState:'A',counterweightActive:false,mechanismCoreActivated:false,collected:[],potionCollected:false})
    expect(s).not.toHaveProperty('keyHeld');expect(()=>initialStageState({...carry,hp:0})).toThrow()
  })
  it('A→B→C→A on entry only; no stationary tick or diagonal/illegal move activates it',()=>{
    const s={...initialStageState(),player:{x:ROTARY.x,y:ROTARY.y+1}},a=reduceStage(s,{type:'MOVE',direction:'UP'})
    expect(a.rotaryState).toBe('B');expect(ticks(a,10).rotaryState).toBe('B')
    const step=(v:StageState)=>reduceStage(reduceStage(v,{type:'MOVE',direction:'DOWN'}),{type:'MOVE',direction:'UP'})
    expect(step(a).rotaryState).toBe('C');expect(step(step(a)).rotaryState).toBe('A')
    expect(a.events.map(e=>e.type)).toEqual(['MOVE','ROTARY_SEAL_ACTIVATED','ROTARY_SEAL_CHANGED','LINKED_GATE_CLOSED'])
    expect(planStageMove(s,'DIAGONAL' as Direction)).toBeNull()
  })
  it('inverse counterweight gates and constrained reversible one-tile pushes; player cannot substitute',()=>{
    let s={...initialStageState(),player:{x:6,y:15}};s=reduceStage(s,{type:'MOVE',direction:'DOWN'})
    expect(s.boulders[0].y).toBe(17);expect(s.counterweightActive).toBe(true);expect(s.gates['counterweight-a']).toBe(true);expect(s.gates['counterweight-b']).toBe(false)
    s=reduceStage(s,{type:'MOVE',direction:'DOWN'});expect(s.boulders[0].y).toBe(18);expect(s.counterweightActive).toBe(false)
    expect(planStageMove(s,'DOWN')).toBeNull();expect(planStageMove({...s,player:{x:5,y:18}},'RIGHT')).toBeNull()
    const standing=reduceStage({...initialStageState(),player:{x:5,y:17}},{type:'MOVE',direction:'RIGHT'})
    expect(standing.player).toEqual(PLATE);expect(standing.counterweightActive).toBe(false)
    for(const plate of [true,false])for(const rotary of ['A','B','C'] as const)expect(linkedGates(plate,rotary,false)).toMatchObject({'counterweight-a':plate,'counterweight-b':!plate,relay:plate&&rotary==='B','rotary-a':rotary==='A','rotary-c':rotary==='C','inner-lock':false})
  })
  it('Relay needs B+plate, Core once; final lock needs Core+C+plate, not history alone',()=>{
    const r=run();walkTo(r.read,r.send,{x:6,y:15});r.send({type:'MOVE',direction:'DOWN'})
    setRotary(r.read,r.send,'A');expect(r.read().gates.relay).toBe(false);expect(r.read().innerLockOpen).toBe(false)
    setRotary(r.read,r.send,'B');walkTo(r.read,r.send,CORE);expect(r.read().mechanismCoreActivated).toBe(true);expect(r.read().innerLockOpen).toBe(false)
    r.send({type:'MOVE',direction:'LEFT'});r.send({type:'MOVE',direction:'RIGHT'});expect(r.read().events.filter(e=>e.type==='MECHANISM_CORE_ACTIVATED')).toHaveLength(1)
    setRotary(r.read,r.send,'C');expect(r.read().innerLockOpen).toBe(true)
    setRotary(r.read,r.send,'A');expect(r.read().innerLockOpen).toBe(false);expect(r.read().objectives.innerLockOpened).toBe(true)
    expect(planStageMove({...r.read(),player:{x:27,y:4}},'UP')).toBeNull()
  })
  it('every reachable player/stone/seal/Core/objective configuration can recover required progress',()=>{
    // Finite structural graph uses the actual MOVE reducer, including entry-triggered
    // rotation, gate collision and constrained pushes. Hazard timing is tested below.
    // Optional loot/HP/events do not alter mechanism reachability; ticks are excluded.
    const key=(s:StageState)=>[s.player.x,s.player.y,s.boulders[0].y,s.rotaryState,s.mechanismCoreActivated,...Object.values(s.objectives)].join(',')
    const states=[initialStageState()],ids=new Map([[key(states[0]),0]]),reverse:number[][]=[[]],goals:number[]=[]
    for(let i=0;i<states.length;i++){
      const s=states[i];if(s.status==='complete'){goals.push(i);continue}
      for(const direction of Object.keys(DIRECTION_VECTORS) as Direction[]){
        if(!planStageMove(s,direction))continue
        const next=reduceStage(s,{type:'MOVE',direction}),id=key(next)
        let index=ids.get(id)
        if(index===undefined){index=states.length;ids.set(id,index);states.push({...next,events:[]});reverse.push([])}
        reverse[index].push(i)
      }
    }
    const recoverable=new Set(goals),queue=[...goals]
    for(let i=0;i<queue.length;i++)for(const id of reverse[queue[i]])if(!recoverable.has(id)){recoverable.add(id);queue.push(id)}
    expect(goals.length).toBeGreaterThan(0);expect(states.length).toBeGreaterThan(1000)
    expect(recoverable.size).toBe(states.length)
    expect(new Set(states.map(s=>s.boulders[0].y))).toEqual(new Set([16,17,18]))
    expect(new Set(states.map(s=>s.rotaryState))).toEqual(new Set(['A','B','C']))
  },30000)
  it('two fixed dart lanes have safe cells, deterministic tell/flight/impact/recovery;16HP and shared immunity',()=>{
    for(const guardian of DART_GUARDIANS){
      const cell=guardian.lane[0],s={...initialStageState(),player:cell}
      const tell=ticks(s,1),index=DART_GUARDIANS.findIndex(d=>d.id===guardian.id)
      expect(tell.darts[index].mode).toBe('tell');expect(tell.darts[index].lane).toEqual(guardian.lane)
      expect(ticks(tell,DART_TIMING.warning-1).hp).toBe(100)
      const impact=ticks(tell,DART_TIMING.warning+DART_TIMING.flight)
      expect(impact.hp).toBe(100-DAMAGE.dart);expect(impact.events.filter(e=>e.type==='DART_GUARDIAN_IMPACT'&&e.id===guardian.id)).toHaveLength(1)
      expect(ticks(s,1+DART_TIMING.warning+DART_TIMING.flight)).toEqual(impact)
      const safe=stageMap.collision.layout.flatMap((row,y)=>[...row].flatMap((c,x)=>c!=='#'&&inZone({x,y},guardian.zone)&&!guardian.lane.some(p=>p.x===x&&p.y===y)?[{x,y}]:[]))
      expect(safe.length).toBeGreaterThan(0);expect(ticks({...s,player:safe[0]},1+DART_TIMING.warning+DART_TIMING.flight).hp).toBe(100)
      const immune=ticks({...s,invulnerableUntil:100},1+DART_TIMING.warning+DART_TIMING.flight);expect(immune.hp).toBe(100)
    }
  })
  it('one optional snake follows authored patrol deterministically, contact damage12; zeroHP terminal',()=>{
    const s={...initialStageState(),player:{...SNAKES[0].path[0]}}
    expect(ticks(s,1).events.some(e=>e.type==='SNAKE_ACTIVATED')).toBe(true)
    expect(ticks(s,20)).toEqual(ticks(s,20));expect(ticks(s,1).hp).toBe(88)
    const failed=ticks({...s,hp:10},1);expect(failed.status).toBe('failed');expect(reduceStage(failed,{type:'MOVE',direction:'RIGHT'})).toBe(failed);expect(failed.result).toBeNull()
  })
  it('optional loot once and potion existing immediate25HP/consumed semantics; durable result/reset/replay',()=>{
    const r=run();solveMechanism(r.read,r.send);const complete=r.read()
    expect(complete.status).toBe('complete');expect(complete.collected).toHaveLength(3);expect(complete.result).toMatchObject({stageId:'ancient-mechanism',counterweightActive:true,rotaryState:'C',mechanismCoreActivated:true,optionalGemCount:3,hpRemaining:complete.hp})
    expect(complete.events.filter(e=>e.type==='STAGE_COMPLETE')).toHaveLength(1);expect(reduceStage(complete,{type:'TICK'})).toBe(complete)
    expect(replayStage(r.actions)).toEqual(complete);expect(initialStageState()).toEqual(initialStageState(freshCarry()))
    expect(complete.carriedItems.potion).toEqual({owned:true,consumed:true});expect(complete.events.filter(e=>e.type==='POTION_COLLECTED')).toHaveLength(1)
    const p={...initialStageState({hp:61,carriedItems:freshCarry().carriedItems}),player:{x:14,y:20}}
    expect(reduceStage(p,{type:'MOVE',direction:'DOWN'}).hp).toBe(86)
    expect(planStageMove({...initialStageState(),player:{x:27,y:2}},'RIGHT')).toBeNull();expect(EXIT).toEqual({x:28,y:2})
    expect(GATES).toHaveLength(6)
  })
})
