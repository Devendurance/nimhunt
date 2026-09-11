import type { ExpeditionBlueprint, ReplayState } from './replay/types.ts'
import type { GridCoord } from './world/grid.ts'
import type { PuzzleObjects, PuzzleState } from './systems/puzzle.ts'
import type { RoomContents } from './systems/tileEntry.ts'
import type { ChestInstance, ChestPlacement } from './systems/chests.ts'
import type { GoblinState } from './systems/goblin.ts'
import type { ItemState } from './systems/items.ts'
import type { PlayerRunState } from './domain/runState.ts'
import type { GoblinSpawnConfig } from './world/room01.ts'

export type ProductBlueprintRuntime = {
  readonly spawn: GridCoord
  readonly contents: RoomContents
  readonly puzzle: PuzzleObjects
  readonly goblin: GoblinSpawnConfig | null
  readonly chests: readonly ChestPlacement[]
  readonly sword: GridCoord | null
  readonly potion: GridCoord | null
  readonly gemTarget: number
  readonly chestTarget: number
}

export type ProductInitialRuntimeState = {
  readonly player: GridCoord
  readonly run: PlayerRunState
  readonly puzzle: PuzzleState
  readonly items: ItemState
  readonly chests: readonly ChestInstance[]
  readonly goblin: GoblinState | null
}

export function mapProductBlueprint(blueprint: ExpeditionBlueprint): ProductBlueprintRuntime {
  return {
    spawn: { ...blueprint.spawn },
    contents: {
      gems: blueprint.gems.map(gem => ({ ...gem })),
      hazards: blueprint.hazards.map(hazard => ({ ...hazard })),
    },
    puzzle: {
      boulders: blueprint.boulders.map(boulder => ({ ...boulder })),
      key: { ...blueprint.key },
      gate: { ...blueprint.gate },
      shrine: { ...blueprint.objective },
    },
    goblin: blueprint.goblins[0]
      ? {
        spawn: { ...blueprint.goblins[0].spawn },
        patrolRoute: blueprint.goblins[0].patrolRoute.map(coord => ({ ...coord })),
      }
      : null,
    chests: blueprint.chests.map(chest => ({ ...chest })),
    sword: blueprint.sword ? { ...blueprint.sword } : null,
    potion: blueprint.potion ? { ...blueprint.potion } : null,
    gemTarget: blueprint.missionParameters.gemTarget,
    chestTarget: blueprint.missionParameters.chestTarget,
  }
}

export function mapProductInitialState(state: ReplayState): ProductInitialRuntimeState {
  return {
    player: { ...state.player },
    run: { ...state.run, collectedGemIds: [...state.run.collectedGemIds], openedChestIds: [...state.run.openedChestIds] },
    puzzle: {
      ...state.puzzle,
      boulderPositions: state.puzzle.boulderPositions.map(boulder => ({ ...boulder })),
    },
    items: { ...state.items },
    chests: state.chests.map(chest => ({ ...chest })),
    goblin: state.goblins[0] ? { ...state.goblins[0] } : null,
  }
}
