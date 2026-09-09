export type MissionStatus = 'IN_PROGRESS' | 'COMPLETE' | 'FAILED'
export type RunStatus = 'PLAYING' | 'MISSION_COMPLETE' | 'FAILED'
export interface PlayerRunState {
  readonly hp: number
  readonly gemsCollected: number
  readonly collectedGemIds: readonly string[]
  readonly chestsOpened: number
  readonly openedChestIds: readonly string[]
  readonly missionStatus: MissionStatus
  readonly runStatus: RunStatus
}
export const MAX_HP = 100
export const clampHP = (hp: number): number => Math.max(0, Math.min(MAX_HP, hp))
export function createRunState(): PlayerRunState {
  return { hp: MAX_HP, gemsCollected: 0, collectedGemIds: [], chestsOpened: 0, openedChestIds: [], missionStatus: 'IN_PROGRESS', runStatus: 'PLAYING' }
}
