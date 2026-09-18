import type { GridCoord, GridRoom } from './grid.ts'
import type { PuzzleObjects } from '../systems/puzzle.ts'
import type { RoomContents } from '../systems/tileEntry.ts'
import type { ChestPlacement } from '../systems/chests.ts'
import { BLUEPRINT_VERSION_V1, ROOM_VERSION, RULES_VERSION } from '../replay/versions.ts'
import type { ExpeditionBlueprint, MissionType } from '../replay/types.ts'

export const ROOM_01_CONTENTS: RoomContents = {
  gems: [[2, 3], [1, 1], [5, 1], [9, 1], [10, 4], [10, 8], [5, 8], [1, 8]].map(([x, y], i) => ({ id: `room01-gem-${i + 1}`, x, y })),
  hazards: [{ x: 5, y: 3, type: 'SPIKES' }, { x: 6, y: 6, type: 'POISON' }],
}

/**
 * Angkor Ruins - Room 01 (Sanctuary Antechamber)
 *
 * Dimensions: 12 columns x 10 rows (384px x 320px at 32px per tile).
 * Legend:
 *   '#' = Wall (blocking)
 *   '.' = Stone floor (walkable)
 *   'S' = Player start point (walkable, at x=3, y=3)
 */
export const ANGKOR_ROOM_01: GridRoom = {
  id: 'angkor_01',
  name: 'Angkor Ruins · Room 01',
  width: 12,
  height: 10,
  playerStart: { x: 3, y: 3 },
  layout: [
    '############',
    '#.......#..#',
    '#..##..##..#',
    '#..S.......#',
    '#..##...#..#',
    '#..#....##.#',
    '#.#.....##.#',
    '#..#....#..#',
    '#.......#..#',
    '############',
  ],
}

export const ROOM_01_PUZZLE: PuzzleObjects = {
  boulders: [{ id: 'room01-boulder-1', x: 4, y: 6 }],
  key: { x: 3, y: 6 }, gate: { x: 8, y: 3 }, shrine: { x: 9, y: 3 },
}

export interface GoblinSpawnConfig {
  readonly spawn: GridCoord
  readonly patrolRoute: readonly GridCoord[]
}

export const ROOM_01_GOBLIN: GoblinSpawnConfig = {
  spawn: { x: 7, y: 4 },
  patrolRoute: [
    { x: 7, y: 4 },
    { x: 7, y: 5 },
    { x: 7, y: 6 },
    { x: 7, y: 7 },
  ],
}

export const ROOM_01_SWORD: GridCoord = { x: 1, y: 6 }
export const ROOM_01_POTION: GridCoord = { x: 2, y: 1 }

/**
 * Deterministic Room 01 chest configuration (fixed loot, no reroll).
 * - chest-01 (1,2) GEMS: early/easy, top-left corridor
 * - chest-02 (6,3) POTION: adjacent to spikes hazard (5,3)
 * - chest-03 (5,5) TRAP: deeper puzzle route, central chamber
 * - chest-04 (10,3) SWORD: inner chamber beyond gate (8,3), near shrine (9,3)
 * All tiles are walkable floor, reachable, and avoid walls/hazards/key/gate/shrine/boulder/Goblin/gems.
 */
export const ROOM_01_CHESTS: readonly ChestPlacement[] = [
  { id: 'room01-chest-01', x: 1, y: 2, loot: 'GEMS' },
  { id: 'room01-chest-02', x: 6, y: 3, loot: 'POTION' },
  { id: 'room01-chest-03', x: 5, y: 5, loot: 'TRAP' },
  { id: 'room01-chest-04', x: 10, y: 3, loot: 'SWORD' },
]

export function createRoom01Blueprint(
  dayKey: string,
  mission: MissionType,
  blueprintId = `room01-${dayKey}-${mission}`,
): ExpeditionBlueprint {
  const blueprint: ExpeditionBlueprint = {
    rulesVersion: RULES_VERSION,
    roomVersion: ROOM_VERSION,
    blueprintVersion: BLUEPRINT_VERSION_V1,
    dayKey,
    mission,
    blueprintId,
    blueprintHash: '',
    status: 'VALIDATED',
    spawn: { ...ANGKOR_ROOM_01.playerStart },
    goblins: [{
      id: 'room01-goblin-1',
      spawn: { ...ROOM_01_GOBLIN.spawn },
      patrolRoute: ROOM_01_GOBLIN.patrolRoute.map(coord => ({ ...coord })),
    }],
    gems: ROOM_01_CONTENTS.gems.map(gem => ({ ...gem })),
    chests: ROOM_01_CHESTS.map(chest => ({ ...chest })),
    sword: { ...ROOM_01_SWORD },
    potion: { ...ROOM_01_POTION },
    hazards: ROOM_01_CONTENTS.hazards.map(hazard => ({ ...hazard })),
    boulders: ROOM_01_PUZZLE.boulders.map(boulder => ({ ...boulder })),
    key: { ...ROOM_01_PUZZLE.key },
    gate: { ...ROOM_01_PUZZLE.gate },
    objective: { ...ROOM_01_PUZZLE.shrine },
    missionParameters: { gemTarget: 6, chestTarget: 4 },
    timedHazards: [],
  }
  return blueprint
}
