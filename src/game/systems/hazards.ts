import { clampHP, type PlayerRunState } from '../domain/runState.js'
import type { GridCoord } from '../world/grid.js'
export type HazardType = 'SPIKES' | 'POISON'
export interface HazardPlacement extends GridCoord { readonly type: HazardType }
export const HAZARD_DAMAGE = { SPIKES: 25, POISON: 20 } as const
export function applyHazard(state: PlayerRunState, type: HazardType): PlayerRunState {
  if (state.runStatus !== 'PLAYING') return state
  return { ...state, hp: clampHP(state.hp - HAZARD_DAMAGE[type]) }
}
