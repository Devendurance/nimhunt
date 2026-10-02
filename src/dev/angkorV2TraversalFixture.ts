import { compileTraversalMap, type TraversalMapTruth } from '../game/traversal/angkorV2/map'
import type { EnvironmentSprite } from '../game/rendering/angkorV2/environment'

/** Development traversal truth, not a mission blueprint. All solid symbols
 * and architecture footprints are explicit and independent of sprite alpha. */
export const traversalMapTruth: TraversalMapTruth = {
  id: 'angkor-v2-traversal-dev', name: 'Angkor V2 traversal QA',
  rows: [
    '##############################',
    '##############################',
    '##......######........########',
    '##....P.######........###...##',
    '##....................###...##',
    '##.S.............P....###...##',
    '##......##TTT#...........G..##',
    '#####..#######..............##',
    '#####DD#########..#######...##',
    '#####..#########..#######...##',
    '###.......######BB############',
    '###.......####.......#########',
    '###....P.............#########',
    '###.G...........P....#########',
    '###.......####..............##',
    '###.......####.....G........##',
    '#####..#######.......###....##',
    '#####..##########..#####..P.##',
    '#####..##########..#####....##',
    '##.......########..####L....##',
    '##.......######.............##',
    '##......C######.............##',
    '##############################',
    '##############################',
  ],
  structures: [{
    sprite: { key: 'temple-passage-closed-height-v2', x: 608, y: 80 },
    occupied: [{ x: 17, y: 1 }, { x: 18, y: 1 }, { x: 19, y: 1 }, { x: 17, y: 2 }, { x: 18, y: 2 }, { x: 19, y: 2 }],
  }],
}
export const traversalMap = compileTraversalMap(traversalMapTruth)
export const traversalNature: readonly EnvironmentSprite[] = [
  { key: 'root-wall-climb-height-v2', x: 328, y: 217, depthClass: 'foreground' },
  { key: 'root-corner-wrap-height-v2', x: 419, y: 243, depthClass: 'foreground' },
  { key: 'fern-a-v2', x: 132, y: 50, depthClass: 'foreground', depthY: 80 },
  { key: 'root-floor-a-v2', x: 221, y: 166 },
  { key: 'moss-cluster-v2', x: 408, y: 345, depthClass: 'foreground' },
  { key: 'rubble-small-a-v2', x: 573, y: 335 },
  { key: 'root-corner-wrap-height-v2', x: 754, y: 436, depthClass: 'foreground' },
  { key: 'fern-a-v2', x: 790, y: 416, depthClass: 'foreground' },
  { key: 'root-wall-climb-height-v2', x: 302, y: 571, depthClass: 'foreground' },
  { key: 'rubble-small-a-v2', x: 270, y: 689 },
]
