import { createPuzzleState, type PuzzleState } from '../systems/puzzle'
import type { Direction } from '../world/grid'
import { createRunState, type MissionStatus, type RunStatus } from '../domain/runState'
import { GEM_RUNNER_TARGET } from '../domain/mission'
import { ANGKOR_ROOM_01, ROOM_01_PUZZLE } from '../world/room01'

export interface PlayerHUDState {
  readonly hasTempleKey: boolean
  readonly gateState: PuzzleState['gateState']
  readonly objectiveReached: boolean
  readonly notice: string
  readonly hp: number
  readonly gemsCollected: number
  readonly gemTarget: number
  readonly missionStatus: MissionStatus
  readonly runStatus: RunStatus
  readonly gridX: number
  readonly gridY: number
  readonly facing: Direction
  readonly isMoving: boolean
  readonly stepCount: number
  readonly roomName: string
}

export function createInitialHUDState(): PlayerHUDState {
  const { hp, gemsCollected, missionStatus, runStatus } = createRunState()
  const { hasTempleKey, gateState, objectiveReached } = createPuzzleState(ROOM_01_PUZZLE)
  return { hasTempleKey, gateState, objectiveReached, notice: '', hp, gemsCollected, missionStatus, runStatus, gemTarget: GEM_RUNNER_TARGET, gridX: ANGKOR_ROOM_01.playerStart.x, gridY: ANGKOR_ROOM_01.playerStart.y, facing: 'DOWN', isMoving: false, stepCount: 0, roomName: ANGKOR_ROOM_01.name }
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
