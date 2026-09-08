import { describe, expect, it } from 'vitest'
import { calculateMove } from './movement'
import { ANGKOR_ROOM_01 } from '../world/room01'
import {
  type Direction,
  type GridCoord,
  type GridRoom,
  getTileAt,
  isWalkableTile,
  isWithinBounds,
  tileToPixel,
} from '../world/grid'

describe('Deterministic Grid Movement & Collision', () => {
  it('loads Angkor Room 01 with valid dimensions and deterministic player spawn', () => {
    expect(ANGKOR_ROOM_01.width).toBe(12)
    expect(ANGKOR_ROOM_01.height).toBe(10)
    expect(ANGKOR_ROOM_01.playerStart).toEqual({ x: 3, y: 3 })

    const spawnTile = getTileAt(ANGKOR_ROOM_01, ANGKOR_ROOM_01.playerStart)
    expect(spawnTile).toBe('PLAYER_START')
    expect(isWalkableTile(spawnTile)).toBe(true)
  })

  it('allows a valid move to an adjacent floor tile and updates position by exactly 1 tile', () => {
    // At (3, 3), moving RIGHT moves to (4, 3) which is floor '.'
    const start: GridCoord = { x: 3, y: 3 }
    const result = calculateMove(ANGKOR_ROOM_01, start, 'RIGHT')

    expect(result.success).toBe(true)
    expect(result.from).toEqual({ x: 3, y: 3 })
    expect(result.to).toEqual({ x: 4, y: 3 })
    expect(result.facing).toBe('RIGHT')
    expect(result.reason).toBeUndefined()
  })

  it('rejects movement into a wall tile and leaves position unchanged', () => {
    // At (3, 3), moving DOWN moves to (3, 4) which is a stone pillar wall '#'
    const start: GridCoord = { x: 3, y: 3 }
    const result = calculateMove(ANGKOR_ROOM_01, start, 'DOWN')

    expect(result.success).toBe(false)
    expect(result.from).toEqual({ x: 3, y: 3 })
    expect(result.to).toEqual({ x: 3, y: 3 })
    expect(result.facing).toBe('DOWN')
    expect(result.reason).toBe('BLOCKED_BY_WALL')
  })

  it('rejects movement out of room bounds and preserves position', () => {
    const edgeCoord: GridCoord = { x: 0, y: 0 }
    const result = calculateMove(ANGKOR_ROOM_01, edgeCoord, 'UP')

    expect(result.success).toBe(false)
    expect(result.from).toEqual(edgeCoord)
    expect(result.to).toEqual(edgeCoord)
    expect(result.facing).toBe('UP')
    expect(result.reason).toBe('OUT_OF_BOUNDS')
  })

  it('rejects moving left out of bounds on the west border', () => {
    const westEdge: GridCoord = { x: 0, y: 5 }
    const result = calculateMove(ANGKOR_ROOM_01, westEdge, 'LEFT')

    expect(result.success).toBe(false)
    expect(result.to).toEqual(westEdge)
    expect(result.reason).toBe('OUT_OF_BOUNDS')
  })

  it('rejects invalid or non-orthogonal direction gracefully', () => {
    const current: GridCoord = { x: 3, y: 3 }
    const invalidDir = 'UP_LEFT' as unknown as Direction
    const result = calculateMove(ANGKOR_ROOM_01, current, invalidDir)

    expect(result.success).toBe(false)
    expect(result.to).toEqual(current)
    expect(result.reason).toBe('INVALID_DIRECTION')
  })

  it('correctly maps grid coordinates to center pixel coordinates', () => {
    const tile: GridCoord = { x: 0, y: 0 }
    const pixel = tileToPixel(tile, 32)
    expect(pixel).toEqual({ x: 16, y: 16 })

    const tile2: GridCoord = { x: 3, y: 3 }
    const pixel2 = tileToPixel(tile2, 32)
    expect(pixel2).toEqual({ x: 3 * 32 + 16, y: 3 * 32 + 16 }) // 112, 112
  })

  it('handles multi-step path navigation deterministically', () => {
    // Sequence: start at (3, 3) -> RIGHT to (4, 3) -> RIGHT to (5, 3) -> UP to (5, 2)
    let current = ANGKOR_ROOM_01.playerStart

    const step1 = calculateMove(ANGKOR_ROOM_01, current, 'RIGHT')
    expect(step1.success).toBe(true)
    expect(step1.to).toEqual({ x: 4, y: 3 })
    current = step1.to

    const step2 = calculateMove(ANGKOR_ROOM_01, current, 'RIGHT')
    expect(step2.success).toBe(true)
    expect(step2.to).toEqual({ x: 5, y: 3 })
    current = step2.to

    const step3 = calculateMove(ANGKOR_ROOM_01, current, 'UP')
    expect(step3.success).toBe(true)
    expect(step3.to).toEqual({ x: 5, y: 2 })
    current = step3.to

    // Confirm that from (5, 2), moving UP moves into (5, 1) which is floor '.'
    const step4 = calculateMove(ANGKOR_ROOM_01, current, 'UP')
    expect(step4.success).toBe(true)
    expect(step4.to).toEqual({ x: 5, y: 1 })
    current = step4.to

    // From (5, 1), moving UP moves into (5, 0) which is outer wall '#'
    const step5 = calculateMove(ANGKOR_ROOM_01, current, 'UP')
    expect(step5.success).toBe(false)
    expect(step5.to).toEqual({ x: 5, y: 1 })
    expect(step5.reason).toBe('BLOCKED_BY_WALL')
  })

  it('bounds helper correctly identifies inside vs outside coordinates', () => {
    const testRoom: GridRoom = {
      id: 'test',
      name: 'Test',
      width: 4,
      height: 4,
      layout: ['####', '#..#', '#..#', '####'],
      playerStart: { x: 1, y: 1 },
    }

    expect(isWithinBounds({ x: 0, y: 0 }, testRoom.width, testRoom.height)).toBe(true)
    expect(isWithinBounds({ x: 3, y: 3 }, testRoom.width, testRoom.height)).toBe(true)
    expect(isWithinBounds({ x: -1, y: 0 }, testRoom.width, testRoom.height)).toBe(false)
    expect(isWithinBounds({ x: 0, y: -1 }, testRoom.width, testRoom.height)).toBe(false)
    expect(isWithinBounds({ x: 4, y: 2 }, testRoom.width, testRoom.height)).toBe(false)
    expect(isWithinBounds({ x: 2, y: 4 }, testRoom.width, testRoom.height)).toBe(false)
  })
})
