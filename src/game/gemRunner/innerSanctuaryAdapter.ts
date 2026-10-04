import { DIRECTION_VECTORS } from '../world/grid.js'
import { initialStageState, reduceStage, type StageAction, type StageState } from '../stage3/model.js'
import { GEM_RUNNER_STAGES, copyItems, type StageAdapter } from './contracts.js'

export const innerSanctuaryAdapter: StageAdapter<StageState, StageAction> = {
  definition: GEM_RUNNER_STAGES[2], create: initialStageState, reduce: reduceStage,
  isAction(value): value is StageAction {
    if (!value || typeof value !== 'object') return false
    const action = value as Record<string, unknown>
    return action.type === 'TICK' ? Object.keys(action).length === 1 : action.type === 'MOVE' && Object.keys(action).length === 2 && typeof action.direction === 'string' && Object.hasOwn(DIRECTION_VECTORS, action.direction)
  },
  report(state, carryIn, actionCount) {
    const progress = { hp: state.hp, expeditionGems: state.expeditionGems, stageGems: state.stageGems, carriedItems: copyItems(carryIn.carriedItems) }
    if (state.status !== 'complete') return { status: state.status === 'failed' ? 'FAILED' : 'PLAYING', progress }
    return { status: 'COMPLETE', progress, result: { stageId: 'inner-sanctuary', stageGems: state.stageGems, expeditionGems: state.expeditionGems, hpRemaining: state.hp, carriedItems: copyItems(carryIn.carriedItems), completion: { tick: state.tick, actionCount } } }
  },
}
