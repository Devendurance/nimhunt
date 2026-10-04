import { readFileSync } from 'node:fs'
import { it,expect } from 'vitest'
import { replayEnvelope,stageFactory,type VaultBreakerEnvelope } from '../runtime'
import { templeApproachAdapter,ancientMechanismAdapter,isStageAction } from '../adapters'
import { replayStage } from './model'
import { linkedGates } from './level'
it('real mobile StageI→II MOVE/TICK recording reproduces every mechanism/carry/result boundary',()=>{
 const envelope=JSON.parse(readFileSync('docs/angkor-v2/vault-breaker-stage2/qa/vault-breaker-stage2-replay.json','utf8')) as VaultBreakerEnvelope
 const factories={'temple-approach':stageFactory(templeApproachAdapter),'ancient-mechanism':stageFactory(ancientMechanismAdapter)}
 const runtime=replayEnvelope(envelope,factories)
 expect(runtime.envelope()).toEqual(envelope);expect(replayEnvelope(envelope,factories).state).toEqual(runtime.state)
 expect(runtime.state).toMatchObject({status:'PLAYING',currentStage:'inner-vault',currentStageIndex:2})
 expect(runtime.state.stageResults).toHaveLength(2)
 const result=runtime.state.stageResults[1]
 expect(result).toMatchObject({stageId:'ancient-mechanism',counterweightActive:true,rotaryState:'C',mechanismCoreActivated:true,innerLockOpened:true,optionalGemCount:3})
 expect(runtime.state.hp).toBe(result.hpRemaining);expect(runtime.state.carriedItems).toEqual(result.carriedItems)
 const start=envelope.entries.find(e=>e.type==='STAGE_STARTED'&&e.stageId==='ancient-mechanism')!
 if(start.type!=='STAGE_STARTED')throw new Error('Stage II carry boundary missing')
 expect(start.carry.hp).toBe(runtime.state.stageResults[0].hpRemaining)
 const recorded=envelope.entries.flatMap(e=>e.type==='STAGE_ACTION'&&e.stageId==='ancient-mechanism'?[e.action]:[])
 expect(recorded.every(isStageAction)).toBe(true)
 const actions=recorded.filter(isStageAction),local=replayStage(actions,start.carry)
 expect(replayStage(actions,start.carry)).toEqual(local)
 expect(local.result).toEqual(result);expect(local.gates).toEqual(linkedGates(true,'C',true))
 expect(local.mechanismCoreActivated).toBe(true);expect(local.collected).toHaveLength(3);expect(local.potionCollected).toBe(true)
 expect(local.events.filter(e=>e.type==='MECHANISM_CORE_ACTIVATED')).toHaveLength(1)
 expect(local.events.filter(e=>e.type==='COUNTERWEIGHT_RELEASED')).toHaveLength(1)
 expect(local.events.flatMap(e=>e.type==='ROTARY_SEAL_CHANGED'?[e.to]:[])).toEqual(['B','C','A','B','C'])
 expect(new Set(local.events.flatMap(e=>e.type==='DART_GUARDIAN_IMPACT'?[e.id]:[]))).toEqual(new Set(['hall-guardian','lock-guardian']))
})
