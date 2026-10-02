import { describe, expect, it } from 'vitest'
import { compileTraversalMap } from './map'
import { traversalMap, traversalMapTruth } from '../../../dev/angkorV2TraversalFixture'
import { calculateMove } from '../../systems/movement'
import { DIRECTION_VECTORS, type Direction, type GridCoord } from '../../world/grid'

describe('explicit Angkor traversal map truth', () => {
  it('derives separate 30×24 visual/collision maps and a larger world without mutating truth', () => {
    const before = structuredClone(traversalMapTruth), map = compileTraversalMap(traversalMapTruth)
    expect(traversalMapTruth).toEqual(before)
    expect([map.collision.width, map.collision.height]).toEqual([30, 24])
    expect(map.world).toEqual({ width: 960, height: 768 })
    expect(map.visual.cells).toHaveLength(24); expect(map.visual.cells.every(row => row.length === 30)).toBe(true)
    expect(map.collision.playerStart).toEqual({ x: 3, y: 5 })
  })
  it('blocks walls, tall walls and solid floor architecture while keeping openings legal', () => {
    const map = traversalMap
    expect(map.visual.cells[3][6].kind).toBe('floor')
    expect(calculateMove(map.collision, { x: 5, y: 3 }, 'RIGHT').success).toBe(false)
    expect(calculateMove(map.collision, { x: 10, y: 5 }, 'DOWN').success).toBe(false)
    expect(calculateMove(map.collision, { x: 5, y: 7 }, 'DOWN').success).toBe(true)
    expect(calculateMove(map.collision, { x: 16, y: 9 }, 'DOWN').success).toBe(true)
    expect(map.collision.layout[1][18]).toBe('#') // closed Temple footprint
    expect(map.collision.layout[2][18]).toBe('#') // closed threshold is solid floor
    for (let y = 0; y < 24; y++) for (let x = 0; x < 30; x++) {
      if (x === 0 || y === 0 || x === 29 || y === 23) expect(map.collision.layout[y][x]).toBe('#')
    }
  })
  it('connects every walkable tile via legal cardinal moves, with dense architectural area', () => {
    const room = traversalMap.collision, queue: GridCoord[] = [room.playerStart], visited = new Set([room.playerStart.x + ',' + room.playerStart.y])
    for (let index = 0; index < queue.length; index++) for (const direction of Object.keys(DIRECTION_VECTORS) as Direction[]) {
      const move = calculateMove(room, queue[index], direction), key = move.to.x + ',' + move.to.y
      if (move.success && !visited.has(key)) { visited.add(key); queue.push(move.to) }
    }
    const walkable = room.layout.join('').replaceAll('#', '').length
    expect(visited.size).toBe(walkable)
    expect(walkable / (30 * 24)).toBeLessThan(.5)
  })
  it('rejects ragged/unknown/open-boundary maps and invalid occupied cells', () => {
    for (const rows of [[], ['###', '##'], ['###', '#Z#', '###'], ['###', '#S.', '###']]) expect(() => compileTraversalMap({ id: 'bad', name: 'bad', rows })).toThrow()
    expect(() => compileTraversalMap({ id: 'bad', name: 'bad', rows: ['###', '#S#', '###'], structures: [{ sprite: { key: 'pillar-intact-height-v2', x: 0, y: 0 }, occupied: [{ x: 4, y: 2 }] }] })).toThrow()
  })
})
