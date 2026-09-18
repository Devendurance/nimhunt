import type { ExpeditionBlueprint, ReplayCollapsingBoulderState, ReplayState, TimedHazard } from './replay/types.js'
import type { GridCoord } from './world/grid.js'
import type { PuzzleObjects, PuzzleState } from './systems/puzzle.js'
import type { RoomContents } from './systems/tileEntry.js'
import type { ChestInstance, ChestPlacement } from './systems/chests.js'
import type { GoblinState } from './systems/goblin.js'
import type { ItemState } from './systems/items.js'
import type { PlayerRunState } from './domain/runState.js'
import type { GoblinSpawnConfig } from './world/room01.js'

export type ProductBlueprintRuntime = {
  readonly spawn: GridCoord
  readonly contents: RoomContents
  readonly puzzle: PuzzleObjects
  readonly goblin: GoblinSpawnConfig | null
  readonly goblins: readonly GoblinSpawnConfig[]
  readonly chests: readonly ChestPlacement[]
  readonly sword: GridCoord | null
  readonly potion: GridCoord | null
  readonly gemTarget: number
  readonly chestTarget: number
  readonly timedHazards: readonly TimedHazard[]
}

export type ProductInitialRuntimeState = {
  readonly player: GridCoord
  readonly run: PlayerRunState
  readonly puzzle: PuzzleState
  readonly items: ItemState
  readonly chests: readonly ChestInstance[]
  readonly goblin: GoblinState | null
  readonly goblins: readonly GoblinState[]
  readonly collapsingBoulders?: readonly ReplayCollapsingBoulderState[]
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
    goblins: blueprint.goblins.map(goblin => ({
      spawn: { ...goblin.spawn },
      patrolRoute: goblin.patrolRoute.map(coord => ({ ...coord })),
    })),
    chests: blueprint.chests.map(chest => ({ ...chest })),
    sword: blueprint.sword ? { ...blueprint.sword } : null,
    potion: blueprint.potion ? { ...blueprint.potion } : null,
    gemTarget: blueprint.missionParameters.gemTarget,
    chestTarget: blueprint.missionParameters.chestTarget,
    timedHazards: blueprint.timedHazards.map(h => ({
      ...h,
      triggerCells: h.triggerCells ? h.triggerCells.map(c => ({ ...c })) : undefined,
    })),
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
    goblins: state.goblins.map(goblin => ({ ...goblin })),
    collapsingBoulders: state.collapsingBoulders ? state.collapsingBoulders.map(cb => ({ ...cb })) : undefined,
  }
}
