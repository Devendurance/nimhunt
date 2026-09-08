import type { GridRoom } from './grid'
import type { PuzzleObjects } from '../systems/puzzle'
import type { RoomContents } from '../systems/tileEntry'

export const ROOM_01_CONTENTS: RoomContents = {
  gems: [[2, 3], [1, 1], [5, 1], [9, 1], [10, 4], [10, 8], [5, 8], [1, 8]].map(([x, y], i) => ({ id: `room01-gem-${i + 1}`, x, y })),
  hazards: [{ x: 5, y: 3, type: 'SPIKES' }, { x: 6, y: 6, type: 'POISON' }],
}

/**
 * Angkor Ruins - Room 01 (Sanctuary Antechamber)
 *
 * Dimensions: 12 columns x 10 rows (384px x 320px at 32px per tile).
 * Legend:
 *   '#' = Wall (blocking)
 *   '.' = Stone floor (walkable)
 *   'S' = Player start point (walkable, at x=3, y=3)
 */
export const ANGKOR_ROOM_01: GridRoom = {
  id: 'angkor_01',
  name: 'Angkor Ruins · Room 01',
  width: 12,
  height: 10,
  playerStart: { x: 3, y: 3 },
  layout: [
    '############',
    '#.......#..#',
    '#..##..##..#',
    '#..S.......#',
    '#..##...#..#',
    '#..#....##.#',
    '#.#.....##.#',
    '#..#....#..#',
    '#.......#..#',
    '############',
  ],
}

export const ROOM_01_PUZZLE: PuzzleObjects = {
  boulders: [{ id: 'room01-boulder-1', x: 4, y: 6 }],
  key: { x: 3, y: 6 }, gate: { x: 8, y: 3 }, shrine: { x: 9, y: 3 },
}
