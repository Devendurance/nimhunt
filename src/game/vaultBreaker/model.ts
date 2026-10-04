import { VAULT_BREAKER_STAGES, copyCarry, copyItems, emptyObjectives, freshCarry, type CarriedItems, type ObjectiveResults, type StageCarry, type StageId, type StageProgress, type StageResult } from './contracts'
export type ExpeditionStatus = 'PLAYING' | 'TRANSITION' | 'COMPLETE' | 'FAILED'
type EventPayload =
  | { type:'EXPEDITION_STARTED';carry:StageCarry }
  | { type:'STAGE_STARTED';stageId:StageId;carry:StageCarry }
  | { type:'STAGE_COMPLETED';result:StageResult }
  | { type:'STAGE_TRANSITION_READY';fromStage:StageId;nextStage:StageId }
  | { type:'STAGE_ADVANCED';fromStage:StageId;toStage:StageId;carry:StageCarry }
  | { type:'EXPEDITION_FAILED';stageId:StageId;carry:StageCarry }
  | { type:'EXPEDITION_COMPLETED';hp:number;carriedItems:CarriedItems }
export type ExpeditionEvent=EventPayload & {readonly seq:number}
export interface VaultBreakerState {
  readonly version:1;readonly mission:'vault-breaker';readonly status:ExpeditionStatus
  readonly currentStage:StageId;readonly currentStageIndex:number;readonly hp:number;readonly carriedItems:CarriedItems
  readonly objectives:ObjectiveResults;readonly optionalGemCount:number;readonly stageCarryIn:StageCarry
  readonly completedStages:readonly StageId[];readonly stageResults:readonly StageResult[];readonly events:readonly ExpeditionEvent[]
}
export type ExpeditionAction=
  | {type:'STAGE_PROGRESS';stageId:StageId;progress:StageProgress}
  | {type:'STAGE_COMPLETED';result:StageResult}
  | {type:'STAGE_FAILED';stageId:StageId;progress:StageProgress}
  | {type:'CONTINUE'}
export const expeditionCarry=(state:VaultBreakerState):StageCarry=>copyCarry(state)
export function initialVaultBreakerState():VaultBreakerState{
  const carry=freshCarry(),stageId=VAULT_BREAKER_STAGES[0].id
  return {version:1,mission:'vault-breaker',status:'PLAYING',currentStage:stageId,currentStageIndex:0,...carry,
    objectives:emptyObjectives(),optionalGemCount:0,stageCarryIn:copyCarry(carry),completedStages:[],stageResults:[],
    events:[{seq:1,type:'EXPEDITION_STARTED',carry:copyCarry(carry)},{seq:2,type:'STAGE_STARTED',stageId,carry:copyCarry(carry)}]}
}
function checkProgress(state:VaultBreakerState,input:StageProgress):StageProgress{
  const carry=copyCarry(input),o=input.objectives,p=state.objectives
  if(!o || Object.keys(emptyObjectives()).some(k=>typeof o[k as keyof ObjectiveResults]!=='boolean')
    || (p.bronzeKeyCollected&&!o.bronzeKeyCollected) || (p.outerSealUnlocked&&!o.outerSealUnlocked) || (p.mechanismActivated&&!o.mechanismActivated)
    || (o.outerSealUnlocked&&!o.bronzeKeyCollected) || (o.mechanismActivated&&!o.outerSealUnlocked)
    || !Number.isSafeInteger(input.optionalGemCount) || input.optionalGemCount<state.optionalGemCount || input.optionalGemCount>3)throw new Error('Invalid ordered Vault Breaker objectives')
  const previous=state.carriedItems,items=carry.carriedItems
  if((previous.sword&&!items.sword)||(previous.potion.owned&&!items.potion.owned)||(previous.potion.consumed&&!items.potion.consumed))throw new Error('Carried items cannot be restored or discarded')
  return {...carry,objectives:{...o},optionalGemCount:input.optionalGemCount}
}
export function reduceExpedition(state:VaultBreakerState,action:ExpeditionAction):VaultBreakerState{
  if(state.status==='FAILED'||state.status==='COMPLETE')return state
  const emit=(payloads:EventPayload[])=>[...state.events,...payloads.map((e,i)=>({...e,seq:state.events.length+i+1}))]
  if(action.type==='CONTINUE'){
    if(state.status!=='TRANSITION')return state
    const next=VAULT_BREAKER_STAGES[state.currentStageIndex+1];if(!next)return state
    const carry=expeditionCarry(state)
    return {...state,status:'PLAYING',currentStage:next.id,currentStageIndex:state.currentStageIndex+1,
      objectives:emptyObjectives(),optionalGemCount:0,stageCarryIn:copyCarry(carry),
      events:emit([{type:'STAGE_ADVANCED',fromStage:state.currentStage,toStage:next.id,carry:copyCarry(carry)},{type:'STAGE_STARTED',stageId:next.id,carry:copyCarry(carry)}])}
  }
  // Contracts can be entered but have no gameplay/completion authority yet.
  if(state.status!=='PLAYING'||!VAULT_BREAKER_STAGES[state.currentStageIndex].implemented)return state
  if(action.type==='STAGE_COMPLETED'){
    const input=action.result
    if(input.stageId!==state.currentStage||state.completedStages.includes(input.stageId))return state
    const progress=checkProgress(state,{hp:input.hpRemaining,carriedItems:input.carriedItems,optionalGemCount:input.optionalGemCount,
      objectives:{bronzeKeyCollected:input.bronzeKeyCollected,outerSealUnlocked:input.outerSealUnlocked,mechanismActivated:input.mechanismActivated}})
    if(!Object.values(progress.objectives).every(Boolean))throw new Error('All access objectives are required')
    if(progress.hp===0)return reduceExpedition(state,{type:'STAGE_FAILED',stageId:input.stageId,progress})
    if(!Number.isSafeInteger(input.completion.tick)||input.completion.tick<0||!Number.isSafeInteger(input.completion.actionCount)||input.completion.actionCount<0)throw new Error('Invalid completion counters')
    const result:StageResult={stageId:input.stageId,...progress.objectives,hpRemaining:progress.hp,carriedItems:copyItems(progress.carriedItems),
      optionalGemCount:progress.optionalGemCount,completion:{...input.completion}}
    const next=VAULT_BREAKER_STAGES[state.currentStageIndex+1]
    return {...state,...progress,status:next?'TRANSITION':'COMPLETE',completedStages:[...state.completedStages,input.stageId],stageResults:[...state.stageResults,result],
      events:emit([{type:'STAGE_COMPLETED',result},next?{type:'STAGE_TRANSITION_READY',fromStage:state.currentStage,nextStage:next.id}:{type:'EXPEDITION_COMPLETED',hp:progress.hp,carriedItems:copyItems(progress.carriedItems)}])}
  }
  if(action.stageId!==state.currentStage)return state
  const progress=checkProgress(state,action.progress)
  if(action.type==='STAGE_FAILED'&&progress.hp!==0)throw new Error('Failed stage must have zero HP')
  const failed=progress.hp===0
  return {...state,...progress,status:failed?'FAILED':'PLAYING',events:failed?emit([{type:'EXPEDITION_FAILED',stageId:state.currentStage,carry:copyCarry(progress)}]):state.events}
}
export const replayLifecycle=(actions:readonly ExpeditionAction[]):VaultBreakerState=>actions.reduce(reduceExpedition,initialVaultBreakerState())
