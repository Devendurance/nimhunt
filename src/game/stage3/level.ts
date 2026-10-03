import { compileTraversalMap } from '../traversal/angkorV2/map'
import type { EnvironmentSprite } from '../rendering/angkorV2/environment'
import type { Direction, GridCoord } from '../world/grid'
import type { Zone } from '../stage1/level'

export const STAGE_AREAS: readonly Zone[] = [
  { name: 'Sanctuary Threshold', x: 2, y: 17, width: 7, height: 5 },
  { name: 'Coil Gallery', x: 2, y: 8, width: 9, height: 9 },
  { name: 'Ritual Court', x: 2, y: 2, width: 9, height: 5 },
  { name: 'Serpent Passage', x: 12, y: 6, width: 7, height: 10 },
  { name: 'Anaconda Sanctum', x: 20, y: 8, width: 8, height: 10 },
  { name: 'Escape Passage', x: 22, y: 2, width: 6, height: 6 },
]
const cells = Array.from({ length: 24 }, () => Array<string>(30).fill('T'))
function carve(x: number, y: number, width: number, height: number) {
  for (let row = y; row < y + height; row++) for (let col = x; col < x + width; col++) cells[row][col] = '.'
}
carve(3, 18, 5, 4); carve(3, 7, 1, 11); carve(7, 15, 1, 3)
carve(3, 9, 7, 1); carve(3, 14, 7, 1); carve(9, 9, 1, 6); carve(7, 14, 1, 2)
carve(3, 2, 7, 5); carve(9, 6, 5, 1)
carve(13, 6, 5, 10); for (let y = 8; y <= 12; y++) cells[y][15] = 'T'
carve(17, 14, 4, 2); carve(20, 8, 8, 10)
carve(25, 5, 2, 4); carve(23, 2, 5, 4)
cells[20][3] = 'S'; cells[17][3] = 'D'; cells[8][3] = 'B'; cells[6][12] = 'B'; cells[14][19] = 'D'
cells[12][7] = 'L'; cells[3][4] = 'P'; cells[6][8] = 'P'; cells[17][23] = 'P'; cells[8][20] = 'P'
cells[4][23] = 'T'; cells[4][27] = 'T'
export const PITS = {
  PIT_LEFT: { x: 22, y: 13 }, PIT_CENTER: { x: 24, y: 13 }, PIT_RIGHT: { x: 26, y: 13 },
} as const
export type PitId = keyof typeof PITS
export const PIT_ORDER: readonly PitId[] = ['PIT_CENTER', 'PIT_LEFT', 'PIT_RIGHT']
// Only these authored holes are solid; the large serpent's pixels are not collision.
export const BOSS_BODY: readonly GridCoord[] = Object.values(PITS)
const compiled = compileTraversalMap({ id: 'angkor-v2-stage3-inner-sanctuary', name: 'Inner Sanctuary', rows: cells.map(row => row.join('')), structures: [
  // Permanent pit cells: the serpent's visual size never decides collision.
  ...Object.values(PITS).map(p => ({ sprite: { key: 'serpent-pit-v2' as const, x: p.x * 32 + 16, y: p.y * 32 + 16, depthClass: 'floor-overlay' as const, occludesPlayer: false }, occupied: [p] })),
  { sprite: { key: 'guardian-monument-v2', x: 240, y: 160, shadow: true }, occupied: [{ x: 6, y: 3 }, { x: 7, y: 3 }, { x: 6, y: 4 }, { x: 7, y: 4 }] },
] })
export const stageMap = { ...compiled, visual: { cells: compiled.visual.cells.map((row, y) => row.map((cell, x) => ({
  ...cell, floor: (['root-damaged', 'mossy', 'cracked', 'mossy', 'debris', 'weathered'] as const)[(x * 3 + y * 7) % 6],
  material: (x + y) % 4 ? 'mossy' as const : 'damaged' as const,
}))) } }
export const EXIT: GridCoord = { x: 25, y: 3 }
export const GEM_REQUIREMENT = 8
export const GEMS = [
  { id: 'threshold', x: 4, y: 19 }, { id: 'coil-near', x: 4, y: 14 }, { id: 'coil-far', x: 9, y: 10 },
  { id: 'ritual', x: 4, y: 4 }, { id: 'ritual-risk', x: 9, y: 4 },
  { id: 'passage-west', x: 13, y: 8 }, { id: 'passage-east', x: 17, y: 12 },
  { id: 'sanctum-west', x: 21, y: 10 }, { id: 'sanctum-south', x: 21, y: 16 },
  { id: 'sanctum-risk', x: 27, y: 15 }, { id: 'sanctum-east', x: 27, y: 11 }, { id: 'escape', x: 25, y: 4 },
] as const
// Captive one-tile release rails are reversible by waiting: no loose Sokoban stones.
export const BOULDERS: readonly { id: string; pit: PitId; x: number; y: number; direction: Direction; drop: GridCoord }[] =
  Object.entries(PITS).map(([pit, p]) => ({ id: `boss-${pit}`, pit: pit as PitId, x: p.x, y: 11, direction: 'DOWN', drop: { x: p.x, y: 12 } }))
