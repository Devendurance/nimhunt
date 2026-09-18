import {
  type Direction,
  type GridCoord,
  type GridRoom,
  DIRECTION_VECTORS,
  getTileAt,
  isWalkableTile,
  isWithinBounds,
} from '../world/grid.js'

export interface MoveResult {
  readonly success: boolean
  readonly from: GridCoord
  readonly to: GridCoord
  readonly facing: Direction
  readonly reason?: 'BLOCKED_BY_WALL' | 'OUT_OF_BOUNDS' | 'INVALID_DIRECTION'
}

/**
 * Pure deterministic movement function.
 * Evaluates target coordinates, checks wall collisions and room boundaries.
 * Guarantees zero float positions, zero diagonal movement, and atomic single-tile steps.
 */
export function calculateMove(
  room: GridRoom,
  current: GridCoord,
  direction: Direction,
): MoveResult {
  const vector = DIRECTION_VECTORS[direction]
  if (!vector) {
    return {
      success: false,
      from: current,
      to: current,
      facing: direction,
      reason: 'INVALID_DIRECTION',
    }
  }

  const target: GridCoord = {
    x: current.x + vector.x,
    y: current.y + vector.y,
  }

  // 1. Boundary check
  if (!isWithinBounds(target, room.width, room.height)) {
    return {
      success: false,
      from: current,
      to: current,
      facing: direction,
      reason: 'OUT_OF_BOUNDS',
    }
  }

  // 2. Tile walkability check
  const tile = getTileAt(room, target)
  if (!isWalkableTile(tile)) {
    return {
      success: false,
      from: current,
      to: current,
      facing: direction,
      reason: 'BLOCKED_BY_WALL',
    }
  }

  // 3. Valid single-tile move
  return {
    success: true,
    from: current,
    to: target,
    facing: direction,
  }
}
