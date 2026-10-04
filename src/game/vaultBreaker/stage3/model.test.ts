import { describe,it,expect } from 'vitest'
import { DIRECTION_VECTORS,type Direction } from '../../world/grid'
import { initialStageState,reduceStage,replayStage,planStageMove,smashCells,sameCell,DAMAGE,IMMUNITY_TICKS,type StageAction } from './model'
import { ANCHORS,GOLEM_ROOT,FINAL_BAIT,VAULT_DOOR,SHRINE,GOLEM_TIMING,stageMap,DART_GUARDIANS,GEMS } from './level'
import { walkTo,waitFor,bait,solveVault } from './testRoutes'
function run(hp=100){let state=initialStageState({hp,carriedItems:{sword:true,potion:{owned:true,consumed:true}}});const actions:StageAction[]=[];return {read:()=>state,dispatch:(a:StageAction)=>{actions.push(a);state=reduceStage(state,a);return state},actions}}
describe('Inner Vault deterministic environmental guardian',()=>{
 it('32×26 explicit map, exact carry, clean local state and minimal defenses',()=>{
  const r=run(47);expect(r.read()).toMatchObject({hp:47,actionCount:0,collected:[],golem:{mode:'DORMANT',brokenAnchors:[],finalVaultBroken:false},carriedItems:{sword:true,potion:{owned:true,consumed:true}}})
  expect(Object.values(r.read().objectives).every(v=>!v)).toBe(true);expect(r.read()).not.toHaveProperty('boulders');expect(stageMap.world).toEqual({width:1024,height:832});expect(GEMS).toHaveLength(3);expect(DART_GUARDIANS).toHaveLength(1)
  expect(()=>initialStageState({hp:0,carriedItems:r.read().carriedItems})).toThrow()
  for(const p of GOLEM_ROOT)for(const direction of Object.keys(DIRECTION_VECTORS) as Direction[]){const v=DIRECTION_VECTORS[direction];expect(planStageMove({...r.read(),player:{x:p.x-v.x,y:p.y-v.y}},direction)).toBeNull()}
 })
 it('awakens once, snapshots target, fixed phase tell, fair missed attempt and recovery',()=>{
  const r=run();walkTo(r.read,r.dispatch,{x:21,y:15});walkTo(r.read,r.dispatch,ANCHORS[2].bait)
  expect(r.read().golem.mode).toBe('AWAKENING');waitFor(r.read,r.dispatch,s=>s.golem.mode==='WINDUP')
  const snapshot=structuredClone(r.read().golem),tick=r.read().tick
  expect(snapshot.nextTick-tick).toBe(GOLEM_TIMING.windup[0]);walkTo(r.read,r.dispatch,{x:22,y:16})
  expect(r.read().golem.target).toEqual(snapshot.target);expect(r.read().golem.telegraphedCells).toEqual(snapshot.telegraphedCells)
  waitFor(r.read,r.dispatch,s=>s.golem.mode==='SMASH');expect(r.read().golem.brokenAnchors).toEqual(['south-anchor'])
  walkTo(r.read,r.dispatch,{x:22,y:16});waitFor(r.read,r.dispatch,s=>s.golem.mode==='WINDUP');waitFor(r.read,r.dispatch,s=>s.golem.mode==='RECOVER')
  expect(r.read().golem.brokenAnchors).toHaveLength(1);expect(r.read().hp).toBe(70)
  bait(r.read,r.dispatch,ANCHORS[0].bait);expect(r.read().golem.brokenAnchors).toContain('west-anchor')
  expect(r.read().events.filter(e=>e.type==='GOLEM_AWAKENED')).toHaveLength(1)
 })
 it('only smash breaks anchors, once each; final door cannot break before all three',()=>{
  const r=run();walkTo(r.read,r.dispatch,ANCHORS[0].bait);expect(r.read().golem.brokenAnchors).toEqual([])
  expect(planStageMove({...r.read(),player:{x:23,y:14}},'UP')).toBeNull();expect(planStageMove({...r.read(),player:FINAL_BAIT},'RIGHT')).toBeNull()
  for(const anchor of ANCHORS)bait(r.read,r.dispatch,anchor.bait)
  expect(r.read().golem.brokenAnchors).toEqual(ANCHORS.map(a=>a.id));expect(r.read().golem.finalVaultBroken).toBe(false)
  bait(r.read,r.dispatch,ANCHORS[0].bait);expect(r.read().events.filter(e=>e.type==='VAULT_ANCHOR_BROKEN')).toHaveLength(3)
  bait(r.read,r.dispatch,FINAL_BAIT);expect(r.read().golem).toMatchObject({mode:'STUNNED',finalVaultBroken:true})
  for(let i=0;i<200;i++)r.dispatch({type:'TICK'})
  expect(r.read().golem.mode).toBe('STUNNED');expect(r.read().events.filter(e=>e.type==='VAULT_DOOR_BROKEN')).toHaveLength(1)
 })
 it('damage uses 30 HP and six-tick immunity; failure cannot break final door or complete',()=>{
  expect(DAMAGE.golem).toBe(30);expect(IMMUNITY_TICKS).toBe(6)
  const r=run(30);walkTo(r.read,r.dispatch,{x:21,y:15});walkTo(r.read,r.dispatch,ANCHORS[2].bait);waitFor(r.read,r.dispatch,s=>s.status==='failed')
  expect(r.read().hp).toBe(0);expect(r.read().events.filter(e=>e.type==='DAMAGE')).toEqual([expect.objectContaining({amount:30,source:'golem',hp:0})]);expect(r.read().golem.brokenAnchors).toEqual([])
  const failed=r.read();r.dispatch({type:'TICK'});expect(r.read()).toBe(failed);expect(r.read().result).toBeNull()
 })
 it('causeway guardian has a frozen authored lane, fixed warning/flight and safe recess',()=>{
  const r=run();walkTo(r.read,r.dispatch,{x:5,y:12});r.dispatch({type:'TICK'})
  expect(r.read().darts[0]).toMatchObject({mode:'tell',nextTick:9,lane:DART_GUARDIANS[0].lane})
  walkTo(r.read,r.dispatch,{x:5,y:13});waitFor(r.read,r.dispatch,s=>s.darts[0].mode==='recover');expect(r.read().hp).toBe(100)
  walkTo(r.read,r.dispatch,{x:5,y:12});waitFor(r.read,r.dispatch,s=>s.hp<100);expect(r.read().hp).toBe(84)
  const e=r.read().events.find(e=>e.type==='DART_GUARDIAN_TELEGRAPH');expect(e).toMatchObject({fireTick:9,impactTick:11})
  expect(replayStage(r.actions,{hp:100,carriedItems:{sword:true,potion:{owned:true,consumed:true}}})).toEqual(r.read())
 })
 it('all eight anchor subsets preserve every bait/escape/final route; no smash can break two',()=>{
  for(let mask=0;mask<8;mask++){
   const r=run(),base=r.read(),broken=ANCHORS.filter((_,i)=>mask&(1<<i)).map(a=>a.id)
   const state={...base,player:{x:21,y:17},golem:{...base.golem,brokenAnchors:broken},objectives:{...base.objectives,anchorsBroken:broken.length===3}}
   for(const anchor of ANCHORS){let local=state;expect(()=>walkTo(()=>local,a=>{local=reduceStage(local,a)},anchor.bait)).not.toThrow()}
   if(mask===7){let local=state;expect(()=>walkTo(()=>local,a=>{local=reduceStage(local,a)},FINAL_BAIT)).not.toThrow()}
   const reachable=new Set<string>(),frontier=[state.player]
   for(let i=0;i<frontier.length;i++)for(const d of Object.keys(DIRECTION_VECTORS) as Direction[]){const m=planStageMove({...state,player:frontier[i]},d);if(!m)continue;const k=m.to.x+','+m.to.y;if(!reachable.has(k)){reachable.add(k);frontier.push(m.to)}}
   for(let y=5;y<=17;y++)for(let x=13;x<=27;x++){
    if(!reachable.has(x+','+y))continue
    const s={...state,player:{x,y}};if(stageMap.collision.layout[y][x]==='#'||GOLEM_ROOT.some(p=>sameCell(p,s.player))||ANCHORS.some(a=>sameCell(a,s.player)&&!broken.includes(a.id)))continue
    const danger=smashCells(s.player);expect(ANCHORS.filter(a=>danger.some(p=>sameCell(p,a))).length).toBeLessThanOrEqual(1)
    const queue=[{s,n:0}],seen=new Set<string>();let safe=false
    for(let i=0;i<queue.length;i++){const node=queue[i];if(!danger.some(p=>sameCell(p,node.s.player))){safe=true;break}if(node.n===3)continue
     for(const d of Object.keys(DIRECTION_VECTORS) as Direction[]){const move=planStageMove(node.s,d);if(!move)continue;const key=move.to.x+','+move.to.y;if(seen.has(key))continue;seen.add(key);queue.push({s:{...node.s,player:move.to},n:node.n+1})}}
    expect(safe,`safe escape at ${x},${y} subset ${mask}`).toBe(true)
   }
  }
 })
 it('legal full solve, optional pickups, exact durable result, terminal/reset and replay',()=>{
  const r=run(63);solveVault(r.read,r.dispatch)
  expect(r.read().status).toBe('complete');expect(r.read().result).toMatchObject({stageId:'inner-vault',hpRemaining:88,optionalGemCount:3,golemState:'STUNNED',shrineReached:true})
  expect(r.read().player).toEqual(SHRINE);expect(r.read().events.filter(e=>e.type==='GOLEM_FINAL_SMASH')).toHaveLength(1)
  expect(r.read().events.filter(e=>e.type==='STAGE_COMPLETE')).toHaveLength(1);const terminal=r.read();r.dispatch({type:'MOVE',direction:'LEFT'});expect(r.read()).toBe(terminal)
  expect(replayStage(r.actions,{hp:63,carriedItems:{sword:true,potion:{owned:true,consumed:true}}})).toEqual(terminal)
  expect(initialStageState()).toEqual(initialStageState());expect(r.read().golem.telegraphedCells).toEqual(smashCells(FINAL_BAIT));expect(r.read().golem.finalVaultBroken).toBe(true);expect(VAULT_DOOR.y).toBe(12)
 })
})
