export type Direction = 'UP' | 'DOWN' | 'LEFT' | 'RIGHT'

export type TileType = 'FLOOR' | 'WALL' | 'PLAYER_START'

export interface GridCoord {
  readonly x: number
  readonly y: number
}

export interface GridRoom {
  readonly id: string
  readonly name: string
  readonly width: number
  readonly height: number
  readonly layout: readonly string[]
  readonly playerStart: GridCoord
}

export const TILE_SIZE = 32

export const DIRECTION_VECTORS: Record<Direction, GridCoord> = {
  UP: { x: 0, y: -1 },
  DOWN: { x: 0, y: 1 },
  LEFT: { x: -1, y: 0 },
  RIGHT: { x: 1, y: 0 },
}

export function isWithinBounds(coord: GridCoord, width: number, height: number): boolean {
  return coord.x >= 0 && coord.x < width && coord.y >= 0 && coord.y < height
}

export function parseTileChar(char: string | undefined): TileType | null {
  if (!char) return null
  if (char === '#') return 'WALL'
  if (char === 'S' || char === 'P') return 'PLAYER_START'
  if (char === '.') return 'FLOOR'
  return null
}

export function getTileAt(room: GridRoom, coord: GridCoord): TileType | null {
  if (!isWithinBounds(coord, room.width, room.height)) {
    return null
  }
  const row = room.layout[coord.y]
  if (!row) return null
  return parseTileChar(row[coord.x])
}

export function isWalkableTile(tile: TileType | null): boolean {
  if (!tile) return false
  return tile === 'FLOOR' || tile === 'PLAYER_START'
}

export function tileToPixel(coord: GridCoord, tileSize: number = TILE_SIZE): { x: number; y: number } {
  return {
    x: coord.x * tileSize + tileSize / 2,
    y: coord.y * tileSize + tileSize / 2,
  }
}
