import { CHEST_HUNTER_TARGET, GEM_RUNNER_TARGET, parseMissionParam, type MissionType } from '../../game/domain/mission'
import type { PlayerHUDState } from '../../game/events/gameEvents'
import type { Mission, MissionId } from '../../types/play'

export type PlayableMission = 'gem-runner' | 'chest-hunter' | 'vault-breaker'

export function parseRunParam(value: string | null | undefined): PlayableMission | null {
  if (value === 'gem-runner' || value === 'chest-hunter' || value === 'vault-breaker') return value
  return null
}

export function isMissionLaunchable(id: MissionId): id is PlayableMission {
  return id === 'gem-runner' || id === 'chest-hunter' || id === 'vault-breaker'
}

export type PlayRoute =
  | { readonly view: 'nimiq' }
  | { readonly view: 'dev-game'; readonly mission: MissionType }
  | { readonly view: 'product-expedition'; readonly mission: PlayableMission; readonly runId: string }
  | { readonly view: 'invalid-product'; readonly reason: 'RUN_ID_REQUIRED' }
  | { readonly view: 'practice'; readonly mission: PlayableMission }
  | { readonly view: 'shell' }

export function resolvePlayRoute(query: { dev: string | null; run: string | null; runId: string | null; practice: string | null; mission: string | null }): PlayRoute {
  if (query.dev === 'nimiq') return { view: 'nimiq' }
  if (query.dev === 'game') return { view: 'dev-game', mission: parseMissionParam(query.mission) }
  const run = parseRunParam(query.run)
  if (run) {
    if (!isBoundedRunId(query.runId)) return { view: 'invalid-product', reason: 'RUN_ID_REQUIRED' }
    return { view: 'product-expedition', mission: run, runId: query.runId }
  }
  const practice = parseRunParam(query.practice)
  if (practice) return { view: 'practice', mission: practice }
  return { view: 'shell' }
}

export interface BriefState {
  readonly canStart: boolean
  readonly badge: 'AVAILABLE' | 'COMING NEXT'
}

export function getBriefState(missionId: MissionId): BriefState {
  if (isMissionLaunchable(missionId)) return { canStart: true, badge: 'AVAILABLE' }
  return { canStart: false, badge: 'COMING NEXT' }
}

export function getMissionBoardCountLabel(missions: readonly Pick<Mission, 'status'>[]): string {
  const count = missions.filter(mission => mission.status === 'available').length
  return `${count} MISSIONS`
}

export type ExpeditionResult =
  | { readonly status: 'playing' }
  | { readonly status: 'complete'; readonly title: string; readonly detail: string }
  | { readonly status: 'failed'; readonly title: string; readonly detail: string }

type HudProgress = Pick<
  PlayerHUDState,
  'runStatus' | 'selectedMission' | 'gemsCollected' | 'gemTarget' | 'chestsOpened' | 'chestTarget' | 'hasTempleKey' | 'objectiveReached'
>

export function getExpeditionResult(hud: HudProgress): ExpeditionResult {
  if (hud.runStatus === 'MISSION_COMPLETE') {
    if (hud.selectedMission === 'chest-hunter') {
      return { status: 'complete', title: 'Chest Hunter', detail: `${hud.chestsOpened} / ${hud.chestTarget} chests opened` }
    }
    if (hud.selectedMission === 'vault-breaker') {
      return { status: 'complete', title: 'Vault Breaker', detail: 'Temple Vault reached' }
    }
    return { status: 'complete', title: 'Gem Runner', detail: `${hud.gemsCollected} / ${hud.gemTarget} gems collected` }
  }
  if (hud.runStatus === 'FAILED') {
    if (hud.selectedMission === 'chest-hunter') {
      return { status: 'failed', title: 'The ruins won this round.', detail: `${hud.chestsOpened} / ${hud.chestTarget} chests` }
    }
    if (hud.selectedMission === 'vault-breaker') {
      if (hud.objectiveReached) {
        return { status: 'failed', title: 'The ruins won this round.', detail: 'Temple Vault reached' }
      }
      return { status: 'failed', title: 'The ruins won this round.', detail: hud.hasTempleKey ? 'Temple Key found' : 'Temple Key not found' }
    }
    return { status: 'failed', title: 'The ruins won this round.', detail: `${hud.gemsCollected} / ${hud.gemTarget} gems` }
  }
  return { status: 'playing' }
}

export const GEM_RUNNER_PLAY_TARGET = GEM_RUNNER_TARGET
export const CHEST_HUNTER_PLAY_TARGET = CHEST_HUNTER_TARGET

export interface HudMode {
  readonly showDebug: boolean
  readonly showResetAction: boolean
}

export const PRODUCT_HUD_MODE: HudMode = { showDebug: false, showResetAction: false }
export const DEV_HUD_MODE: HudMode = { showDebug: true, showResetAction: true }

/** Strip the run param so Back/Leave navigation unmounts (and destroys) the Phaser instance. */
export function clearRunFromSearch(search: string): string {
  const params = new URLSearchParams(search.startsWith('?') ? search : search ? `?${search}` : '')
  params.delete('run')
  params.delete('runId')
  const rest = params.toString()
  return rest ? `?${rest}` : ''
}

function isBoundedRunId(value: string | null): value is string {
  return value !== null && value.length > 0 && value.length <= 128
}
