import { evaluateMission, type MissionType } from '../domain/mission.js'
import type { PlayerRunState } from '../domain/runState.js'
import { collectGem, type GemPlacement } from './collectibles.js'
import { applyHazard, type HazardPlacement } from './hazards.js'
import type { MoveResult } from './movement.js'
export interface RoomContents { readonly gems: readonly GemPlacement[]; readonly hazards: readonly HazardPlacement[] }
/** Called once on completed, successful movement, never from frame updates. */
export function resolveTileEntry(state: PlayerRunState, move: MoveResult, contents: RoomContents, mission: MissionType = 'gem-runner'): PlayerRunState {
  if (state.runStatus !== 'PLAYING' || !move.success || (move.from.x === move.to.x && move.from.y === move.to.y)) return state
  const atDestination = (item: { x: number; y: number }) => item.x === move.to.x && item.y === move.to.y
  const hazard = contents.hazards.find(atDestination)
  const gem = contents.gems.find(atDestination)
  let next = hazard ? applyHazard(state, hazard.type) : state
  if (gem) next = collectGem(next, gem.id)
  return evaluateMission(next, mission)
}
