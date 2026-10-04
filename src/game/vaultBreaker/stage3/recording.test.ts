import { readFileSync } from 'node:fs'
import { it,expect } from 'vitest'
import { replayEnvelope,stageFactory,type VaultBreakerEnvelope } from '../runtime'
import { templeApproachAdapter,ancientMechanismAdapter,innerVaultAdapter,isStageAction } from '../adapters'
import { replayStage } from './model'
it('actual mobile three-stage MOVE/TICK envelope reproduces every guardian smash, anchor, carry and completion',()=>{
 const envelope=JSON.parse(readFileSync('docs/angkor-v2/vault-breaker-stage3/qa/vault-breaker-stage3-replay.json','utf8')) as VaultBreakerEnvelope
 const factories={'temple-approach':stageFactory(templeApproachAdapter),'ancient-mechanism':stageFactory(ancientMechanismAdapter),'inner-vault':stageFactory(innerVaultAdapter)}
 const runtime=replayEnvelope(envelope,factories);expect(JSON.stringify(runtime.envelope())).toBe(JSON.stringify(envelope));expect(runtime.state.status).toBe('COMPLETE')
 expect(runtime.state.stageResults).toHaveLength(3);expect(runtime.state.hp).toBe(100);expect(runtime.state.stageResults.reduce((n,r)=>n+r.optionalGemCount,0)).toBe(9)
 const entry=envelope.entries.find(e=>e.type==='STAGE_STARTED'&&e.stageId==='inner-vault')!
 if(entry.type!=='STAGE_STARTED')throw new Error('Missing StageIII carry')
 expect(entry.carry.hp).toBe(runtime.state.stageResults[1].hpRemaining);expect(entry.carry.carriedItems).toEqual(runtime.state.stageResults[1].carriedItems)
 const actions=envelope.entries.flatMap(e=>e.type==='STAGE_ACTION'&&e.stageId==='inner-vault'?[e.action]:[]);expect(actions.every(isStageAction)).toBe(true)
 const local=replayStage(actions.filter(isStageAction),entry.carry);expect(replayStage(actions.filter(isStageAction),entry.carry)).toEqual(local)
 expect(local.result).toEqual(runtime.state.stageResults[2]);expect(local.golem).toMatchObject({mode:'STUNNED',finalVaultBroken:true,brokenAnchors:['south-anchor','west-anchor','east-anchor']})
 expect(local.events.filter(e=>e.type==='GOLEM_AWAKENED')).toHaveLength(1);expect(local.events.filter(e=>e.type==='VAULT_ANCHOR_BROKEN')).toHaveLength(3)
 expect(local.events.filter(e=>e.type==='GOLEM_FINAL_SMASH')).toHaveLength(1);expect(local.events.filter(e=>e.type==='VAULT_DOOR_BROKEN')).toHaveLength(1)
 expect(local.events.filter(e=>e.type==='EXPEDITION_COMPLETE')).toHaveLength(1);expect(local.events.some(e=>e.type==='DART_GUARDIAN_IMPACT')).toBe(true)
 expect(local.collected).toHaveLength(3);expect(local.potionCollected).toBe(true)
})
