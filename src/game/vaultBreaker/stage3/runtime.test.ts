import { describe,it,expect } from 'vitest'
import { VaultBreakerRuntime,replayEnvelope,stageFactory } from '../runtime'
import { templeApproachAdapter,ancientMechanismAdapter,innerVaultAdapter } from '../adapters'
import { expeditionCarry,reduceExpedition } from '../model'
import { solveApproach } from '../stage1/testRoutes'
import { solveMechanism } from '../stage2/testRoutes'
import { solveVault,walkTo,waitFor } from './testRoutes'
import { ANCHORS } from './level'
const factories={'temple-approach':stageFactory(templeApproachAdapter),'ancient-mechanism':stageFactory(ancientMechanismAdapter),'inner-vault':stageFactory(innerVaultAdapter)}
function enter(){const runtime=new VaultBreakerRuntime(),first=runtime.attachStage(templeApproachAdapter);solveApproach(()=>first.state,a=>first.dispatch(a));runtime.continue();const second=runtime.attachStage(ancientMechanismAdapter);solveMechanism(()=>second.state,a=>second.dispatch(a));runtime.continue();const carry=expeditionCarry(runtime.state),third=runtime.attachStage(innerVaultAdapter);return{runtime,first,second,third,carry}}
describe('Vault Breaker complete three-stage expedition',()=>{
 it('exact StageII HP/items, clean local state and no out-of-order completion',()=>{
  const {runtime,second,third,carry}=enter();expect(third.state.hp).toBe(second.state.hp);expect(third.state.carriedItems).toEqual(carry.carriedItems);expect(third.state.collected).toEqual([]);expect(third.state).not.toHaveProperty('rotaryState');expect(third.state.golem.brokenAnchors).toEqual([])
  expect(()=>reduceExpedition(runtime.state,{type:'STAGE_PROGRESS',stageId:'inner-vault',progress:{...carry,optionalGemCount:0,objectives:{...third.state.objectives,finalVaultBroken:true}}})).toThrow();expect(runtime.continue().currentStage).toBe('inner-vault')
 })
 it('full real-stage transcript reproduces boss sequence, HP, pickups, results and final completion byte-for-byte',()=>{
  const {runtime,third}=enter();solveVault(()=>third.state,a=>third.dispatch(a));expect(runtime.state.status).toBe('COMPLETE');expect(runtime.state.stageResults).toHaveLength(3);expect(runtime.state.completedStages).toEqual(['temple-approach','ancient-mechanism','inner-vault'])
  const snapshot=runtime.state,length=runtime.transcriptLength;third.dispatch({type:'TICK'});runtime.continue();expect(runtime.state).toBe(snapshot);expect(runtime.transcriptLength).toBe(length)
  const envelope=runtime.envelope(),replayed=replayEnvelope(envelope,factories);expect(JSON.stringify(replayed.envelope())).toBe(JSON.stringify(envelope));expect(replayed.state).toEqual(snapshot)
  expect(third.state.events.filter(e=>e.type==='VAULT_ANCHOR_BROKEN').map(e=>e.type==='VAULT_ANCHOR_BROKEN'?e.id:null)).toEqual(['south-anchor','west-anchor','east-anchor'])
  expect(snapshot.events.filter(e=>e.type==='EXPEDITION_COMPLETED')).toHaveLength(1)
  const corrupt=structuredClone(envelope),result=corrupt.entries.find(e=>e.type==='STAGE_COMPLETED'&&e.stageId==='inner-vault')!
  if(result.type==='STAGE_COMPLETED'&&result.result.stageId==='inner-vault')Object.assign(result.result,{brokenAnchors:['south-anchor']})
  expect(()=>replayEnvelope(corrupt,factories)).toThrow()
 })
 it('lethal guardian attempts fail without losing earlier results or permitting completion',()=>{
  const {runtime,third}=enter();walkTo(()=>third.state,a=>third.dispatch(a),{x:21,y:15});walkTo(()=>third.state,a=>third.dispatch(a),ANCHORS[2].bait);waitFor(()=>third.state,a=>third.dispatch(a),s=>s.status==='failed',500)
  expect(runtime.state.status).toBe('FAILED');expect(runtime.state.stageResults).toHaveLength(2);expect(third.state.result).toBeNull();expect(runtime.continue().status).toBe('FAILED')
  expect(replayEnvelope(runtime.envelope(),factories).state).toEqual(runtime.state)
 })
})
