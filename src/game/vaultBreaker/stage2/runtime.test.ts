import { describe,it,expect } from 'vitest'
import { VaultBreakerRuntime,replayEnvelope,stageFactory } from '../runtime'
import { templeApproachAdapter,ancientMechanismAdapter } from '../adapters'
import { expeditionCarry,reduceExpedition } from '../model'
import { solveApproach,walkTo as walkApproach } from '../stage1/testRoutes'
import { solveMechanism } from './testRoutes'
const factories={'temple-approach':stageFactory(templeApproachAdapter),'ancient-mechanism':stageFactory(ancientMechanismAdapter)}
function enter(){
 const runtime=new VaultBreakerRuntime(),first=runtime.attachStage(templeApproachAdapter)
 // Actual spike contact then potion during legal Stage I exploration. No state edits.
 walkApproach(()=>first.state,a=>first.dispatch(a),{x:5,y:12})
 solveApproach(()=>first.state,a=>first.dispatch(a))
 runtime.continue();const carry=expeditionCarry(runtime.state),second=runtime.attachStage(ancientMechanismAdapter)
 return {runtime,first,second,carry}
}
describe('Vault Breaker two playable stages / future Inner Vault contract',()=>{
 it('StageI→II exact HP/items; all local objects/objectives reset; cannot skip toIII',()=>{
  const {runtime,first,second,carry}=enter()
  expect(carry.hp).toBe(first.state.hp);expect(second.state.hp).toBe(carry.hp);expect(second.state.carriedItems).toEqual(first.state.carriedItems)
  expect(second.state).toMatchObject({rotaryState:'A',counterweightActive:false,mechanismCoreActivated:false,collected:[]})
  expect(Object.values(second.state.objectives).every(v=>!v)).toBe(true);expect(second.state).not.toHaveProperty('keyHeld')
  expect(second.state.boulders.map(b=>b.id)).toEqual(['counterweight-stone']);expect(runtime.continue().currentStage).toBe('ancient-mechanism')
 })
 it('full real-adapter action transcript reproduces HP/mechanisms/pickups/results/carry and StageIII contract',()=>{
  const {runtime,second}=enter();solveMechanism(()=>second.state,a=>{second.dispatch(a);if(second.state.status==='playing')second.dispatch({type:'TICK'})})
  expect(runtime.state.status).toBe('TRANSITION');expect(runtime.state.stageResults).toHaveLength(2)
  const result=runtime.state.stageResults[1];expect(result).toMatchObject({stageId:'ancient-mechanism',mechanismCoreActivated:true,innerLockOpened:true,rotaryState:'C',counterweightActive:true,hpRemaining:second.state.hp,optionalGemCount:3})
  const length=runtime.transcriptLength;second.dispatch({type:'TICK'});expect(runtime.transcriptLength).toBe(length)
  const next=runtime.continue();expect(next).toMatchObject({status:'PLAYING',currentStage:'inner-vault',currentStageIndex:2,hp:result.hpRemaining,carriedItems:result.carriedItems})
  expect(runtime.continue()).toBe(next);expect(()=>runtime.attachStage({...ancientMechanismAdapter,definition:{id:'inner-vault',name:'Inner Vault',ordinal:3,numeral:'III',implemented:false}})).toThrow()
  const envelope=runtime.envelope();expect(replayEnvelope(envelope,factories).envelope()).toEqual(envelope)
  expect(replayEnvelope(envelope,factories).state).toEqual(runtime.state)
  expect(envelope.entries.filter(e=>e.type==='STAGE_COMPLETED')).toHaveLength(2)
  expect(envelope.entries.slice(-3).map(e=>e.type)).toEqual(['STAGE_COMPLETED','STAGE_ADVANCED','STAGE_STARTED'])
  const corrupted=structuredClone(envelope),boundary=corrupted.entries.find(e=>e.type==='STAGE_COMPLETED'&&e.stageId==='ancient-mechanism')!
  if(boundary.type==='STAGE_COMPLETED'&&boundary.result.stageId==='ancient-mechanism')Object.assign(boundary.result,{rotaryState:'A'})
  expect(()=>replayEnvelope(corrupted,factories)).toThrow()
 })
 it('ordered mechanism objectives validated, failure prevents transition and preserves completed StageI',()=>{
  const {runtime,second}=enter(),s=runtime.state
  expect(()=>reduceExpedition(s,{type:'STAGE_PROGRESS',stageId:'ancient-mechanism',progress:{...expeditionCarry(s),optionalGemCount:0,objectives:{...second.state.objectives,mechanismCoreActivated:true}}})).toThrow()
  const failed=reduceExpedition(s,{type:'STAGE_FAILED',stageId:'ancient-mechanism',progress:{hp:0,carriedItems:s.carriedItems,optionalGemCount:0,objectives:second.state.objectives}})
  expect(failed.status).toBe('FAILED');expect(failed.stageResults).toEqual(s.stageResults);expect(reduceExpedition(failed,{type:'CONTINUE'})).toBe(failed)
 })
})
