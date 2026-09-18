import { createPuzzleState, type PuzzleState } from '../systems/puzzle'
import type { Direction } from '../world/grid'
import { createRunState, type MissionStatus, type RunStatus } from '../domain/runState'
import { CHEST_HUNTER_TARGET, GEM_RUNNER_TARGET, parseMissionParam, type MissionType } from '../domain/mission'
import { ANGKOR_ROOM_01, ROOM_01_PUZZLE } from '../world/room01'
import type { GoblinAIState } from '../systems/goblin'
import type { ReplayState } from '../replay/types.js'

export interface PlayerHUDState {
  readonly hasTempleKey: boolean
  readonly hasSword: boolean
  readonly goblinState: GoblinAIState
  readonly gateState: PuzzleState['gateState']
  readonly objectiveReached: boolean
  readonly notice: string
  readonly hp: number
  readonly gemsCollected: number
  readonly gemTarget: number
  readonly chestsOpened: number
  readonly chestTarget: number
  readonly selectedMission: MissionType
  readonly missionStatus: MissionStatus
  readonly runStatus: RunStatus
  readonly gridX: number
  readonly gridY: number
  readonly facing: Direction
  readonly isMoving: boolean
  readonly stepCount: number
  readonly roomName: string
}

export function createInitialHUDState(mission: MissionType = 'gem-runner'): PlayerHUDState {
  const { hp, gemsCollected, chestsOpened, missionStatus, runStatus } = createRunState()
  const { hasTempleKey, gateState, objectiveReached } = createPuzzleState(ROOM_01_PUZZLE)
  return { hasTempleKey, hasSword: false, goblinState: 'PATROL', gateState, objectiveReached, notice: '', hp, gemsCollected, missionStatus, runStatus, gemTarget: GEM_RUNNER_TARGET, chestsOpened, chestTarget: CHEST_HUNTER_TARGET, selectedMission: mission, gridX: ANGKOR_ROOM_01.playerStart.x, gridY: ANGKOR_ROOM_01.playerStart.y, facing: 'DOWN', isMoving: false, stepCount: 0, roomName: ANGKOR_ROOM_01.name }
}

export function createInitialHUDStateFromReplay(state: ReplayState): PlayerHUDState {
  const initial = createInitialHUDState(state.mission)
  const goblin = state.goblins[0]
  return {
    ...initial,
    hasTempleKey: state.puzzle.hasTempleKey,
    gateState: state.puzzle.gateState,
    objectiveReached: state.puzzle.objectiveReached,
    hasSword: state.items.hasSword,
    goblinState: goblin?.state ?? 'PATROL',
    hp: state.run.hp,
    gemsCollected: state.run.gemsCollected,
    gemTarget: state.blueprint.missionParameters.gemTarget,
    chestsOpened: state.run.chestsOpened,
    chestTarget: state.blueprint.missionParameters.chestTarget,
    selectedMission: state.mission,
    missionStatus: state.run.missionStatus,
    runStatus: state.run.runStatus,
    gridX: state.player.x,
    gridY: state.player.y,
    stepCount: state.seq,
  }
}

export function createInitialHUDStateFromSearch(search: string): PlayerHUDState {
  const params = new URLSearchParams(search.startsWith('?') ? search : `?${search}`)
  return createInitialHUDState(parseMissionParam(params.get('mission')))
}

export interface NimHuntBridgeListener {
  (state: PlayerHUDState): void
}

export interface NimHuntGameBridge {
  move: (direction: Direction) => void
  reset: () => void
  getState: () => PlayerHUDState
  subscribe: (listener: NimHuntBridgeListener) => () => void
  emitState: (state: PlayerHUDState) => void
  destroy: () => void
}

export function createGameBridge(initialState: PlayerHUDState): NimHuntGameBridge {
  const listeners = new Set<NimHuntBridgeListener>()
  let currentState: PlayerHUDState = { ...initialState }
  let moveHandler: ((direction: Direction) => void) | null = null
  let resetHandler: (() => void) | null = null

  return {
    move: (direction: Direction) => {
      moveHandler?.(direction)
    },
    reset: () => {
      resetHandler?.()
    },
    getState: () => currentState,
    subscribe: (listener: NimHuntBridgeListener) => {
      listeners.add(listener)
      listener(currentState)
      return () => {
        listeners.delete(listener)
      }
    },
    emitState: (state: PlayerHUDState) => {
      currentState = { ...state }
      for (const listener of listeners) {
        listener(currentState)
      }
    },
    destroy: () => {
      listeners.clear()
      moveHandler = null
      resetHandler = null
    },
  }
}
