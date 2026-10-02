import { DIRECTION_VECTORS } from '../world/grid'
import { initialStageState, reduceStage, type StageAction, type StageState } from '../stage1/model'
import { GEM_RUNNER_STAGES, copyItems, type StageAdapter } from './contracts'

export type OuterRuinsAction = Exclude<StageAction, { type: 'RESET' }>
export const outerRuinsAdapter: StageAdapter<StageState, OuterRuinsAction> = {
  definition: GEM_RUNNER_STAGES[0], create: carry => initialStageState(carry), reduce: reduceStage,
  isAction(value): value is OuterRuinsAction {
    if (!value || typeof value !== 'object') return false
    const action = value as Record<string, unknown>
    return action.type === 'TICK' ? Object.keys(action).length === 1 : action.type === 'MOVE' && Object.keys(action).length === 2 && typeof action.direction === 'string' && Object.hasOwn(DIRECTION_VECTORS, action.direction)
  },
  report(state, carryIn, actionCount) {
    const progress = { hp: state.hp, expeditionGems: state.expeditionGems, stageGems: state.stageGems, carriedItems: copyItems(carryIn.carriedItems) }
    if (state.status !== 'complete') return { status: state.status === 'failed' ? 'FAILED' : 'PLAYING', progress }
    return { status: 'COMPLETE', progress, result: { stageId: 'outer-ruins', stageGems: state.stageGems, expeditionGems: state.expeditionGems, hpRemaining: state.hp, carriedItems: copyItems(carryIn.carriedItems), completion: { tick: state.tick, actionCount } } }
  },
}
