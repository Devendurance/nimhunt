import { clampHP, type PlayerRunState } from './runState.js'
export const GEM_RUNNER_TARGET = 6
export const CHEST_HUNTER_TARGET = 4
export type MissionType = 'gem-runner' | 'chest-hunter' | 'vault-breaker'
export function parseMissionParam(value: string | null | undefined): MissionType {
  if (value === 'chest-hunter') return 'chest-hunter'
  if (value === 'vault-breaker') return 'vault-breaker'
  return 'gem-runner'
}
export function getMissionTitle(mission: MissionType): string {
  if (mission === 'chest-hunter') return 'CHEST HUNTER'
  if (mission === 'vault-breaker') return 'VAULT BREAKER'
  return 'GEM RUNNER'
}
export function getMissionObjective(mission: MissionType): string {
  if (mission === 'chest-hunter') return 'Open 4 chests and survive.'
  if (mission === 'vault-breaker') return 'Find the key. Unlock the gate. Reach the vault.'
  return 'Collect 6 gems and survive.'
}
export function evaluateMission(state: PlayerRunState, mission: MissionType = 'gem-runner'): PlayerRunState {
  const hp = clampHP(state.hp)
  if (hp === 0) return { ...state, hp, missionStatus: 'FAILED', runStatus: 'FAILED' }
  if (state.runStatus !== 'PLAYING') return state
  if (mission === 'chest-hunter') {
    const opened = state.chestsOpened ?? 0
    if (opened >= CHEST_HUNTER_TARGET) return { ...state, hp, missionStatus: 'COMPLETE', runStatus: 'MISSION_COMPLETE' }
    return { ...state, hp }
  }
  if (mission === 'vault-breaker') {
    // Two-stage mission: reaching the Vault never completes the run by itself.
    // Completion requires a verified Nimiq treasure seal (React layer).
    return { ...state, hp }
  }
  if (state.gemsCollected >= GEM_RUNNER_TARGET) return { ...state, hp, missionStatus: 'COMPLETE', runStatus: 'MISSION_COMPLETE' }
  return { ...state, hp }
}
