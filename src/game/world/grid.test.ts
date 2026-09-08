import { describe, expect, it } from 'vitest'
import {
  parseTileChar,
  isWalkableTile,
  isWithinBounds,
  tileToPixel,
  getTileAt,
  TILE_SIZE,
} from './grid'
import { ANGKOR_ROOM_01 } from './room01'

describe('Grid Utilities and Room Parsing', () => {
  it('parses tile characters correctly', () => {
    expect(parseTileChar('#')).toBe('WALL')
    expect(parseTileChar('.')).toBe('FLOOR')
    expect(parseTileChar('S')).toBe('PLAYER_START')
    expect(parseTileChar('P')).toBe('PLAYER_START')
    expect(parseTileChar('?')).toBeNull()
    expect(parseTileChar('')).toBeNull()
    expect(parseTileChar(undefined)).toBeNull()
  })

  it('determines tile walkability accurately', () => {
    expect(isWalkableTile('FLOOR')).toBe(true)
    expect(isWalkableTile('PLAYER_START')).toBe(true)
    expect(isWalkableTile('WALL')).toBe(false)
    expect(isWalkableTile(null)).toBe(false)
  })

  it('checks coordinate bounds', () => {
    expect(isWithinBounds({ x: 0, y: 0 }, 10, 10)).toBe(true)
    expect(isWithinBounds({ x: 9, y: 9 }, 10, 10)).toBe(true)
    expect(isWithinBounds({ x: 10, y: 0 }, 10, 10)).toBe(false)
    expect(isWithinBounds({ x: 0, y: 10 }, 10, 10)).toBe(false)
    expect(isWithinBounds({ x: -1, y: 5 }, 10, 10)).toBe(false)
    expect(isWithinBounds({ x: 5, y: -1 }, 10, 10)).toBe(false)
  })

  it('computes center pixel coordinates using tile size', () => {
    expect(tileToPixel({ x: 0, y: 0 }, TILE_SIZE)).toEqual({ x: 16, y: 16 })
    expect(tileToPixel({ x: 1, y: 2 }, TILE_SIZE)).toEqual({ x: 48, y: 80 })
  })

  it('looks up tiles in ANGKOR_ROOM_01 accurately', () => {
    expect(getTileAt(ANGKOR_ROOM_01, { x: 0, y: 0 })).toBe('WALL')
    expect(getTileAt(ANGKOR_ROOM_01, { x: 1, y: 1 })).toBe('FLOOR')
    expect(getTileAt(ANGKOR_ROOM_01, { x: 3, y: 3 })).toBe('PLAYER_START')
    expect(getTileAt(ANGKOR_ROOM_01, { x: 11, y: 9 })).toBe('WALL')
    expect(getTileAt(ANGKOR_ROOM_01, { x: -1, y: 0 })).toBeNull()
    expect(getTileAt(ANGKOR_ROOM_01, { x: 12, y: 5 })).toBeNull()
  })
})
