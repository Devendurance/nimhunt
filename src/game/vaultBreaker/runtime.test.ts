import { describe,it,expect } from 'vitest'
import { VAULT_BREAKER_STAGES, emptyObjectives, type StageResult } from './contracts'
import { initialVaultBreakerState,reduceExpedition,expeditionCarry } from './model'
import { VaultBreakerRuntime,replayEnvelope,stageFactory } from './runtime'
import { templeApproachAdapter } from './adapters'
import { solveApproach,walkTo } from './stage1/testRoutes'
import { SPIKES } from './stage1/level'
import { initialStageState,reduceStage,type StageAction } from './stage1/model'
function complete(){
  const runtime=new VaultBreakerRuntime(),stage=runtime.attachStage(templeApproachAdapter)
  solveApproach(()=>stage.state,a=>{stage.dispatch(a);if(stage.state.status==='playing')stage.dispatch({type:'TICK'})})
  return {runtime,stage}
}
describe('isolated Vault Breaker lifecycle/transcript',()=>{
  it('defines three canonical stages, Temple Approach and Ancient Mechanism playable; starts100HP with empty objectives',()=>{
    expect(VAULT_BREAKER_STAGES.map(s=>s.id)).toEqual(['temple-approach','ancient-mechanism','inner-vault'])
    const runtime=new VaultBreakerRuntime();expect(runtime.state).toMatchObject({mission:'vault-breaker',status:'PLAYING',hp:100,currentStage:'temple-approach',objectives:emptyObjectives(),optionalGemCount:0})
    const stage=runtime.attachStage(templeApproachAdapter);expect(stage.state).toEqual(initialStageState());expect(()=>runtime.attachStage(templeApproachAdapter)).toThrow();expect(runtime.continue().currentStageIndex).toBe(0)
  })
  it('durable objective result enters transition, carries exact HP/items only, resets local objectives and cannot skipII',()=>{
    const {runtime,stage}=complete(),before=runtime.state
    expect(before.status).toBe('TRANSITION');expect(before.completedStages).toEqual(['temple-approach']);expect(before.stageResults[0]).toMatchObject({bronzeKeyCollected:true,outerSealUnlocked:true,mechanismActivated:true,optionalGemCount:3,hpRemaining:stage.state.hp})
    expect(before.stageResults[0].completion.actionCount).toBe(stage.actionCount)
    const next=runtime.continue();expect(next).toMatchObject({status:'PLAYING',currentStage:'ancient-mechanism',currentStageIndex:1,hp:before.hp,carriedItems:before.carriedItems,objectives:emptyObjectives(),optionalGemCount:0})
    expect(Object.keys(expeditionCarry(next)).sort()).toEqual(['carriedItems','hp']);expect(next.stageResults).toEqual(before.stageResults)
    expect(runtime.continue()).toBe(next);expect(()=>runtime.attachStage(templeApproachAdapter)).toThrow()
    expect(()=>runtime.attachStage({...templeApproachAdapter,definition:VAULT_BREAKER_STAGES[2]})).toThrow()
    const madeUp={...before.stageResults[0],stageId:'ancient-mechanism' as const} as unknown as StageResult;expect(()=>reduceExpedition(next,{type:'STAGE_COMPLETED',result:madeUp})).toThrow()
  })
  it('objective sequence, stage IDs and duplicate/late completion are guarded; no fake quota can unlock',()=>{
    const s=initialVaultBreakerState()
    expect(()=>reduceExpedition(s,{type:'STAGE_PROGRESS',stageId:s.currentStage,progress:{...expeditionCarry(s),optionalGemCount:0,objectives:{bronzeKeyCollected:false,outerSealUnlocked:true,mechanismActivated:false}}})).toThrow()
    const result:StageResult={stageId:'temple-approach',hpRemaining:100,carriedItems:s.carriedItems,optionalGemCount:3,completion:{tick:0,actionCount:0},...emptyObjectives()}
    expect(()=>reduceExpedition(s,{type:'STAGE_COMPLETED',result})).toThrow()
    const {runtime,stage}=complete(),ended=runtime.state,entries=runtime.transcriptLength
    expect(stage.dispatch({type:'TICK'})).toBe(stage.state);expect(runtime.transcriptLength).toBe(entries)
    expect(reduceExpedition(ended,{type:'STAGE_COMPLETED',result:ended.stageResults[0]})).toBe(ended)
    expect(ended.events.filter(e=>e.type==='STAGE_COMPLETED')).toHaveLength(1)
  })
  it('failed stage stops attempt, preserves results and cannot continue or complete; no reset/revive action',()=>{
    const base=new VaultBreakerRuntime();expect(()=>base.attachStage(templeApproachAdapter).dispatch({type:'RESET'} as unknown as StageAction)).toThrow()
    const carry={hp:10,carriedItems:initialVaultBreakerState().carriedItems}
    const local=reduceStage({...initialStageState(carry),player:{x:5,y:13}},{type:'MOVE',direction:'UP'});expect(SPIKES[0].tiles[0]).toEqual({x:5,y:12});expect(local.status).toBe('failed')
    const runtime=new VaultBreakerRuntime(),stage=runtime.attachStage(templeApproachAdapter)
    // Actual legal traversal into spikes, then explicit ticks until HP0.
    walkTo(()=>stage.state,a=>stage.dispatch(a),SPIKES[0].tiles[0])
    for(let i=0;i<60;i++)stage.dispatch({type:'TICK'})
    expect(runtime.state.status).toBe('FAILED');expect(runtime.state.hp).toBe(0);expect(runtime.continue()).toBe(runtime.state);expect(runtime.state.stageResults).toHaveLength(0)
    expect(runtime.state.events.filter(e=>e.type==='EXPEDITION_FAILED')).toHaveLength(1)
  })
  it('MOVE/TICK actions, boundaries, objectives/result/item snapshots and StageII start replay byte-identically; altered transcript rejected',()=>{
    const {runtime}=complete();runtime.continue();const envelope=runtime.envelope()
    const replay=replayEnvelope(envelope,{'temple-approach':stageFactory(templeApproachAdapter)})
    expect(replay.envelope()).toEqual(envelope);expect(replay.state).toEqual(runtime.state)
    const types=envelope.entries.map(e=>e.type);expect(types.slice(0,2)).toEqual(['EXPEDITION_STARTED','STAGE_STARTED']);expect(types.slice(-3)).toEqual(['STAGE_COMPLETED','STAGE_ADVANCED','STAGE_STARTED'])
    expect(envelope.entries.filter(e=>e.type==='STAGE_COMPLETED')).toHaveLength(1)
    const corrupted=structuredClone(envelope) as typeof envelope
    const boundary=corrupted.entries.find(e=>e.type==='STAGE_COMPLETED')!
    Object.assign(boundary.carryOut,{hp:1000});expect(()=>replayEnvelope(corrupted,{'temple-approach':stageFactory(templeApproachAdapter)})).toThrow()
    expect(()=>replayEnvelope(envelope,{})).toThrow()
  })
  it('copying carry excludes injected stage-local keys/gates; consumed potions never replenish at transition',()=>{
    const {runtime}=complete();const carry=expeditionCarry(runtime.state);expect(carry.carriedItems.potion).toEqual({owned:true,consumed:true})
    const next=runtime.continue();expect(expeditionCarry(next)).toEqual(carry);expect(next).not.toHaveProperty('keyHeld');expect(next).not.toHaveProperty('boulders')
    expect(expeditionCarry({...next,keyHeld:true} as typeof next)).not.toHaveProperty('keyHeld')
  })
})
