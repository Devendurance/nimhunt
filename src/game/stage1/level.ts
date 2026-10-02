import { compileTraversalMap } from '../traversal/angkorV2/map'
import type { EnvironmentSprite } from '../rendering/angkorV2/environment'
import type { GridCoord } from '../world/grid'

export interface Zone { name: string; x: number; y: number; width: number; height: number }
export const STAGE_AREAS: readonly Zone[] = [
  { name: 'Entry Terrace', x: 2, y: 17, width: 7, height: 5 },
  { name: 'Root Court', x: 2, y: 9, width: 8, height: 6 },
  { name: 'Broken Gallery', x: 3, y: 2, width: 9, height: 5 },
  { name: 'Boulder Garden', x: 13, y: 9, width: 8, height: 7 },
  { name: 'Monkey Ledge', x: 23, y: 10, width: 5, height: 9 },
  { name: 'Temple Passage', x: 21, y: 2, width: 7, height: 5 },
]
export const inZone = (p: GridCoord, zone: Zone) => p.x >= zone.x && p.x < zone.x + zone.width && p.y >= zone.y && p.y < zone.y + zone.height
const cells = Array.from({ length: 24 }, () => Array<string>(30).fill('#'))
function carve(x: number, y: number, width: number, height: number) {
  for (let row = y; row < y + height; row++) for (let col = x; col < x + width; col++) cells[row][col] = '.'
}
for (const area of STAGE_AREAS) carve(area.x, area.y, area.width, area.height)
carve(4, 15, 2, 2); carve(3, 7, 2, 2) // Terrace → roots → gallery.
carve(10, 5, 5, 2); carve(13, 7, 2, 2) // Turning gallery, then garden.
carve(10, 12, 3, 1) // Short route: push the boulder out of this breach.
carve(21, 12, 2, 2); carve(25, 7, 2, 3) // Doorway, ledge, temple approach.
cells[20][3] = 'S'; cells[16][4] = 'B'; cells[8][3] = 'D'; cells[12][10] = 'B'; cells[12][21] = 'D'
// The gallery Gem is seen across low masonry; the south return reaches it.
for (let y = 2; y <= 4; y++) cells[y][8] = y === 3 ? 'L' : 'T'
cells[11][3] = 'P'; cells[13][7] = 'G'; cells[5][5] = 'P'; cells[11][26] = 'P'
cells[10][26] = 'T'; cells[15][27] = 'T' // Authored solid monkey perches.
cells[18][8] = 'L'; cells[9][8] = 'C'; cells[17][23] = 'L'
// One gentle optional pocket: push down into the pocket, step aside, collect.
cells[14][13] = '#'; cells[14][15] = '#'
cells[15][14] = '#'; cells[14][14] = '.'
// Temple threshold has explicit solid flanking architecture, an open central cell.
for (const x of [23, 25]) cells[3][x] = 'T'
cells[2][24] = 'T'
export const stageMap = compileTraversalMap({ id: 'angkor-v2-stage1-outer-ruins', name: 'Outer Ruins', rows: cells.map(row => row.join('')) })
export const EXIT: GridCoord = { x: 24, y: 3 }
export const GEM_REQUIREMENT = 6
export const GEMS = [
  { id: 'terrace-a', x: 4, y: 19 }, { id: 'terrace-b', x: 7, y: 18 },
  { id: 'root-court', x: 4, y: 11 }, { id: 'root-bonus', x: 8, y: 10 },
  { id: 'gallery', x: 10, y: 3 }, { id: 'garden', x: 18, y: 13 },
  { id: 'garden-bonus', x: 14, y: 14 }, { id: 'ledge', x: 24, y: 14 },
] as const
export const BOULDERS = [{ id: 'breach', x: 11, y: 12 }, { id: 'pocket', x: 14, y: 12 }, { id: 'garden-stone', x: 18, y: 11 }] as const
export const SPIKES = [
  { id: 'root-spikes', tiles: [{ x: 8, y: 12 }, { x: 9, y: 12 }] },
  { id: 'ledge-spikes', tiles: [{ x: 24, y: 16 }, { x: 25, y: 16 }] },
] as const
export const SNAKES = [
  { id: 'roots', zone: { name: 'Root snake', x: 5, y: 9, width: 4, height: 3 }, path: [{ x: 6, y: 10 }, { x: 7, y: 10 }, { x: 7, y: 11 }, { x: 6, y: 11 }] },
  { id: 'garden', zone: { name: 'Garden snake', x: 17, y: 12, width: 4, height: 4 }, path: [{ x: 18, y: 14 }, { x: 19, y: 14 }, { x: 19, y: 15 }, { x: 18, y: 15 }] },
] as const
export const MONKEY = { zone: STAGE_AREAS[4], perches: [{ x: 26, y: 10 }, { x: 27, y: 15 }] } as const
export const STAGE_DECOR: readonly EnvironmentSprite[] = [
  { key: 'root-heavy-v2', x: 72, y: 568, depthClass: 'foreground', shadow: true },
  { key: 'root-wall-climb-height-v2', x: 58, y: 353 },
  { key: 'root-corner-wrap-height-v2', x: 300, y: 316 },
  { key: 'root-floor-b-v2', x: 173, y: 414, depthClass: 'floor-overlay' },
  { key: 'root-floor-a-v2', x: 113, y: 649, depthClass: 'floor-overlay' },
  { key: 'root-corner-wrap-height-v2', x: 418, y: 308 },
  { key: 'root-wall-climb-height-v2', x: 687, y: 151 },
  { key: 'root-heavy-v2', x: 895, y: 195, depthClass: 'foreground' },
  { key: 'fern-a-v2', x: 284, y: 687 }, { key: 'fern-b-v2', x: 78, y: 305 },
  { key: 'broadleaf-a-v2', x: 637, y: 500 }, { key: 'broadleaf-a-v2', x: 866, y: 552 },
  { key: 'vine-hanging-v2', x: 211, y: 317, depthClass: 'foreground' },
  { key: 'moss-cluster-v2', x: 471, y: 490 },
  { key: 'rubble-small-a-v2', x: 251, y: 551, depthClass: 'floor-overlay' },
  { key: 'rubble-small-b-v2', x: 366, y: 204, depthClass: 'floor-overlay' },
  { key: 'pillar-broken-height-v2', x: 659, y: 533, shadow: true },
  { key: 'statue-fragment-height-v2', x: 713, y: 202, shadow: true },
]
