import Phaser from 'phaser'
import { createGameConfig } from './config/createGameConfig'
import {
  createGameBridge,
  createInitialHUDState,
  createInitialHUDStateFromReplay,
  type NimHuntBridgeListener,
  type PlayerHUDState,
} from './events/gameEvents'
import type { ExpeditionBlueprint, MissionType, ReplayState } from './replay/types.ts'
import type { ProductProofBridge } from './productProof.ts'
import type { Direction } from './world/grid'

export type { ProductProofBridge }

export interface NimHuntGameInstance {
  game: Phaser.Game
  move: (direction: Direction) => void
  reset: () => void
  getState: () => PlayerHUDState
  subscribe: (listener: NimHuntBridgeListener) => () => void
  destroy: () => void
}

export type CreateGameOptions =
  | { readonly mode: 'dev'; readonly mission: MissionType; readonly blueprint?: ExpeditionBlueprint }
  | {
    readonly mode: 'product'
    readonly mission: MissionType
    readonly blueprint: ExpeditionBlueprint
    readonly initialState: ReplayState
    readonly proof?: ProductProofBridge
  }

/**
 * Creates and initializes the NimHunt Phaser Game instance.
 * Encapsulates the React-to-Phaser bridge and handles clean teardown.
 */
export function createNimHuntGame(container: HTMLElement, options: CreateGameOptions): NimHuntGameInstance {
  // 1. Ensure container is empty before attaching Phaser canvas (prevents StrictMode duplicates)
  container.replaceChildren()

  const initialHUDState = options.mode === 'product'
    ? createInitialHUDStateFromReplay(options.initialState)
    : options.blueprint
      ? {
        ...createInitialHUDState(options.mission),
        gemTarget: options.blueprint.missionParameters.gemTarget,
        chestTarget: options.blueprint.missionParameters.chestTarget,
        gridX: options.blueprint.spawn.x,
        gridY: options.blueprint.spawn.y,
      }
      : createInitialHUDState(options.mission)

  const bridge = createGameBridge(initialHUDState)
  const config = createGameConfig(container, bridge, options)
  const game = new Phaser.Game(config)
  game.registry.set('bridge', bridge)

  const move = (direction: Direction) => {
    game.events.emit('cmd_move', direction)
  }

  const reset = () => {
    game.events.emit('cmd_reset')
  }

  const destroy = () => {
    bridge.destroy()
    try {
      // true removes the canvas from DOM and cleans up all scenes and renderers
      // false for noReturn allows safe re-instantiation on future mounts
      game.destroy(true, false)
    } catch {
      // Ignore teardown errors if RAF queue was already purged
    }
    container.replaceChildren()
  }

  return {
    game,
    move,
    reset,
    getState: bridge.getState,
    subscribe: bridge.subscribe,
    destroy,
  }
}
