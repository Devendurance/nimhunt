import { CHEST_HUNTER_STAGES, copyCarry, copyItems, freshCarry, type CarriedItems, type StageCarry, type StageId, type StageProgress, type StageResult } from './contracts'

export type ExpeditionStatus = 'PLAYING' | 'TRANSITION' | 'COMPLETE' | 'FAILED'
type EventPayload =
  | { type: 'EXPEDITION_STARTED'; carry: StageCarry }
  | { type: 'STAGE_STARTED'; stageId: StageId; carry: StageCarry }
  | { type: 'STAGE_COMPLETED'; result: StageResult }
  | { type: 'STAGE_TRANSITION_READY'; fromStage: StageId; nextStage: StageId }
  | { type: 'STAGE_ADVANCED'; fromStage: StageId; toStage: StageId; carry: StageCarry }
  | { type: 'EXPEDITION_FAILED'; stageId: StageId; carry: StageCarry }
  | { type: 'EXPEDITION_COMPLETED'; hp: number; expeditionChestsOpened: number; expeditionGems: number }
export type ExpeditionEvent = EventPayload & { readonly seq: number }
export interface ChestHunterState {
  readonly version: 1; readonly mission: 'chest-hunter'; readonly status: ExpeditionStatus
  readonly currentStage: StageId; readonly currentStageIndex: number
  readonly hp: number; readonly expeditionChestsOpened: number; readonly expeditionGems: number; readonly stageChestsOpened: number; readonly carriedItems: CarriedItems
  readonly stageCarryIn: StageCarry; readonly completedStages: readonly StageId[]; readonly stageResults: readonly StageResult[]
  readonly events: readonly ExpeditionEvent[]
}
export type ExpeditionAction =
  | { type: 'STAGE_PROGRESS'; stageId: StageId; progress: StageProgress }
  | { type: 'STAGE_COMPLETED'; result: StageResult }
  | { type: 'STAGE_FAILED'; stageId: StageId; progress: StageProgress }
  | { type: 'CONTINUE' }
