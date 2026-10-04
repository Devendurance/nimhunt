import type { ExpeditionBlueprint, ReplayAction, ReplayState } from '../replay/types.js'
import { advanceV2, initialV2, isV2Action, localView, type V2State } from './model.js'
import { validV2Blueprint } from './blueprint.js'

function snapshot(blueprint: ExpeditionBlueprint, v2: V2State): ReplayState {
  const e = v2.expedition, local = localView(v2), complete = e.status === 'COMPLETE', failed = e.status === 'FAILED'
  return {
    seq: v2.seq, mission: blueprint.mission, rulesVersion: blueprint.rulesVersion, roomVersion: blueprint.roomVersion,
    blueprintVersion: blueprint.blueprintVersion, blueprintId: blueprint.blueprintId, blueprintHash: blueprint.blueprintHash, blueprint,
    angkorV2: v2, player: { ...local.player },
    run: { hp: e.hp, gemsCollected: e.mission === 'vault-breaker' ? e.stageResults.reduce((n, r) => n + r.optionalGemCount, 0) + (e.status === 'PLAYING' ? e.optionalGemCount : 0) : e.expeditionGems,
      chestsOpened: e.mission === 'chest-hunter' ? e.expeditionChestsOpened : 0, collectedGemIds: [], openedChestIds: [],
      missionStatus: complete ? 'COMPLETE' : failed ? 'FAILED' : 'IN_PROGRESS', runStatus: complete ? 'MISSION_COMPLETE' : failed ? 'FAILED' : 'PLAYING' },
    items: { hasSword: e.carriedItems.sword, swordPickedUp: e.carriedItems.sword, potionConsumed: e.carriedItems.potion.consumed },
    puzzle: { hasTempleKey: false, gateState: complete ? 'OPEN' : 'LOCKED', boulderPositions: [], objectiveReached: complete }, chests: [], goblins: [],
  }
}
export function initialV2Replay(blueprint: ExpeditionBlueprint): ReplayState {
  if (!validV2Blueprint(blueprint)) throw new Error('INVALID_V2_BLUEPRINT')
  return snapshot(blueprint, initialV2(blueprint.mission))
}
export function advanceV2Replay(state: ReplayState, action: ReplayAction) {
  if (!state.angkorV2 || !isV2Action(action)) return { accepted: false, state, reason: 'INVALID_ACTION' }
  try { return { accepted: true, state: snapshot(state.blueprint, advanceV2(state.angkorV2, action)) } }
  catch (error) { return { accepted: false, state, reason: error instanceof Error ? error.message : 'INVALID_ACTION' } }
}
