import { TILE_SIZE, type GridRoom, type GridCoord } from '../../world/grid.js'
import type { EnvironmentMap, EnvironmentCell } from '../../rendering/angkorV2/geometry.js'
import type { EnvironmentSprite } from '../../rendering/angkorV2/types.js'

export interface TraversalMapTruth {
  readonly id: string
  readonly name: string
  readonly rows: readonly string[]
  readonly structures?: readonly { sprite: EnvironmentSprite; occupied: readonly GridCoord[] }[]
}
export interface TraversalMap {
  readonly visual: EnvironmentMap
  readonly collision: GridRoom
  readonly structures: readonly EnvironmentSprite[]
  readonly world: { width: number; height: number }
}
const legend: Record<string, { visual: EnvironmentCell['kind']; blocked: boolean; sprite?: EnvironmentSprite['key'] }> = {
  '#': { visual: 'wall', blocked: true },
  T: { visual: 'tall', blocked: true }, L: { visual: 'low', blocked: true }, C: { visual: 'collapsed', blocked: true },
  '.': { visual: 'floor', blocked: false }, S: { visual: 'floor', blocked: false },
  D: { visual: 'doorway', blocked: false }, B: { visual: 'broken', blocked: false },
  P: { visual: 'floor', blocked: true, sprite: 'pillar-intact-height-v2' },
  G: { visual: 'floor', blocked: true, sprite: 'guardian-statue-height-v2' },
}
const floorStyles = ['clean', 'weathered', 'cracked', 'mossy', 'root-damaged', 'debris'] as const

/** Explicit authored symbols/occupied cells produce separate visual and collision
 * data. Neither image alpha nor manifest collidable hints grant walkability. */
export function compileTraversalMap(truth: TraversalMapTruth): TraversalMap {
  const height = truth.rows.length, width = truth.rows[0]?.length ?? 0
  if (!width || !height || width > 64 || height > 64 || truth.rows.some(row => row.length !== width)) throw new Error('Traversal map must be rectangular, 1–64 cells per axis')
  const starts: GridCoord[] = [], structures: EnvironmentSprite[] = []
  const blocked = truth.rows.map(row => [...row].map(symbol => {
    if (!Object.hasOwn(legend, symbol)) throw new Error('Unknown traversal map symbol')
    return legend[symbol].blocked
  }))
  const visual: EnvironmentMap = { cells: truth.rows.map((row, y) => [...row].map((symbol, x) => {
    if (symbol === 'S') starts.push({ x, y })
    const definition = legend[symbol]
    if (definition.sprite) structures.push({ key: definition.sprite, x: x * TILE_SIZE + TILE_SIZE / 2, y: (y + 1) * TILE_SIZE, shadow: true })
    return { kind: definition.visual, floor: floorStyles[(x * 7 + y * 3) % floorStyles.length] }
  })) }
  for (const structure of truth.structures ?? []) {
    if (!structure.occupied.length) throw new Error('Solid structure requires explicit occupied cells')
    for (const cell of structure.occupied) {
      if (!Number.isInteger(cell.x) || !Number.isInteger(cell.y) || cell.x < 0 || cell.y < 0 || cell.x >= width || cell.y >= height) throw new Error('Invalid structure collision footprint')
      blocked[cell.y][cell.x] = true
    }
    structures.push(structure.sprite)
  }
  if (starts.length !== 1 || blocked[starts[0].y][starts[0].x]) throw new Error('Traversal map requires one walkable spawn')
  if (blocked[0].some(value => !value) || blocked[height - 1].some(value => !value) || blocked.some(row => !row[0] || !row[width - 1])) throw new Error('Traversal map requires closed logical boundaries')
  const layout = blocked.map((row, y) => row.map((solid, x) => solid ? '#' : x === starts[0].x && y === starts[0].y ? 'S' : '.').join(''))
  return { visual, collision: { id: truth.id, name: truth.name, width, height, layout, playerStart: starts[0] }, structures, world: { width: width * TILE_SIZE, height: height * TILE_SIZE } }
}
