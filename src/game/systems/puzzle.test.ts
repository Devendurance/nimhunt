import { describe, expect, it } from 'vitest'
import { createRunState } from '../domain/runState'
import { ANGKOR_ROOM_01 as room, ROOM_01_CONTENTS as contents, ROOM_01_PUZZLE as objects } from '../world/room01'
import { type GridCoord, type GridRoom, type Direction } from '../world/grid'
import { commitPuzzleMove, createPuzzleState, resolvePuzzleMove, sameTile, type PuzzleState } from './puzzle'
import type { RoomContents } from './tileEntry'

const empty: RoomContents = { gems: [], hazards: [] }
const directions: Direction[] = ['UP', 'RIGHT', 'DOWN', 'LEFT']
const arena: GridRoom = { id: 'test', name: 'test', width: 5, height: 5, layout: Array(5).fill('.....'), playerStart: { x: 1, y: 2 } }
const fixtures = { boulders: [{ id: 'b', x: 2, y: 2 }], key: { x: 0, y: 0 }, gate: { x: 4, y: 0 }, shrine: { x: 3, y: 0 } }

describe('Puzzle rules', () => {
  it('pushes one boulder and player exactly one tile without mutating inputs', () => {
    const puzzle = createPuzzleState(fixtures)
    const run = createRunState()
    const t = resolvePuzzleMove(arena, empty, fixtures, run, puzzle, { x: 1, y: 2 }, 'RIGHT')
    expect(t.move.to).toEqual({ x: 2, y: 2 })
    expect(t.pushed).toEqual({ id: 'b', to: { x: 3, y: 2 } })
    const next = commitPuzzleMove(run, puzzle, t, empty, fixtures)
    expect(next.puzzle.boulderPositions[0]).toEqual({ id: 'b', x: 3, y: 2 })
    expect(puzzle.boulderPositions[0]).toEqual({ id: 'b', x: 2, y: 2 })
  })

  it.each(['wall', 'bounds', 'boulder', 'gem', 'key', 'gate', 'open gate', 'hazard', 'shrine'])('rejects pushing into %s', kind => {
    let board = arena
    const data = { ...fixtures }
    let puzzle = createPuzzleState(data)
    let items = empty
    let from = { x: 1, y: 2 }
    if (kind === 'wall') board = { ...arena, layout: ['.....', '.....', '...#.', '.....', '.....'] }
    if (kind === 'bounds') { puzzle = { ...puzzle, boulderPositions: [{ id: 'b', x: 4, y: 2 }] }; from = { x: 3, y: 2 } }
    if (kind === 'boulder') puzzle = { ...puzzle, boulderPositions: [...puzzle.boulderPositions, { id: 'second', x: 3, y: 2 }] }
    if (kind === 'gem') items = { ...empty, gems: [{ id: 'g', x: 3, y: 2 }] }
    if (kind === 'hazard') items = { ...empty, hazards: [{ x: 3, y: 2, type: 'POISON' }] }
    if (kind === 'key') data.key = { x: 3, y: 2 }
    if (kind === 'shrine') data.shrine = { x: 3, y: 2 }
    if (kind.includes('gate')) data.gate = { x: 3, y: 2 }
    if (kind === 'open gate') puzzle = { ...puzzle, gateState: 'OPEN', hasTempleKey: true }
    const run = createRunState()
    const t = resolvePuzzleMove(board, items, data, run, puzzle, from, 'RIGHT')
    expect(t.move.success).toBe(false)
    expect(t.move.to).toEqual(from)
    expect(commitPuzzleMove(run, puzzle, t, items, data)).toEqual({ run, puzzle })
  })

  it('collects a key once and marks it used through the open gate state', () => {
    const run = createRunState()
    let puzzle = createPuzzleState(fixtures)
    const enterKey = resolvePuzzleMove(arena, empty, fixtures, run, puzzle, { x: 1, y: 0 }, 'LEFT')
    puzzle = commitPuzzleMove(run, puzzle, enterKey, empty, fixtures).puzzle
    expect(puzzle.hasTempleKey).toBe(true)
    expect(commitPuzzleMove(run, puzzle, enterKey, empty, fixtures).puzzle).toEqual(puzzle)
    const gate = resolvePuzzleMove(arena, empty, fixtures, run, puzzle, { x: 3, y: 0 }, 'RIGHT')
    expect(gate.opensGate).toBe(true)
    puzzle = commitPuzzleMove(run, puzzle, gate, empty, fixtures).puzzle
    expect(puzzle).toMatchObject({ gateState: 'OPEN', hasTempleKey: true })
    expect(resolvePuzzleMove(arena, empty, fixtures, run, puzzle, { x: 3, y: 0 }, 'RIGHT').opensGate).toBe(false)
    expect(createPuzzleState(fixtures)).toMatchObject({ gateState: 'LOCKED', hasTempleKey: false, objectiveReached: false, boulderPositions: fixtures.boulders })
  })

  it('blocks the gate without a key', () => {
    const t = resolvePuzzleMove(arena, empty, fixtures, createRunState(), createPuzzleState(fixtures), { x: 3, y: 0 }, 'RIGHT')
    expect(t.blockedReason).toBe('KEY_REQUIRED')
    expect(t.move.to).toEqual({ x: 3, y: 0 })
  })

  it.each(['FAILED', 'MISSION_COMPLETE'] as const)('rejects every puzzle interaction in %s', runStatus => {
    const run = { ...createRunState(), runStatus }
    const puzzle = createPuzzleState(fixtures)
    const t = resolvePuzzleMove(arena, empty, fixtures, run, puzzle, { x: 1, y: 2 }, 'RIGHT')
    expect(t.move.success).toBe(false)
    expect(commitPuzzleMove(run, puzzle, { ...t, move: { ...t.move, success: true, to: fixtures.key } }, empty, fixtures)).toEqual({ run, puzzle })
  })
})