export const expeditionCarry = (state: ChestHunterState): StageCarry => copyCarry(state)
export function initialChestHunterState(): ChestHunterState {
  const carry = freshCarry(), stageId = CHEST_HUNTER_STAGES[0].id
  return { version: 1, mission: 'chest-hunter', status: 'PLAYING', currentStage: stageId, currentStageIndex: 0,
    ...carry, stageChestsOpened: 0, stageCarryIn: copyCarry(carry), completedStages: [], stageResults: [],
    events: [{ seq: 1, type: 'EXPEDITION_STARTED', carry: copyCarry(carry) }, { seq: 2, type: 'STAGE_STARTED', stageId, carry: copyCarry(carry) }] }
}
function checkProgress(state: ChestHunterState, progress: StageProgress): StageProgress {
  const carry = copyCarry(progress)
  const definition = CHEST_HUNTER_STAGES[state.currentStageIndex]
  if (!Number.isSafeInteger(progress.stageChestsOpened) || progress.stageChestsOpened < state.stageChestsOpened
    || (definition.available !== null && progress.stageChestsOpened > definition.available)
    || carry.expeditionChestsOpened !== state.stageCarryIn.expeditionChestsOpened + progress.stageChestsOpened
    || carry.expeditionGems < state.expeditionGems || carry.expeditionGems > state.stageCarryIn.expeditionGems + progress.stageChestsOpened * 2) throw new Error('Invalid cumulative Chest Hunter progress')
  const previous = state.carriedItems, items = carry.carriedItems
  if ((previous.sword && !items.sword) || (previous.potion.owned && !items.potion.owned) || (previous.potion.consumed && !items.potion.consumed)) throw new Error('Carried items cannot be restored or discarded')
  return { ...carry, stageChestsOpened: progress.stageChestsOpened }
}
export function reduceExpedition(state: ChestHunterState, action: ExpeditionAction): ChestHunterState {
  if (state.status === 'FAILED' || state.status === 'COMPLETE') return state
  const emit = (payloads: EventPayload[]) => [...state.events, ...payloads.map((e, i) => ({ ...e, seq: state.events.length + i + 1 }))]
  if (action.type === 'CONTINUE') {
    if (state.status !== 'TRANSITION') return state
    const next = CHEST_HUNTER_STAGES[state.currentStageIndex + 1]
    if (!next) return state
    const carry = expeditionCarry(state)
    return { ...state, status: 'PLAYING', currentStage: next.id, currentStageIndex: state.currentStageIndex + 1,
      stageChestsOpened: 0, stageCarryIn: copyCarry(carry),
      events: emit([{ type: 'STAGE_ADVANCED', fromStage: state.currentStage, toStage: next.id, carry: copyCarry(carry) }, { type: 'STAGE_STARTED', stageId: next.id, carry: copyCarry(carry) }]) }
  }
  if (state.status !== 'PLAYING') return state
  if (action.type === 'STAGE_COMPLETED') {
    const input = action.result
    if (input.stageId !== state.currentStage || state.completedStages.includes(input.stageId)) return state
    const progress = checkProgress(state, { hp: input.hpRemaining, expeditionChestsOpened: input.expeditionChestsOpened, expeditionGems: input.expeditionGems, stageChestsOpened: input.stageChestsOpened, carriedItems: input.carriedItems })
    const required = CHEST_HUNTER_STAGES[state.currentStageIndex].required
    if ((required !== null && progress.stageChestsOpened < required) || input.openedChestIds.length !== progress.stageChestsOpened || new Set(input.openedChestIds).size !== input.openedChestIds.length || input.openedChestIds.some(id => typeof id !== 'string' || !id)) throw new Error('Invalid stage completion treasure')
    if (input.stageId === 'royal-treasury' && !input.openedChestIds.includes('royal-cache')) throw new Error('Royal Cache is mandatory')
    if (progress.hp === 0) return reduceExpedition(state, { type: 'STAGE_FAILED', stageId: input.stageId, progress })
    if (!Number.isSafeInteger(input.completion.tick) || input.completion.tick < 0 || !Number.isSafeInteger(input.completion.actionCount) || input.completion.actionCount < 0) throw new Error('Invalid completion counters')
    const result: StageResult = { stageId: input.stageId, stageChestsOpened: progress.stageChestsOpened, expeditionChestsOpened: progress.expeditionChestsOpened, expeditionGems: progress.expeditionGems, openedChestIds: [...input.openedChestIds], hpRemaining: progress.hp, carriedItems: copyItems(progress.carriedItems), completion: { tick: input.completion.tick, actionCount: input.completion.actionCount } }
    const next = CHEST_HUNTER_STAGES[state.currentStageIndex + 1]
    return { ...state, ...progress, status: next ? 'TRANSITION' : 'COMPLETE',
      completedStages: [...state.completedStages, input.stageId], stageResults: [...state.stageResults, result],
      events: emit([{ type: 'STAGE_COMPLETED', result }, next ? { type: 'STAGE_TRANSITION_READY', fromStage: state.currentStage, nextStage: next.id } : { type: 'EXPEDITION_COMPLETED', hp: progress.hp, expeditionChestsOpened: progress.expeditionChestsOpened, expeditionGems: progress.expeditionGems }]) }
  }
  if (action.stageId !== state.currentStage) return state
  const progress = checkProgress(state, action.progress)
  if (action.type === 'STAGE_FAILED' && progress.hp !== 0) throw new Error('Failed stage must have zero HP')
  const failed = progress.hp === 0
  return { ...state, ...progress, status: failed ? 'FAILED' : 'PLAYING', events: failed ? emit([{ type: 'EXPEDITION_FAILED', stageId: state.currentStage, carry: copyCarry(progress) }]) : state.events }
}
export function replayLifecycle(actions: readonly ExpeditionAction[]): ChestHunterState { return actions.reduce(reduceExpedition, initialChestHunterState()) }
