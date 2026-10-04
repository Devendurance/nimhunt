import { DIRECTION_VECTORS } from '../world/grid'
import { VAULT_BREAKER_STAGES, copyItems, type StageAdapter } from './contracts'
import { initialStageState, reduceStage, type StageAction, type StageState } from './stage1/model'
import * as mechanism from './stage2/model'
import * as vault from './stage3/model'
export const innerVaultAdapter:StageAdapter<vault.StageState,vault.StageAction>={
  definition:VAULT_BREAKER_STAGES[2],create:vault.initialStageState,reduce:vault.reduceStage,isAction:isStageAction,
  report(state,_carry,actionCount){
    const progress={hp:state.hp,carriedItems:copyItems(state.carriedItems),optionalGemCount:state.collected.length,objectives:{...state.objectives}}
    if(state.status!=='complete'||!state.result)return {status:state.status==='failed'?'FAILED':'PLAYING',progress}
    return {status:'COMPLETE',progress,result:{...state.result,carriedItems:copyItems(state.carriedItems),completion:{tick:state.tick,actionCount}}}
  },
}
export function isStageAction(value:unknown):value is StageAction{
  if(!value||typeof value!=='object')return false
  const a=value as Record<string,unknown>
  return a.type==='TICK'?Object.keys(a).length===1:a.type==='MOVE'&&Object.keys(a).length===2&&typeof a.direction==='string'&&Object.hasOwn(DIRECTION_VECTORS,a.direction)
}
export const ancientMechanismAdapter:StageAdapter<mechanism.StageState,mechanism.StageAction>={
  definition:VAULT_BREAKER_STAGES[1],create:mechanism.initialStageState,reduce:mechanism.reduceStage,isAction:isStageAction,
  report(state,_carry,actionCount){
    const progress={hp:state.hp,carriedItems:copyItems(state.carriedItems),optionalGemCount:state.collected.length,objectives:{...state.objectives}}
    if(state.status!=='complete'||!state.result)return {status:state.status==='failed'?'FAILED':'PLAYING',progress}
    return {status:'COMPLETE',progress,result:{...state.result,carriedItems:copyItems(state.carriedItems),completion:{tick:state.tick,actionCount}}}
  },
}
export const templeApproachAdapter:StageAdapter<StageState,StageAction>={
  definition:VAULT_BREAKER_STAGES[0],create:initialStageState,reduce:reduceStage,isAction:isStageAction,
  report(state,_carry,actionCount){
    const progress={hp:state.hp,carriedItems:copyItems(state.carriedItems),optionalGemCount:state.collected.length,
      objectives:{bronzeKeyCollected:state.bronzeKeyCollected,outerSealUnlocked:state.outerSealUnlocked,mechanismActivated:state.mechanismActivated}}
    if(state.status!=='complete'||!state.result)return {status:state.status==='failed'?'FAILED':'PLAYING',progress}
    return {status:'COMPLETE',progress,result:{...state.result,carriedItems:copyItems(state.carriedItems),completion:{tick:state.tick,actionCount}}}
  },
}