// Reachability with object collisions, no pushing and no hazard entry.
function flood(puzzle: PuzzleState, start: GridCoord, excluded?: GridCoord) {
  const queue = [start]
  const visited = new Set([JSON.stringify(start)])
  for (let i = 0; i < queue.length; i++) for (const direction of directions) {
    const t = resolvePuzzleMove(room, contents, objects, createRunState(), puzzle, queue[i], direction)
    if (!t.move.success || t.pushed || contents.hazards.some(h => sameTile(h, t.move.to)) || (excluded && sameTile(excluded, t.move.to))) continue
    const key = JSON.stringify(t.move.to)
    if (!visited.has(key)) { visited.add(key); queue.push(t.move.to) }
  }
  return queue
}

describe('Room 01 required puzzle route', () => {
  it('has a visible chamber containing three gems, inaccessible while locked', () => {
    const reachable = flood(createPuzzleState(objects), room.playerStart)
    expect(reachable.some(p => sameTile(p, objects.key))).toBe(false)
    expect(reachable.some(p => sameTile(p, objects.shrine))).toBe(false)
    expect(contents.gems.filter(g => reachable.some(p => sameTile(p, g)))).toHaveLength(5)
  })

  it.each(['UP', 'DOWN'] as const)('allows a hazard-free %s push, key pickup, gate opening and shrine entry', direction => {
    let puzzle = createPuzzleState(objects)
    const from = { x: 4, y: direction === 'UP' ? 7 : 5 }
    expect(flood(puzzle, room.playerStart).some(p => sameTile(p, from))).toBe(true)
    const push = resolvePuzzleMove(room, contents, objects, createRunState(), puzzle, from, direction)
    expect(push.move.success).toBe(true)
    puzzle = commitPuzzleMove(createRunState(), puzzle, push, contents, objects).puzzle
    expect(flood(puzzle, push.move.to).some(p => sameTile(p, objects.key))).toBe(true)
    const key = resolvePuzzleMove(room, contents, objects, createRunState(), puzzle, { x: 4, y: 6 }, 'LEFT')
    puzzle = commitPuzzleMove(createRunState(), puzzle, key, contents, objects).puzzle
    expect(flood(puzzle, objects.key).some(p => sameTile(p, objects.gate))).toBe(true)
    const gate = resolvePuzzleMove(room, contents, objects, createRunState(), puzzle, { x: 7, y: 3 }, 'RIGHT')
    puzzle = commitPuzzleMove(createRunState(), puzzle, gate, contents, objects).puzzle
    expect(puzzle.gateState).toBe('OPEN')
    const shrine = resolvePuzzleMove(room, contents, objects, createRunState(), puzzle, objects.gate, 'RIGHT')
    const next = commitPuzzleMove(createRunState(), puzzle, shrine, contents, objects)
    expect(next.puzzle.objectiveReached).toBe(true)
    expect(next.run.runStatus).toBe('PLAYING')
    const withoutShrine = flood(puzzle, room.playerStart, objects.shrine)
    expect(contents.gems.filter(g => withoutShrine.some(p => sameTile(p, g)))).toHaveLength(5)
    expect(contents.gems.every(g => flood(puzzle, objects.shrine).some(p => sameTile(p, g)))).toBe(true)
  })
})
