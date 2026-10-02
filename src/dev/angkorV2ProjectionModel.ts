// Experimental render geometry only. No production movement or collision imports.
export const TILE = 32
export const WALL_HEIGHT = 24
export const ROOM_SIZE = 12
export const ROOM = [
  '############',
  '############',
  '##..#......#',
  '##..#......#',
  '##..#......#',
  '##..#......#',
  '##..#......#',
  '##..###D#B##',
  '##.........#',
  '##......####',
  '##..########',
  '############',
] as const

export const TEST_ASSETS = {
  top: '/assets/game/angkor-v2/projection-test/wall-top-stone-test.png',
  face: '/assets/game/angkor-v2/projection-test/wall-face-courses-test.png',
  floor: '/assets/game/angkor-v2/projection-test/floor-weathered-moss-test.png',
  explorer: '/assets/game/angkor-v2/projection-test/explorer-camera-test.png',
} as const

export const cell = (x: number, y: number): string => ROOM[y]?.[x] ?? '#'
export const solid = (x: number, y: number) => cell(x, y) === '#'
export const groundPoint = (x: number, y: number) => ({ x: x * TILE, y: y * TILE })
export const poses = {
  chamber: { x: 8.5, y: 4.75, label: 'Inside chamber' },
  front: { x: 5.5, y: 8.65, label: 'In front of wall' },
  beside: { x: 3.55, y: 4.75, label: 'Beside corridor wall' },
  behind: { x: 8.5, y: 6.75, label: 'Behind foreground wall' },
  doorway: { x: 7.5, y: 7.45, label: 'Under doorway lintel' },
} as const
export type Pose = keyof typeof poses

export type WallCell = { x: number; y: number; depth: number; topY: number; south: boolean; east: boolean; west: boolean; north: boolean }
export const walls: WallCell[] = ROOM.flatMap((row, y) => [...row].flatMap((c, x) => c === '#' ? [{
  x, y, depth: (y + 1) * TILE, topY: y * TILE - WALL_HEIGHT,
  south: y === ROOM_SIZE - 1 || !solid(x, y + 1), east: !solid(x + 1, y), west: !solid(x - 1, y), north: !solid(x, y - 1),
}] : []))

// Stable ties: character first, masonry after. Height changes screen coverage,
// never the logical tile or foot position. Door beam sorts at its south base too.
export const compareDepth = (a: { depth: number; order: number }, b: { depth: number; order: number }) => a.depth - b.depth || a.order - b.order
export const wallCoversFoot = (wall: WallCell, foot: { x: number; y: number }) =>
  wall.south && foot.x >= wall.x * TILE && foot.x < (wall.x + 1) * TILE &&
  foot.y > wall.topY && foot.y <= wall.depth
