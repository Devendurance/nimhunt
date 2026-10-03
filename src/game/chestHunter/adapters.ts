import { DIRECTION_VECTORS } from '../world/grid'
import { CHEST_HUNTER_STAGES, copyItems, type StageAdapter } from './contracts'
import { initialStageState as initialI, reduceStage as reduceI, type StageState as StateI, type StageAction as ActionI } from './stage1/model'
import { initialStageState as initialII, reduceStage as reduceII, type StageState as StateII, type StageAction as ActionII } from './stage2/model'
import { initialStageState as initialIII, reduceStage as reduceIII, type StageState as StateIII, type StageAction as ActionIII } from './stage3/model'
export type ChestStageAction = Exclude<ActionI | ActionII | ActionIII, { type: 'RESET' }>
export function isStageAction(value: unknown): value is ChestStageAction {
  if (!value || typeof value !== 'object') return false
  const a = value as Record<string, unknown>
  return a.type === 'TICK' ? Object.keys(a).length === 1 : a.type === 'MOVE' && Object.keys(a).length === 2 && typeof a.direction === 'string' && Object.hasOwn(DIRECTION_VECTORS, a.direction)
}
function report(state: StateI | StateII | StateIII, _carry: unknown, actionCount: number) {
  const progress = { hp: state.hp, expeditionChestsOpened: state.expeditionChestsOpened, expeditionGems: state.expeditionGems, stageChestsOpened: state.stageChestsOpened, carriedItems: copyItems(state.carriedItems) }
  if (state.status !== 'complete' || !state.result) return { status: state.status === 'failed' ? 'FAILED' as const : 'PLAYING' as const, progress }
  return { status: 'COMPLETE' as const, progress, result: { ...state.result, carriedItems: copyItems(state.carriedItems), openedChestIds: [...state.result.openedChestIds], completion: { tick: state.tick, actionCount } } }
}
export const lostCourtyardAdapter: StageAdapter<StateI, ChestStageAction> = { definition: CHEST_HUNTER_STAGES[0], create: initialI, reduce: reduceI, isAction: isStageAction, report }
export const forgottenGalleriesAdapter: StageAdapter<StateII, ChestStageAction> = { definition: CHEST_HUNTER_STAGES[1], create: initialII, reduce: reduceII, isAction: isStageAction, report }

export const royalTreasuryAdapter: StageAdapter<StateIII, ChestStageAction> = { definition: CHEST_HUNTER_STAGES[2], create: initialIII, reduce: reduceIII, isAction: isStageAction, report }
