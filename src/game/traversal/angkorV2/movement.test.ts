import { describe, expect, it } from 'vitest'
import { TileTraversal, ANGKOR_V2_MOVE_MS, type TraversalMove } from './movement'
import { calculateMove } from '../../systems/movement'
import { PLAYER_MOVE_DURATION_MS } from '../../config/timing'
import { ANGKOR_ROOM_01 } from '../../world/room01'
import type { Direction, GridRoom } from '../../world/grid'

const room: GridRoom = { id: 'test', name: 'test', width: 7, height: 5, playerStart: { x: 2, y: 2 }, layout: ['#######', '#.....#', '#.S...#', '#.....#', '#######'] }
const setup = () => { const moves: TraversalMove[] = []; return { moves, traversal: new TileTraversal(room, move => moves.push(move)) } }
describe('Angkor V2 sequential traversal', () => {
  it('holds legal tile moves identical to repeated calculateMove, never overlaps or skips', () => {
    const { moves, traversal: t } = setup()
    t.press('touch', 'RIGHT'); t.update(0)
    t.update(100); expect(moves).toHaveLength(1); expect(t.position).toEqual(room.playerStart)
    t.update(45); expect(moves).toHaveLength(2)
    t.update(145); t.update(145); t.update(10000)
    expect(moves).toHaveLength(3); expect(t.position).toEqual({ x: 5, y: 2 }); expect(t.moving).toBe(false)
    let position = room.playerStart
    moves.forEach((move, index) => {
      const repeated = calculateMove(room, position, 'RIGHT')
      expect(move).toEqual({ seq: index + 1, type: 'MOVE', direction: 'RIGHT', from: position, to: repeated.to })
      expect(Math.abs(move.to.x - move.from.x) + Math.abs(move.to.y - move.from.y)).toBe(1)
      position = repeated.to
    })
  })
  it('buffers exactly one latest turn, including a short tap released before completion', () => {
    const { moves, traversal: t } = setup()
    t.press('up', 'UP'); t.update(0); t.update(100)
    t.press('left', 'LEFT'); t.release('left')
    t.press('right', 'RIGHT'); t.release('right')
    expect(t.bufferedDirection).toBe('RIGHT'); expect(moves).toHaveLength(1)
    t.update(45)
    expect(moves.map(move => move.direction)).toEqual(['UP', 'RIGHT'])
    expect(moves[1].from).toEqual(moves[0].to)
    t.release('up'); t.update(145); expect(moves).toHaveLength(2)
    expect(t.position).toEqual({ x: 3, y: 1 })
  })
  it('ignores OS/source repeats, handles multiple holds and stops after release', () => {
    const { moves, traversal: t } = setup()
    t.press('key-w', 'UP'); t.update(0)
    t.press('key-w', 'UP'); expect(t.bufferedDirection).toBeUndefined()
    t.press('touch', 'RIGHT'); t.update(145); t.release('touch')
    t.update(145) // held UP is blocked at the north boundary
    expect(moves.map(move => move.direction)).toEqual(['UP', 'RIGHT'])
    t.clearInput(); t.update(145); expect(t.moving).toBe(false)
  })
  it('uses single-tile timing and bounded carry even after a suspended frame', () => {
    const { moves, traversal: t } = setup()
    expect(t.durationMs).toBe(145); expect(ANGKOR_V2_MOVE_MS).toBe(145)
    t.press('right', 'RIGHT'); t.update(0); t.update(10000)
    expect(moves).toHaveLength(2); expect(t.position).toEqual({ x: 3, y: 2 })
    expect(t.progress).toBeLessThanOrEqual(16 / 145)
    expect(t.foot.y).toBe(80); expect(t.foot.x).toBeGreaterThanOrEqual(112); expect(t.foot.x).toBeLessThan(144)
  })
  it('rejects walls/invalid directions, clears cancelled input and resets active movement', () => {
    const { moves, traversal: t } = setup()
    t.press('touch', 'LEFT'); t.cancel('touch'); t.update(0); expect(moves).toHaveLength(0)
    expect(() => t.tap('UP_LEFT' as Direction)).toThrow()
    t.tap('DOWN'); t.update(0); t.reset(); t.update(1000)
    expect(t.position).toEqual(room.playerStart); expect(t.seq).toBe(0); expect(t.moving).toBe(false)
    expect(() => t.update(Number.NaN)).toThrow()
  })
  it('preserves V1 timing and collision outcomes', () => {
    expect(PLAYER_MOVE_DURATION_MS).toBe(160)
    expect(calculateMove(ANGKOR_ROOM_01, { x: 3, y: 3 }, 'RIGHT')).toMatchObject({ success: true, to: { x: 4, y: 3 } })
    expect(calculateMove(ANGKOR_ROOM_01, { x: 3, y: 3 }, 'DOWN')).toMatchObject({ success: false, reason: 'BLOCKED_BY_WALL', to: { x: 3, y: 3 } })
  })
})
