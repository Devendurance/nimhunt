import { compileTraversalMap } from '../../traversal/angkorV2/map'
import type { EnvironmentSprite } from '../../rendering/angkorV2/environment'
import type { GridCoord } from '../../world/grid'
import type { ChestPlacement } from '../../systems/chests'

export interface Zone { name: string; x: number; y: number; width: number; height: number }
export const inZone = (p: GridCoord, z: Zone) => p.x >= z.x && p.x < z.x + z.width && p.y >= z.y && p.y < z.y + z.height
export const AREAS: readonly Zone[] = [
  { name: 'Arrival Court', x: 2, y: 17, width: 8, height: 5 },
  { name: 'Vine Arcade', x: 2, y: 9, width: 7, height: 6 },
  { name: 'Collapsed Archive', x: 2, y: 2, width: 10, height: 5 },
  { name: 'Boulder Store', x: 14, y: 3, width: 7, height: 6 },
  { name: 'Monkey Treasury', x: 22, y: 10, width: 6, height: 8 },
  { name: 'Lower Vault Passage', x: 13, y: 17, width: 8, height: 5 },
]
const cells = Array.from({ length: 24 }, () => Array<string>(30).fill('#'))
function carve(x: number, y: number, w: number, h: number) {
  for (let row = y; row < y + h; row++) for (let col = x; col < x + w; col++) cells[row][col] = '.'
}
AREAS.forEach(a => carve(a.x, a.y, a.width, a.height))
carve(5, 15, 2, 2); carve(4, 7, 2, 2); carve(12, 6, 2, 1)
carve(19, 9, 2, 3); carve(21, 10, 1, 2); carve(24, 18, 2, 2); carve(21, 18, 3, 2)
cells[20][3] = 'S'; cells[16][5] = 'B'; cells[8][4] = 'D'; cells[6][12] = 'B'; cells[18][21] = 'D'
// Low masonry reveals the arcade treasure; its southern return grants access.
for (let y = 9; y <= 12; y++) cells[y][6] = y === 11 ? 'L' : 'T'
// Locked archive room has exactly one entrance. Its treasure is seen over low ruins.
for (let y = 2; y <= 4; y++) cells[y][8] = y === 3 ? 'L' : 'T'
for (let y = 2; y <= 4; y++) cells[y][11] = y === 3 ? 'L' : 'T'
for (const x of [10, 11]) cells[5][x] = 'T'
cells[5][9] = '.'; cells[5][8] = 'T'
// Two small, visible pockets. Stones slide on authored horizontal guide grooves.
for (const [x,y] of [[14,4],[16,4],[15,3],[18,6],[20,6],[19,5]]) cells[y][x] = 'T'
cells[4][15] = '.'; cells[6][19] = '.'
cells[11][3] = 'P'; cells[18][8] = 'P'; cells[3][3] = 'C'; cells[6][6] = 'G'
cells[12][23] = 'P'; cells[10][26] = 'T'; cells[16][27] = 'T'; cells[18][15] = 'G'
for (const x of [16,18]) cells[18][x] = 'T'
cells[17][17] = 'T'
export const stageMap = compileTraversalMap({ id: 'chest-hunter-v2-lost-courtyard', name: 'Lost Courtyard', rows: cells.map(r => r.join('')) })
export const CHEST_REQUIREMENT = 4
export const CHESTS: readonly ChestPlacement[] = [
  { id: 'arrival', x: 7, y: 19, loot: 'GEMS' },
  { id: 'arcade', x: 7, y: 10, loot: 'POTION' },
  { id: 'archive', x: 10, y: 3, loot: 'EMPTY' },
  { id: 'store', x: 15, y: 4, loot: 'TRAP' },
  { id: 'treasury', x: 25, y: 14, loot: 'GEMS' },
  { id: 'store-bonus', x: 19, y: 6, loot: 'SWORD' },
]
export const KEY = { id: 'bronze-temple-key', x: 4, y: 3 } as const
export const GATE: GridCoord = { x: 9, y: 5 }
export const EXIT: GridCoord = { x: 17, y: 18 }
export const BOULDERS = [
  { id: 'store-stone', x: 15, y: 5, minX: 15, maxX: 18 },
  { id: 'bonus-stone', x: 19, y: 7, minX: 18, maxX: 20 },
] as const
export const SPIKES = [{ id: 'treasury-spikes', tiles: [{ x: 24, y: 12 }, { x: 25, y: 12 }] }] as const
export const SNAKES = [{ id: 'arcade-snake', zone: { name: 'Serpent alcove', x: 3, y: 10, width: 3, height: 4 },
  path: [{ x: 4, y: 11 }, { x: 5, y: 11 }, { x: 5, y: 12 }, { x: 4, y: 12 }] }] as const
export const MONKEY = { zone: AREAS[4], perches: [{ x: 26, y: 10 }, { x: 27, y: 16 }] } as const
export const DECOR: readonly EnvironmentSprite[] = [
  { key: 'root-heavy-v2', x: 69, y: 582, depthClass: 'foreground' },
  { key: 'root-floor-a-v2', x: 156, y: 659, depthClass: 'floor-overlay' },
  { key: 'fern-a-v2', x: 286, y: 687 }, { key: 'grass-edge-v2', x: 222, y: 705 },
  { key: 'root-wall-climb-height-v2', x: 194, y: 367 },
  { key: 'vine-hanging-v2', x: 114, y: 330, depthClass: 'foreground' },
  { key: 'root-corner-wrap-height-v2', x: 274, y: 166 },
  { key: 'root-wall-climb-height-v2', x: 360, y: 188 },
  { key: 'rubble-small-b-v2', x: 184, y: 193, depthClass: 'floor-overlay' },
  { key: 'statue-fragment-height-v2', x: 247, y: 86 },
  { key: 'rubble-small-a-v2', x: 459, y: 267, depthClass: 'floor-overlay' },
  { key: 'root-floor-b-v2', x: 628, y: 282, depthClass: 'floor-overlay' },
  { key: 'pillar-broken-height-v2', x: 535, y: 263 },
  { key: 'root-corner-wrap-height-v2', x: 886, y: 380 },
  { key: 'broadleaf-a-v2', x: 879, y: 554 },
  { key: 'root-heavy-v2', x: 449, y: 571, depthClass: 'foreground' },
  { key: 'rubble-small-b-v2', x: 630, y: 679, depthClass: 'floor-overlay' },
]
