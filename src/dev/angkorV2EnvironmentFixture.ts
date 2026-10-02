import type { EnvironmentMap, FloorStyle, CellKind } from '../game/rendering/angkorV2/geometry'
import type { EnvironmentSprite } from '../game/rendering/angkorV2/environment'

// Development geometry only; never a Stage 1 blueprint or collision authority.
const rows = [
  '############',
  '############',
  '##..#......#',
  '##..#......#',
  '##..#......#',
  '##..#......#',
  '##..#......#',
  '##..###DTB##',
  '##.........#',
  '##......LC##',
  '##..########',
  '############',
] as const
// A second shape proves the builder is not a hardcoded room/background.
const alternateRows = [
  '############',
  '##.......###',
  '##.......###',
  '##...#...###',
  '##...#...###',
  '##...D...###',
  '###B##...###',
  '##.......###',
  '##..LT...###',
  '##..#....###',
  '##..######C#',
  '############',
] as const
const kinds: Record<string, CellKind> = { '#': 'wall', '.': 'floor', T: 'tall', L: 'low', C: 'collapsed', D: 'doorway', B: 'broken' }
const styles: FloorStyle[] = ['clean', 'weathered', 'cracked', 'mossy', 'root-damaged', 'debris']
export function environmentFixture(alternate = false): EnvironmentMap {
  return { cells: (alternate ? alternateRows : rows).map((row, y) => [...row].map((code, x) => ({ kind: kinds[code], floor: styles[(x + y * 3) % styles.length] }))) }
}
export const environmentPlacements: readonly EnvironmentSprite[] = [
  { key: 'temple-passage-open-height-v2', x: 280, y: 93, depthClass: 'foreground' },
  { key: 'guardian-statue-height-v2', x: 187, y: 114, shadow: true },
  { key: 'statue-fragment-height-v2', x: 215, y: 135, shadow: true },
  { key: 'pillar-intact-height-v2', x: 145, y: 256, depthClass: 'foreground' },
  { key: 'pillar-broken-height-v2', x: 78, y: 101, shadow: true },
  { key: 'root-wall-climb-height-v2', x: 352, y: 104, depthClass: 'foreground' },
  { key: 'root-corner-wrap-height-v2', x: 332, y: 260, depthClass: 'foreground' },
  { key: 'fern-a-v2', x: 173, y: 65, depthClass: 'foreground', depthY: 65 },
  { key: 'moss-cluster-v2', x: 195, y: 44, depthClass: 'foreground', depthY: 65 },
  { key: 'root-floor-a-v2', x: 111, y: 302 },
  { key: 'rubble-small-a-v2', x: 301, y: 255 },
  { key: 'blue-gem-v2', x: 315, y: 154, shadow: true },
  { key: 'spike-trap-idle-v2', x: 304, y: 192 },
  { key: 'pushable-boulder-v2', x: 337, y: 192, shadow: true },
] as const
export const environmentPoses = {
  chamber: { x: 272, y: 152 }, front: { x: 176, y: 277 }, beside: { x: 114, y: 152 },
  partial: { x: 176, y: 216 }, tall: { x: 272, y: 216 }, seam: { x: 224, y: 226 },
  pillar: { x: 145, y: 226 }, doorway: { x: 240, y: 239 },
} as const