export const SPIKES = [{ id: 'ritual-spikes', tiles: [{ x: 8, y: 4 }, { x: 8, y: 5 }] }, { id: 'sanctum-spikes', tiles: [{ x: 26, y: 15 }] }] as const
export const SNAKES = [
  { id: 'coil-west', zone: { name: 'Coil west', x: 2, y: 10, width: 5, height: 5 }, path: [{ x: 3, y: 10 }, { x: 3, y: 11 }, { x: 3, y: 12 }, { x: 3, y: 13 }, { x: 3, y: 14 }, { x: 4, y: 14 }, { x: 3, y: 14 }, { x: 3, y: 13 }, { x: 3, y: 12 }, { x: 3, y: 11 }] },
  { id: 'coil-east', zone: { name: 'Coil east', x: 7, y: 9, width: 4, height: 6 }, path: [{ x: 9, y: 11 }, { x: 9, y: 12 }, { x: 9, y: 13 }, { x: 9, y: 14 }, { x: 8, y: 14 }, { x: 9, y: 14 }, { x: 9, y: 13 }, { x: 9, y: 12 }] },
] as const
export const MONKEYS = [{ id: 'ritual-keeper', zone: { name: 'Ritual keeper', x: 8, y: 2, width: 2, height: 4 }, perches: [{ x: 10, y: 3 }, { x: 10, y: 5 }], tellTicks: 9, recoveryTicks: 14 }] as const
export const RUBBLE = { id: 'ritual-vault', zone: { name: 'Ritual vault', x: 3, y: 5, width: 3, height: 2 }, tiles: [{ x: 4, y: 5 }, { x: 5, y: 5 }], tellTicks: 8, recoveryTicks: 16 } as const
export const ANACONDA = {
  passage: STAGE_AREAS[3], sanctum: STAGE_AREAS[4], emergenceTicks: 12, dropTicks: 4, defeatTicks: 14,
  phases: [
    { vulnerableTicks: 80, tellTicks: 16, recoveryTicks: 10, replacementTicks: 16, laneRows: [11] },
    { vulnerableTicks: 64, tellTicks: 16, recoveryTicks: 8, replacementTicks: 14, laneRows: [11, 12] },
    { vulnerableTicks: 48, tellTicks: 18, recoveryTicks: 8, replacementTicks: 12, laneRows: [10, 11, 12] },
  ],
} as const
export const STAGE_DECOR: readonly EnvironmentSprite[] = [
  { key: 'root-heavy-v2', x: 87, y: 626, depthClass: 'foreground', shadow: true },
  { key: 'root-wall-climb-height-v2', x: 263, y: 608 }, { key: 'vine-hanging-v2', x: 240, y: 552, depthClass: 'foreground' },
  { key: 'root-corner-wrap-height-v2', x: 70, y: 412 }, { key: 'root-floor-b-v2', x: 280, y: 475, depthClass: 'floor-overlay' },
  { key: 'anaconda-body-v2', x: 248, y: 387, depthClass: 'foreground', alpha: .65 },
  { key: 'root-heavy-v2', x: 346, y: 165, depthClass: 'foreground' },
  { key: 'statue-fragment-height-v2', x: 182, y: 198, shadow: true },
  { key: 'root-wall-climb-height-v2', x: 443, y: 266 }, { key: 'vine-hanging-v2', x: 581, y: 370, depthClass: 'foreground' },
  { key: 'root-corner-wrap-height-v2', x: 593, y: 478 }, { key: 'root-heavy-v2', x: 889, y: 585, depthClass: 'foreground' },
  { key: 'root-wall-climb-height-v2', x: 884, y: 310 }, { key: 'vine-hanging-v2', x: 703, y: 273, depthClass: 'foreground' },
  { key: 'root-floor-a-v2', x: 816, y: 556, depthClass: 'floor-overlay' },
  { key: 'pillar-broken-height-v2', x: 730, y: 592, shadow: true }, { key: 'statue-fragment-height-v2', x: 654, y: 587, shadow: true },
  { key: 'vine-hanging-v2', x: 840, y: 148, depthClass: 'foreground' }, { key: 'root-corner-wrap-height-v2', x: 748, y: 118 },
  { key: 'rubble-small-a-v2', x: 187, y: 209, depthClass: 'floor-overlay' }, { key: 'moss-cluster-v2', x: 330, y: 255 },
]
