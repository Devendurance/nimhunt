import { readFileSync } from 'node:fs'
import { describe,it,expect } from 'vitest'
import { CHEST_HUNTER_STAGES,freshCarry,copyCarry,type StageResult } from './contracts'
import { ChestHunterRuntime,replayEnvelope,stageFactory } from './runtime'
import { initialChestHunterState,reduceExpedition,replayLifecycle } from './model'
import { forgottenGalleriesAdapter,lostCourtyardAdapter,isStageAction } from './adapters'
import { initialStageState as initialI,reduceStage as reduceI,type StageAction as ActionI } from './stage1/model'
import { initialStageState as initialII, type StageState as StateII } from './stage2/model'
import { CHESTS,KEY,GATE,PLATE,PRESSURE_GATE,SPIKES } from './stage2/level'
import { solveTreasure } from './stage2/testRoutes'
const oldRun=JSON.parse(readFileSync(new URL('../../../docs/angkor-v2/chest-hunter-stage1/qa/lost-courtyard-local-replay.json',import.meta.url),'utf8')) as {actions:ActionI[]}
const stageIResult:StageResult={stageId:'lost-courtyard',stageChestsOpened:6,expeditionChestsOpened:6,expeditionGems:4,hpRemaining:37,carriedItems:{sword:true,potion:{owned:true,consumed:true}},openedChestIds:['arrival','arcade','archive','store','treasury','store-bonus'],completion:{tick:44,actionCount:66}}
describe('Chest Hunter expedition carry and stage lifecycle',()=>{
 it('fresh run and Stage I remain identical to standalone, while optional carry-in is exact',()=>{
  const r=new ChestHunterRuntime(),stage=r.attachStage(lostCourtyardAdapter)
  expect(stage.state).toEqual(initialI());expect(r.state).toMatchObject({mission:'chest-hunter',status:'PLAYING',hp:100,expeditionChestsOpened:0,expeditionGems:0,stageChestsOpened:0})
  let local=initialI();for(const a of oldRun.actions){if(a.type==='RESET')throw new Error('Unexpected reset');local=reduceI(local,a);expect(stage.dispatch(a)).toEqual(local)}
  expect(r.state.hp).toBe(local.hp);expect(r.state.status).toBe('TRANSITION')
  expect(initialI({...freshCarry(),hp:42,expeditionChestsOpened:3,expeditionGems:6})).toMatchObject({hp:42,expeditionChestsOpened:3,expeditionGems:6,stageChestsOpened:0})
 })
 it('preserves exact HP/treasure/items with no heal or leaked keys/gates/wildlife on Continue',()=>{
  const complete=reduceExpedition(initialChestHunterState(),{type:'STAGE_COMPLETED',result:stageIResult})
  expect(complete.status).toBe('TRANSITION');const next=reduceExpedition(complete,{type:'CONTINUE'})
  expect(next).toMatchObject({currentStage:'forgotten-galleries',currentStageIndex:1,hp:37,expeditionChestsOpened:6,expeditionGems:4,stageChestsOpened:0,carriedItems:stageIResult.carriedItems})
  const state=initialII(copyCarry(next));expect(state).toMatchObject({hp:37,stageChestsOpened:0,keyCollected:false,keyHeld:false,gateUnlocked:false,pressureGateOpen:false,pressurePlateActive:false})
  expect(state.boulders).toEqual([{id:'plate-stone',x:18,y:12}]);expect(state.snakes.every(s=>s.mode==='dormant')).toBe(true);expect(state.monkey.mode).toBe('dormant')
  expect(copyCarry({...next,keyHeld:true,boulders:[],stageChestsOpened:6} as typeof next)).not.toHaveProperty('keyHeld')
 })
 it('cannot skip, continue twice, duplicate completion or advance a failed attempt',()=>{
  const fresh=initialChestHunterState();expect(reduceExpedition(fresh,{type:'CONTINUE'})).toBe(fresh)
  expect(reduceExpedition(fresh,{type:'STAGE_COMPLETED',result:{...stageIResult,stageId:'royal-treasury'}})).toBe(fresh)
  const complete=reduceExpedition(fresh,{type:'STAGE_COMPLETED',result:stageIResult});expect(reduceExpedition(complete,{type:'STAGE_COMPLETED',result:stageIResult})).toBe(complete)
  const next=reduceExpedition(complete,{type:'CONTINUE'});expect(reduceExpedition(next,{type:'CONTINUE'})).toBe(next)
  const failed=reduceExpedition(next,{type:'STAGE_FAILED',stageId:'forgotten-galleries',progress:{...copyCarry(next),hp:0,stageChestsOpened:0}})
  expect(failed.status).toBe('FAILED');expect(failed.stageResults).toHaveLength(1);expect(reduceExpedition(failed,{type:'CONTINUE'})).toBe(failed)
  expect(failed.events.at(-1)?.type).toBe('EXPEDITION_FAILED')
 })
 it('validates counts/items/results and uses the same lifecycle replay for identical ordered results',()=>{
  expect(CHEST_HUNTER_STAGES.map(s=>s.id)).toEqual(['lost-courtyard','forgotten-galleries','royal-treasury']);expect(CHEST_HUNTER_STAGES[2].required).toBeNull()
  const actions=[{type:'STAGE_COMPLETED' as const,result:stageIResult},{type:'CONTINUE' as const}]
  expect(replayLifecycle(actions)).toEqual(replayLifecycle(JSON.parse(JSON.stringify(actions))))
  expect(()=>reduceExpedition(initialChestHunterState(),{type:'STAGE_COMPLETED',result:{...stageIResult,openedChestIds:['same','same']}})).toThrow()
  expect(()=>copyCarry({...freshCarry(),hp:101})).toThrow()
 })
})
describe('Chest Hunter isolated transcript envelope / real adapters',()=>{
 it('replays Stage I → carry → complete Stage II → Royal Treasury contract, including local states',()=>{
  const r=new ChestHunterRuntime(),first=r.attachStage(lostCourtyardAdapter)
  for(const a of oldRun.actions){if(a.type==='RESET')throw new Error('Reset');first.dispatch(a)}
  const carry=copyCarry(r.state);r.continue();const second=r.attachStage(forgottenGalleriesAdapter)
  expect(second.state).toEqual(initialII(carry))
  solveTreasure(()=>second.state,a=>{if(a.type==='RESET')throw new Error('Reset');return second.dispatch(a)})
  expect(r.state.status).toBe('TRANSITION');expect(r.state.expeditionChestsOpened).toBe(14);expect(r.state.expeditionGems).toBe(10)
  expect(r.state.hp).toBe(second.state.hp);expect(r.state.stageResults).toHaveLength(2)
  r.continue();expect(r.state.currentStage).toBe('royal-treasury');expect(r.state.stageChestsOpened).toBe(0);expect(r.state.completedStages).toEqual(['lost-courtyard','forgotten-galleries'])
  let localII:StateII|undefined
  const replay=replayEnvelope(JSON.parse(JSON.stringify(r.envelope())),{
   'lost-courtyard':stageFactory(lostCourtyardAdapter),
   'forgotten-galleries':runtime=>{const local=runtime.attachStage(forgottenGalleriesAdapter);return{dispatch:a=>{if(!isStageAction(a))throw new Error('Invalid action');localII=local.dispatch(a)}}},
  })
  expect(replay.envelope()).toEqual(r.envelope());expect(localII).toEqual(second.state)
  const state=localII!;expect(state.chests.every(c=>c.resolved)).toBe(true);expect(state.gateUnlocked).toBe(true);expect(state.pressureGateOpen).toBe(true);expect(state.carriedItems.sword).toBe(true)
  expect(r.state.stageResults[1]).not.toHaveProperty('boulders');expect(r.state.stageResults[1].hpRemaining).toBe(second.state.hp)
  expect(()=>r.attachStage(forgottenGalleriesAdapter)).toThrow();expect(r.continue()).toBe(r.state)
 })
 it('records reversible plate events and cumulative totals as serializable deterministic stage actions',()=>{
  const r=new ChestHunterRuntime(),first=r.attachStage(lostCourtyardAdapter)
  for(const a of oldRun.actions)if(a.type!=='RESET')first.dispatch(a)
  r.continue();const local=r.attachStage(forgottenGalleriesAdapter)
  expect(local.state).toMatchObject({hp:r.state.hp,stageChestsOpened:0,expeditionChestsOpened:6,expeditionGems:4})
  expect([...CHESTS,KEY,GATE,PLATE,PRESSURE_GATE,...SPIKES[0].tiles]).toHaveLength(14)
  expect(()=>local.dispatch({type:'RESET'} as never)).toThrow('Invalid stage action')
  expect(()=>local.dispatch({type:'MOVE',direction:'UP',extra:1} as never)).toThrow()
  expect(isStageAction({type:'MOVE',direction:'DIAGONAL'})).toBe(false)
  const original=JSON.parse(JSON.stringify(r.envelope()));expect(replayEnvelope(original,{'lost-courtyard':stageFactory(lostCourtyardAdapter)}).state).toEqual(r.state)
  original.entries[0].carry.hp=99;expect(()=>replayEnvelope(original,{})).toThrow('mismatch')
 })
 it('failed real stage prevents Continue and retains inspectable earlier result',()=>{
  const r=new ChestHunterRuntime(),stage=r.attachStage(lostCourtyardAdapter)
  for(const a of oldRun.actions)if(a.type!=='RESET')stage.dispatch(a)
  r.continue();const failed=r.attachStage({...forgottenGalleriesAdapter,create:carry=>({...initialII(carry),player:SPIKES[0].tiles[0]})})
  while(r.state.status==='PLAYING')failed.dispatch({type:'TICK'})
  expect(r.state.status).toBe('FAILED');expect(r.state.hp).toBe(0);expect(r.state.stageResults).toHaveLength(1)
  const before=r.envelope();r.continue();failed.dispatch({type:'TICK'});expect(r.envelope()).toEqual(before)
 })
})


