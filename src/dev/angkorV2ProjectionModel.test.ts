/// <reference types="node" />
import { readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ROOM, ROOM_SIZE, TILE, WALL_HEIGHT, TEST_ASSETS, walls, cell, solid, poses, groundPoint, compareDepth, wallCoversFoot } from './angkorV2ProjectionModel'

describe('isolated Angkor projection experiment', () => {
  it('has one dense 12×12 square-grid room with connected passages', () => {
    expect(TILE).toBe(32)
    expect(ROOM).toHaveLength(ROOM_SIZE)
    expect(ROOM.every(row => row.length === ROOM_SIZE)).toBe(true)
    expect(walls.length / 144).toBeGreaterThan(.5)
    const seen = new Set<string>(), pending = [[2, 2]]
    while (pending.length) {
      const [x, y] = pending.pop()!, key = `${x},${y}`
      if (seen.has(key) || x < 0 || y < 0 || x >= ROOM_SIZE || y >= ROOM_SIZE || solid(x, y)) continue
      seen.add(key); pending.push([x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1])
    }
    expect(seen.size + walls.length).toBe(144)
    for (const [x, y] of [[3, 5], [5, 8], [7, 7], [9, 7], [9, 3]]) expect(seen.has(`${x},${y}`)).toBe(true)
    expect(cell(7, 7)).toBe('D'); expect(cell(9, 7)).toBe('B')
    expect([cell(1, 4), cell(2, 4), cell(3, 4), cell(4, 4)]).toEqual(['#', '.', '.', '#'])
  })

  it('exposes only boundary faces and preserves the ground footprint while lifting caps', () => {
    for (const wall of walls) {
      expect(wall.topY).toBe(wall.y * TILE - WALL_HEIGHT)
      expect(wall.depth).toBe((wall.y + 1) * TILE)
      expect(wall.south).toBe(wall.y === ROOM_SIZE - 1 || !solid(wall.x, wall.y + 1))
      expect(wall.east).toBe(!solid(wall.x + 1, wall.y))
      expect(wall.west).toBe(!solid(wall.x - 1, wall.y))
    }
    // The lone pier between doorway and breach has both side returns/end caps.
    expect(walls.find(w => w.x === 8 && w.y === 7)).toMatchObject({ east: true, west: true, north: true, south: true })
  })

  it('places every character test on floor and sorts foreground masonry over it', () => {
    for (const pose of Object.values(poses)) expect(solid(Math.floor(pose.x), Math.floor(pose.y)), pose.label).toBe(false)
    const behind = groundPoint(poses.behind.x, poses.behind.y)
    const foreground = walls.find(w => wallCoversFoot(w, behind))!
    expect(foreground).toMatchObject({ x: 8, y: 7 })
    expect(compareDepth({ depth: behind.y, order: 1 }, { depth: foreground.depth, order: 2 })).toBeLessThan(0)
    for (const key of ['chamber', 'front', 'beside'] as const) {
      const foot = groundPoint(poses[key].x, poses[key].y)
      expect(walls.some(w => wallCoversFoot(w, foot)), key).toBe(false)
    }
    expect(compareDepth({ depth: 256, order: 1 }, { depth: 256, order: 2 })).toBeLessThan(0)
    // Door preview slider stays on the contiguous three-cell doorway path.
    for (const y of [6.65, 7.45, 8.65]) expect(solid(7, Math.floor(y))).toBe(false)
  })

  it('loads exactly four small experimental PNGs with the intended dimensions', () => {
    const root = resolve(import.meta.dirname, '../..')
    expect(Object.values(TEST_ASSETS)).toHaveLength(4)
    for (const [key, path] of Object.entries(TEST_ASSETS)) {
      const file = resolve(root, 'public', path.slice(1)), png = readFileSync(file)
      expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      expect([png.readUInt32BE(16), png.readUInt32BE(20)], key).toEqual([256, 256])
      expect(statSync(file).size).toBeLessThan(220_000)
      expect(png[25]).toBe(key === 'explorer' ? 6 : 2)
    }
    const source = readFileSync(resolve(root, 'src/dev/angkorV2Projection.ts'), 'utf8')
    expect(source).toContain('if (import.meta.env.DEV)')
    expect(source).not.toMatch(/from ['"].*(?:game\/engine|replay|reward|payout)/)
    expect(readFileSync(resolve(root, 'dev/angkor-v2-projection.html'), 'utf8')).toContain('/src/dev/angkorV2Projection.ts')
  })
})
