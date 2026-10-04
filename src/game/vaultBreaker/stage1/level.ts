import { compileTraversalMap } from '../../traversal/angkorV2/map.js'
import type { EnvironmentSprite } from '../../rendering/angkorV2/types.js'
import type { GridCoord } from '../../world/grid.js'
export interface Zone { name: string; x: number; y: number; width: number; height: number }
export const inZone = (p: GridCoord, z: Zone) => p.x >= z.x && p.x < z.x + z.width && p.y >= z.y && p.y < z.y + z.height
export const AREAS: readonly Zone[] = [
  { name: 'Jungle Causeway', x: 2, y: 17, width: 9, height: 5 },
  { name: 'Broken Watch', x: 2, y: 9, width: 9, height: 5 },
  { name: 'Key Court', x: 11, y: 3, width: 8, height: 7 },
  { name: 'Outer Seal', x: 19, y: 3, width: 6, height: 5 },
  { name: 'Collapsing Passage', x: 21, y: 8, width: 4, height: 6 },
  { name: 'Mechanism Gate', x: 25, y: 2, width: 5, height: 13 },
]
const cells = Array.from({ length: 24 }, () => Array<string>(32).fill('T'))
function carve(x: number, y: number, width: number, height: number) {
  for (let row = y; row < y + height; row++) for (let col = x; col < x + width; col++) cells[row][col] = '.'
}
carve(2,17,9,5); carve(4,14,2,3); carve(2,9,9,5)
carve(9,10,4,2); carve(11,3,2,7); carve(13,7,6,3)
// The key alcove has exactly one entrance, blocked by the guided key stone.
carve(13,5,1,2); carve(14,6,4,1); carve(15,4,3,2)
carve(18,9,4,1); carve(21,3,4,5); carve(21,8,1,1)
for (const x of [14,15,16,17]) cells[7][x]='T'
// No route around the permanent seal: west/east halves meet only at (20,9).
carve(22,8,2,5); carve(23,13,4,1)
carve(25,9,5,6); carve(27,7,1,2); carve(26,2,4,5)
cells[20][3]='S'; cells[16][4]='B'; cells[9][4]='D'; cells[10][11]='B'
cells[9][20]='D'; cells[12][23]='B'; cells[7][27]='D'
// Ruined foreground sill reveals the sealed door without changing collision.
for (const x of [19,20,21]) cells[10][x]='L'
// Watch sightlines and safe snake bypass; sculpt the exterior without a courtyard.
for (const x of [5,6,7]) cells[11][x]='T'
cells[19][7]='P'; cells[18][9]='G'; cells[21][9]='L'; cells[10][3]='P'
cells[4][11]='P'; cells[8][17]='P'; cells[3][22]='G'; cells[7][24]='P'
cells[11][25]='L'; cells[14][28]='G'; cells[3][26]='T'; cells[3][29]='T'
const compiled = compileTraversalMap({ id: 'vault-breaker-v2-temple-approach', name: 'Temple Approach', rows: cells.map(row=>row.join('')) })
export const stageMap = { ...compiled, visual: { ...compiled.visual, cells: compiled.visual.cells.map((row,y)=>row.map((cell,x)=>({
  ...cell, floor: (y>=15 ? ['weathered','mossy','cracked'] as const : ['mossy','root-damaged','weathered','debris'] as const)[(x*5+y*3)%(y>=15?3:4)],
  material: y<9 ? 'mossy' as const : 'damaged' as const,
}))) } }
export const KEY = { id: 'bronze-vault-key', x: 16, y: 5 } as const
export const GATE: GridCoord = { x: 20, y: 9 }
export const PLATE: GridCoord = { x: 27, y: 11 }
export const PRESSURE_GATE: GridCoord = { x: 27, y: 7 }
export const EXIT: GridCoord = { x: 28, y: 4 }
/** Key stone has a permanent parking recess. Plate stone is reversible on its
 * three-cell rail; both ends are reachable via adjacent floor. */
export const BOULDERS = [
  { id: 'key-stone', x: 13, y: 6, minY: 5, maxY: 6, oneWay: true },
  { id: 'mechanism-stone', x: 27, y: 10, minY: 10, maxY: 12, oneWay: false },
] as const
export const GEMS = [{ id:'causeway',x:6,y:20 },{ id:'watch-recess',x:9,y:12 },{ id:'interior',x:24,y:5 }] as const
export const POTION = { id: 'watch-potion', x: 2, y: 12 } as const
export const SPIKES = [{ id:'watch-spikes',tiles:[{x:5,y:12},{x:6,y:12}]}] as const
export const SNAKES = [{ id:'watch-serpent',zone:{name:'Watch patrol',x:3,y:9,width:7,height:5},path:[{x:4,y:10},{x:4,y:11},{x:4,y:12},{x:4,y:13},{x:3,y:13},{x:4,y:13},{x:4,y:12},{x:4,y:11}]}] as const
export const MONKEY = { zone:{name:'Mechanism keeper',x:26,y:10,width:4,height:4},perches:[{x:30,y:10},{x:25,y:8}] } as const
export const RUBBLE = { id:'fractured-defensive-roof',zone:{name:'Rockfall',x:22,y:9,width:2,height:3},tiles:[{x:22,y:9},{x:22,y:10},{x:22,y:11}],tellTicks:10,recoveryTicks:14 } as const
export const DECOR: readonly EnvironmentSprite[] = [
  // Sealed fortress facade: solid wall behind it. Entry is around the watch,
  // through the actual keyed Outer Seal, rather than through this ruined front.
  {key:'temple-passage-closed-height-v2',x:272,y:540,depthY:548,shadow:true},
  {key:'root-heavy-v2',x:70,y:592,depthClass:'foreground'}, {key:'root-wall-climb-height-v2',x:336,y:588},
  {key:'fern-a-v2',x:81,y:705}, {key:'broadleaf-a-v2',x:317,y:701},
  {key:'root-corner-wrap-height-v2',x:105,y:455}, {key:'vine-hanging-v2',x:249,y:294,depthClass:'foreground'},
  {key:'statue-fragment-height-v2',x:287,y:322}, {key:'rubble-small-a-v2',x:242,y:438,depthClass:'floor-overlay'},
  {key:'root-wall-climb-height-v2',x:442,y:171}, {key:'root-corner-wrap-height-v2',x:595,y:274},
  {key:'root-floor-b-v2',x:383,y:294,depthClass:'floor-overlay'},
  {key:'root-heavy-v2',x:665,y:141,depthClass:'foreground'}, {key:'pillar-broken-height-v2',x:767,y:128},
  {key:'rubble-large-v2',x:715,y:291,depthClass:'floor-overlay'}, {key:'vine-hanging-v2',x:715,y:262,depthClass:'foreground'},
  {key:'root-wall-climb-height-v2',x:962,y:313}, {key:'root-corner-wrap-height-v2',x:819,y:471},
  {key:'statue-fragment-height-v2',x:947,y:489}, {key:'root-wall-climb-height-v2',x:868,y:72},
]