describe('Recorded human-input two-stage expedition',()=>{
 it('reproduces exact browser carry, both local worlds, every access event and Royal Treasury boundary',()=>{
  const envelope=JSON.parse(readFileSync(new URL('../../../docs/angkor-v2/chest-hunter-stage2/qa/chest-hunter-expedition-replay.json',import.meta.url),'utf8'))
  const replay=()=>{
   let first:ReturnType<typeof initialI>|undefined,second:StateII|undefined
   const runtime=replayEnvelope(envelope,{
    'lost-courtyard':r=>{const stage=r.attachStage(lostCourtyardAdapter);return{dispatch:a=>{if(!isStageAction(a))throw new Error('Action');first=stage.dispatch(a)}}},
    'forgotten-galleries':r=>{const stage=r.attachStage(forgottenGalleriesAdapter);return{dispatch:a=>{if(!isStageAction(a))throw new Error('Action');second=stage.dispatch(a)}}},
   })
   return {envelope:runtime.envelope(),first,second}
  }
  const a=replay();expect(a).toEqual(replay());expect(a.envelope).toEqual(envelope)
  expect(a.first?.result).toMatchObject({hpRemaining:82,stageChestsOpened:6,expeditionGems:4})
  expect(a.envelope.snapshot).toMatchObject({currentStage:'royal-treasury',status:'PLAYING',hp:100,expeditionChestsOpened:14,expeditionGems:10,stageChestsOpened:0})
  const s=a.second!;expect(s).toMatchObject({status:'complete',stageChestsOpened:8,keyCollected:true,keyHeld:false,gateUnlocked:true,pressurePlateActive:true,pressureGateOpen:true})
  expect(s.snakes.every(v=>v.mode==='patrol')).toBe(true)
  for(const type of ['KEY_COLLECTED','GATE_UNLOCKED','PRESSURE_PLATE_ACTIVATED','PRESSURE_PLATE_RELEASED','PRESSURE_GATE_OPENED','PRESSURE_GATE_CLOSED','BOULDER_PUSH','SNAKE_ACTIVATED','SNAKE_MOVED','MONKEY_ATTACK_TELEGRAPH','MONKEY_ROCK_IMPACT','EXIT_UNLOCKED','STAGE_COMPLETE'])expect(s.events.some(e=>e.type===type)).toBe(true)
  expect(s.events.filter(e=>e.type==='BOULDER_PUSH')).toHaveLength(3)
  expect(s.events.filter(e=>e.type==='DAMAGE')).toMatchObject([{source:'trap',amount:18}])
  const unlock=s.events.find(e=>e.type==='EXIT_UNLOCKED')!,opens=s.events.filter(e=>e.type==='CHEST_OPENED')
  expect(opens.filter(e=>e.seq<unlock.seq)).toHaveLength(5);expect(opens.filter(e=>e.seq>unlock.seq)).toHaveLength(3)
  expect(envelope.entries.some((e:{type:string;stageId:string})=>e.type==='STAGE_ACTION'&&e.stageId==='royal-treasury')).toBe(false)
  const boundaries=envelope.entries.filter((e:{type:string})=>e.type!=='STAGE_ACTION')
  expect(boundaries.map((e:{type:string})=>e.type)).toEqual(['EXPEDITION_STARTED','STAGE_STARTED','STAGE_COMPLETED','STAGE_ADVANCED','STAGE_STARTED','STAGE_COMPLETED','STAGE_ADVANCED','STAGE_STARTED'])
  expect(boundaries[4].carry.hp).toBe(82);expect(boundaries[7].carry.hp).toBe(100)
 })
})
