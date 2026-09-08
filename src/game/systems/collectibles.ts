import type { PlayerRunState } from '../domain/runState'
import type { GridCoord } from '../world/grid'
export interface GemPlacement extends GridCoord { readonly id: string }
export function collectGem(state: PlayerRunState, id: string): PlayerRunState {
  if (state.runStatus !== 'PLAYING' || state.collectedGemIds.includes(id)) return state
  return { ...state, gemsCollected: state.gemsCollected + 1, collectedGemIds: [...state.collectedGemIds, id] }
}
