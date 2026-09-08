import { clampHP, type PlayerRunState } from './runState'
export const GEM_RUNNER_TARGET = 6
export function evaluateMission(state: PlayerRunState): PlayerRunState {
  const hp = clampHP(state.hp)
  if (hp === 0) return { ...state, hp, missionStatus: 'FAILED', runStatus: 'FAILED' }
  if (state.runStatus !== 'PLAYING') return state
  if (state.gemsCollected >= GEM_RUNNER_TARGET) return { ...state, hp, missionStatus: 'COMPLETE', runStatus: 'MISSION_COMPLETE' }
  return { ...state, hp }
}
