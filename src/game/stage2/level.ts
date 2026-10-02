import { compileTraversalMap } from '../traversal/angkorV2/map'
import type { EnvironmentSprite } from '../rendering/angkorV2/environment'
import type { Direction, GridCoord } from '../world/grid'
import type { Zone } from '../stage1/level'

export const STAGE_AREAS: readonly Zone[] = [
  { name: 'Vine Hall', x: 2, y: 17, width: 7, height: 5 },
  { name: 'Serpent Gallery', x: 2, y: 8, width: 9, height: 8 },
  { name: 'Sunken Court', x: 2, y: 2, width: 9, height: 5 },
  { name: 'Boulder Cloister', x: 11, y: 7, width: 10, height: 8 },
  { name: 'Monkey Gallery', x: 22, y: 9, width: 6, height: 9 },
  { name: 'Inner Seal', x: 22, y: 2, width: 6, height: 5 },
]
const cells = Array.from({ length: 24 }, () => Array<string>(30).fill('T'))
function carve(x: number, y: number, width: number, height: number) {
  for (let row = y; row < y + height; row++) for (let col = x; col < x + width; col++) cells[row][col] = '.'
}
carve(3, 18, 5, 4); carve(3, 15, 2, 3)
carve(3, 8, 1, 8); carve(3, 9, 7, 1); carve(3, 14, 7, 1); carve(9, 9, 1, 6)
carve(3, 2, 7, 4); carve(3, 6, 2, 2); carve(7, 6, 3, 1)
// The only eastward progress route crosses both mandatory sliding stones.
carve(9, 12, 14, 1); carve(12, 11, 2, 1); carve(13, 13, 1, 1)
carve(15, 11, 2, 1); carve(16, 13, 1, 1)
carve(18, 10, 2, 3); carve(17, 9, 3, 2); carve(18, 7, 1, 2)
carve(23, 10, 4, 7); carve(24, 17, 2, 1); carve(25, 7, 1, 3)
carve(23, 3, 4, 4)
cells[20][3] = 'S'; cells[17][3] = 'D'; cells[8][3] = 'B'; cells[12][11] = 'B'; cells[12][22] = 'D'
cells[4][6] = 'P'; cells[3][8] = 'G'; cells[5][7] = 'L'; cells[11][25] = 'P'
cells[15][24] = 'L'; cells[10][27] = 'T'; cells[16][27] = 'T'; cells[9][24] = 'T'; cells[14][22] = 'T'
cells[3][24] = 'T'; cells[3][26] = 'T'; cells[2][25] = 'T'
const compiled = compileTraversalMap({ id: 'angkor-v2-stage2-overgrown-temple', name: 'Overgrown Temple', rows: cells.map(row => row.join('')) })
// Same approved floor kit, denser moss/root intrusion and subdued daylight.
export const stageMap = { ...compiled, visual: { cells: compiled.visual.cells.map((row, y) => row.map((cell, x) => ({
  ...cell, floor: (['mossy', 'root-damaged', 'weathered', 'mossy', 'cracked', 'debris'] as const)[(x * 3 + y * 7) % 6],
  material: (x + y) % 3 ? 'mossy' as const : 'damaged' as const,
}))) } }
export const EXIT: GridCoord = { x: 25, y: 3 }
export const GEM_REQUIREMENT = 7
export const GEMS = [
  { id: 'vine', x: 4, y: 19 }, { id: 'serpent-near', x: 4, y: 14 }, { id: 'serpent-far', x: 9, y: 9 },
  { id: 'court', x: 4, y: 4 }, { id: 'court-risk', x: 9, y: 4 },
  { id: 'cloister', x: 15, y: 11 }, { id: 'cloister-east', x: 18, y: 12 }, { id: 'cloister-pocket', x: 18, y: 8 },
  { id: 'monkey', x: 24, y: 13 }, { id: 'seal', x: 25, y: 4 },
] as const
/** Masonry-guided one-cell tracks. Each stone can only enter its marked parking
 * recess; no player can push it back into the progress lane or off its track. */
