import { GEM_RUNNER_STAGES, copyCarry, copyItems, freshCarry, type CarriedItems, type StageCarry, type StageId, type StageProgress, type StageResult } from './contracts.js'

export type ExpeditionStatus = 'PLAYING' | 'TRANSITION' | 'COMPLETE' | 'FAILED'
type EventPayload =
  | { type: 'EXPEDITION_STARTED'; carry: StageCarry }
  | { type: 'STAGE_STARTED'; stageId: StageId; carry: StageCarry }
  | { type: 'STAGE_COMPLETED'; result: StageResult }
  | { type: 'STAGE_TRANSITION_READY'; fromStage: StageId; nextStage: StageId }
  | { type: 'STAGE_ADVANCED'; fromStage: StageId; toStage: StageId; carry: StageCarry }
  | { type: 'EXPEDITION_FAILED'; stageId: StageId; carry: StageCarry }
  | { type: 'EXPEDITION_COMPLETED'; hp: number; expeditionGems: number }
export type ExpeditionEvent = EventPayload & { readonly seq: number }
export interface GemRunnerState {
  readonly version: 1; readonly mission: 'gem-runner'; readonly status: ExpeditionStatus
  readonly currentStage: StageId; readonly currentStageIndex: number
  readonly hp: number; readonly expeditionGems: number; readonly stageGems: number; readonly carriedItems: CarriedItems
  readonly stageCarryIn: StageCarry; readonly completedStages: readonly StageId[]; readonly stageResults: readonly StageResult[]
  readonly events: readonly ExpeditionEvent[]
}
export type ExpeditionAction =
  | { type: 'STAGE_PROGRESS'; stageId: StageId; progress: StageProgress }
  | { type: 'STAGE_COMPLETED'; result: StageResult }
  | { type: 'STAGE_FAILED'; stageId: StageId; progress: StageProgress }
  | { type: 'CONTINUE' }
export const expeditionCarry = (state: GemRunnerState): StageCarry => copyCarry(state)
export function initialGemRunnerState(): GemRunnerState {
  const carry = freshCarry(), stageId = GEM_RUNNER_STAGES[0].id
  return { version: 1, mission: 'gem-runner', status: 'PLAYING', currentStage: stageId, currentStageIndex: 0,
    ...carry, stageGems: 0, stageCarryIn: copyCarry(carry), completedStages: [], stageResults: [],
    events: [{ seq: 1, type: 'EXPEDITION_STARTED', carry: copyCarry(carry) }, { seq: 2, type: 'STAGE_STARTED', stageId, carry: copyCarry(carry) }] }
}
function checkProgress(state: GemRunnerState, progress: StageProgress): StageProgress {
  const carry = copyCarry(progress)
  if (!Number.isSafeInteger(progress.stageGems) || progress.stageGems < state.stageGems || carry.expeditionGems !== state.stageCarryIn.expeditionGems + progress.stageGems) throw new Error('Invalid cumulative stage Gems')
  const previous = state.carriedItems, items = carry.carriedItems
  if ((previous.sword && !items.sword) || (previous.potion.owned && !items.potion.owned) || (previous.potion.consumed && !items.potion.consumed)) throw new Error('Carried items cannot be restored or discarded')
  return { ...carry, stageGems: progress.stageGems }
}
export function reduceExpedition(state: GemRunnerState, action: ExpeditionAction): GemRunnerState {
  if (state.status === 'FAILED' || state.status === 'COMPLETE') return state
  const emit = (payloads: EventPayload[]) => [...state.events, ...payloads.map((e, i) => ({ ...e, seq: state.events.length + i + 1 }))]
  if (action.type === 'CONTINUE') {
    if (state.status !== 'TRANSITION') return state
    const next = GEM_RUNNER_STAGES[state.currentStageIndex + 1]
    if (!next) return state
    const carry = expeditionCarry(state)
    return { ...state, status: 'PLAYING', currentStage: next.id, currentStageIndex: state.currentStageIndex + 1,
      stageGems: 0, stageCarryIn: copyCarry(carry),
      events: emit([{ type: 'STAGE_ADVANCED', fromStage: state.currentStage, toStage: next.id, carry: copyCarry(carry) }, { type: 'STAGE_STARTED', stageId: next.id, carry: copyCarry(carry) }]) }
  }
  if (state.status !== 'PLAYING') return state
  if (action.type === 'STAGE_COMPLETED') {
    const input = action.result
    if (input.stageId !== state.currentStage || state.completedStages.includes(input.stageId)) return state
    const progress = checkProgress(state, { hp: input.hpRemaining, expeditionGems: input.expeditionGems, stageGems: input.stageGems, carriedItems: input.carriedItems })
    if (progress.hp === 0) return reduceExpedition(state, { type: 'STAGE_FAILED', stageId: input.stageId, progress })
    if (!Number.isSafeInteger(input.completion.tick) || input.completion.tick < 0 || !Number.isSafeInteger(input.completion.actionCount) || input.completion.actionCount < 0) throw new Error('Invalid completion counters')
    const result: StageResult = { stageId: input.stageId, stageGems: progress.stageGems, expeditionGems: progress.expeditionGems, hpRemaining: progress.hp, carriedItems: copyItems(progress.carriedItems), completion: { tick: input.completion.tick, actionCount: input.completion.actionCount } }
    const next = GEM_RUNNER_STAGES[state.currentStageIndex + 1]
    return { ...state, ...progress, status: next ? 'TRANSITION' : 'COMPLETE',
      completedStages: [...state.completedStages, input.stageId], stageResults: [...state.stageResults, result],
      events: emit([{ type: 'STAGE_COMPLETED', result }, next ? { type: 'STAGE_TRANSITION_READY', fromStage: state.currentStage, nextStage: next.id } : { type: 'EXPEDITION_COMPLETED', hp: progress.hp, expeditionGems: progress.expeditionGems }]) }
  }
  if (action.stageId !== state.currentStage) return state
  const progress = checkProgress(state, action.progress)
  if (action.type === 'STAGE_FAILED' && progress.hp !== 0) throw new Error('Failed stage must have zero HP')
  const failed = progress.hp === 0
  return { ...state, ...progress, status: failed ? 'FAILED' : 'PLAYING', events: failed ? emit([{ type: 'EXPEDITION_FAILED', stageId: state.currentStage, carry: copyCarry(progress) }]) : state.events }
}
export function replayLifecycle(actions: readonly ExpeditionAction[]): GemRunnerState { return actions.reduce(reduceExpedition, initialGemRunnerState()) }