export const BOULDERS: readonly { id: string; x: number; y: number; direction: Direction; parked: GridCoord }[] = [
  { id: 'first-slide', x: 13, y: 12, direction: 'DOWN', parked: { x: 13, y: 13 } },
  { id: 'second-slide', x: 16, y: 12, direction: 'DOWN', parked: { x: 16, y: 13 } },
  { id: 'pocket-slide', x: 18, y: 9, direction: 'RIGHT', parked: { x: 19, y: 9 } },
]
export const SPIKES = [{ id: 'sunken-spikes', tiles: [{ x: 8, y: 4 }, { x: 8, y: 5 }] }, { id: 'gallery-spikes', tiles: [{ x: 25, y: 15 }] }] as const
export const SNAKES = [
  { id: 'west-serpent', zone: { name: 'West serpent', x: 2, y: 9, width: 7, height: 7 }, path: [{ x: 3, y: 10 }, { x: 3, y: 11 }, { x: 3, y: 12 }, { x: 3, y: 13 }, { x: 3, y: 14 }, { x: 4, y: 14 }, { x: 5, y: 14 }, { x: 4, y: 14 }, { x: 3, y: 14 }, { x: 3, y: 13 }, { x: 3, y: 12 }, { x: 3, y: 11 }] },
  { id: 'east-serpent', zone: { name: 'East serpent', x: 6, y: 9, width: 5, height: 6 }, path: [{ x: 9, y: 10 }, { x: 9, y: 11 }, { x: 9, y: 12 }, { x: 9, y: 13 }, { x: 9, y: 14 }, { x: 8, y: 14 }, { x: 9, y: 14 }, { x: 9, y: 13 }, { x: 9, y: 12 }, { x: 9, y: 11 }] },
  { id: 'court-serpent', zone: { name: 'Court serpent', x: 7, y: 4, width: 3, height: 3 }, path: [{ x: 9, y: 5 }, { x: 9, y: 6 }, { x: 8, y: 6 }, { x: 7, y: 6 }, { x: 8, y: 6 }, { x: 9, y: 6 }] },
] as const
export const MONKEYS = [
  { id: 'north-keeper', zone: { name: 'North keeper', x: 23, y: 10, width: 4, height: 5 }, perches: [{ x: 27, y: 10 }, { x: 24, y: 9 }], tellTicks: 8, recoveryTicks: 12 },
  { id: 'south-keeper', zone: { name: 'South keeper', x: 23, y: 13, width: 4, height: 5 }, perches: [{ x: 27, y: 16 }, { x: 22, y: 14 }], tellTicks: 9, recoveryTicks: 14 },
] as const
export const RUBBLE = { id: 'fractured-vault', zone: { name: 'Fractured vault', x: 23, y: 5, width: 4, height: 2 }, tiles: [{ x: 24, y: 5 }, { x: 25, y: 5 }], tellTicks: 8, recoveryTicks: 16 } as const
export const STAGE_DECOR: readonly EnvironmentSprite[] = [
  { key: 'vine-hanging-v2', x: 100, y: 462, depthClass: 'foreground' },
  { key: 'root-wall-climb-height-v2', x: 306, y: 337 },
  { key: 'vine-hanging-v2', x: 493, y: 320, depthClass: 'foreground' },
  { key: 'root-corner-wrap-height-v2', x: 732, y: 350 },
  { key: 'vine-hanging-v2', x: 840, y: 147, depthClass: 'foreground' },
  { key: 'root-heavy-v2', x: 83, y: 594, depthClass: 'foreground', shadow: true },
  { key: 'root-wall-climb-height-v2', x: 258, y: 601 }, { key: 'vine-hanging-v2', x: 238, y: 550, depthClass: 'foreground' },
  { key: 'root-corner-wrap-height-v2', x: 74, y: 400 }, { key: 'root-wall-climb-height-v2', x: 340, y: 359 },
  { key: 'root-floor-b-v2', x: 277, y: 472, depthClass: 'floor-overlay' },
  { key: 'root-heavy-v2', x: 346, y: 166, depthClass: 'foreground' },
  { key: 'pillar-broken-height-v2', x: 167, y: 190, shadow: true }, { key: 'statue-fragment-height-v2', x: 251, y: 156, shadow: true },
  { key: 'root-corner-wrap-height-v2', x: 460, y: 369 }, { key: 'root-wall-climb-height-v2', x: 673, y: 368 },
  { key: 'root-heavy-v2', x: 897, y: 482, depthClass: 'foreground' }, { key: 'vine-hanging-v2', x: 910, y: 333, depthClass: 'foreground' },
  { key: 'root-corner-wrap-height-v2', x: 748, y: 125 }, { key: 'root-floor-a-v2', x: 838, y: 210, depthClass: 'floor-overlay' },
  { key: 'moss-cluster-v2', x: 276, y: 697 }, { key: 'fern-a-v2', x: 330, y: 255 },
  { key: 'fern-b-v2', x: 694, y: 547 }, { key: 'broadleaf-a-v2', x: 884, y: 213 },
  { key: 'rubble-small-a-v2', x: 329, y: 455, depthClass: 'floor-overlay' }, { key: 'rubble-small-b-v2', x: 201, y: 207, depthClass: 'floor-overlay' },
]
