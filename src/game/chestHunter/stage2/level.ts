import { compileTraversalMap } from '../../traversal/angkorV2/map.js'
import type { EnvironmentSprite } from '../../rendering/angkorV2/types.js'
import type { ChestPlacement } from '../../systems/chests.js'
import type { GridCoord } from '../../world/grid.js'
export interface Zone { name: string; x: number; y: number; width: number; height: number }
export const inZone = (p: GridCoord, z: Zone) => p.x >= z.x && p.x < z.x + z.width && p.y >= z.y && p.y < z.y + z.height
export const AREAS: readonly Zone[] = [
  { name: 'Descent Hall', x: 2, y: 17, width: 9, height: 5 },
  { name: 'Twin Archives', x: 2, y: 2, width: 12, height: 7 },
  { name: 'Pressure Gallery', x: 15, y: 10, width: 8, height: 6 },
  { name: 'Serpent Stacks', x: 2, y: 10, width: 10, height: 5 },
  { name: 'Plunder Hall', x: 23, y: 2, width: 7, height: 13 },
  { name: 'Sealed Treasury Passage', x: 23, y: 17, width: 7, height: 5 },
]
const cells = Array.from({ length: 24 }, () => Array<string>(32).fill('#'))
function carve(x: number, y: number, w: number, h: number) { for (let row=y;row<y+h;row++) for(let col=x;col<x+w;col++) cells[row][col]='.' }
AREAS.forEach(a => carve(a.x,a.y,a.width,a.height))
carve(3,15,2,2); carve(4,9,2,1); carve(14,5,9,3); carve(18,8,2,2)
carve(12,13,3,2); carve(21,12,3,2); carve(24,15,2,2)
carve(15,16,2,5); carve(11,20,4,2)
cells[20][3]='S'; cells[16][3]='B'; cells[9][4]='D'; cells[13][14]='D'; cells[7][21]='B'; cells[16][24]='D'
// Entry treasure is seen across a low divider, but its ONLY entry is the plate gate.
for(let y=17;y<=21;y++) cells[y][6]=y===18 ? 'L' : 'T'
for(const x of [7,8,10]) cells[20][x]='T'
// Twin sealed archives: key gate into A, rear breach into B, no bypass entrance.
for(let y=2;y<=5;y++) { cells[y][2]='T'; cells[y][6]=y===3?'B':'T'; cells[y][7]=y===3?'B':'T'; cells[y][11]=y===3?'L':'T' }
for(const x of [3,5,8,9,10]) cells[5][x]=x===9?'L':'T'
cells[5][4]='.'; cells[3][6]='.'; cells[3][7]='B'
// Narrow stacks with a south return; long upper gallery has repeated carved pillars.
for(let y=10;y<=12;y++) cells[y][6]=y===11?'L':'T'
for(const x of [15,18,21]) cells[5][x]='P'
cells[4][12]='P'; cells[11][16]='P'; cells[14][21]='G'
// Plunder alcoves are visible around low ruined separators, reached at their ends.
for(let y=3;y<=5;y++) cells[y][26]=y===4?'L':'T'
for(let y=10;y<=12;y++) cells[y][26]=y===11?'L':'T'
cells[2][27]='T'; cells[9][28]='T'; cells[7][24]='P'; cells[13][29]='P'
for(const x of [26,28]) cells[18][x]='T'
cells[17][27]='T'; cells[20][25]='G'
const compiled = compileTraversalMap({ id: 'chest-hunter-v2-forgotten-galleries', name: 'Forgotten Galleries', rows: cells.map(r=>r.join('')) })
export const stageMap = { ...compiled, visual: { ...compiled.visual, cells: compiled.visual.cells.map((row,y)=>row.map((cell,x)=>({ ...cell, floor: (['weathered','mossy','root-damaged','cracked'] as const)[(x*5+y*3)%4] }))) } }
export const CHEST_REQUIREMENT=5
export const CHESTS: readonly ChestPlacement[] = [
  { id:'descent-cache',x:7,y:18,loot:'GEMS' },
  { id:'archive-west',x:4,y:3,loot:'POTION' },
  { id:'archive-east',x:9,y:3,loot:'EMPTY' },
  { id:'stack-trap',x:9,y:11,loot:'TRAP' },
  { id:'stack-cache',x:3,y:11,loot:'GEMS' },
  { id:'plate-cache',x:20,y:11,loot:'SWORD' },
  { id:'plunder-low',x:27,y:12,loot:'GEMS' },
  { id:'plunder-high',x:27,y:4,loot:'POTION' },
]
export const KEY={id:'silver-archive-key',x:12,y:7} as const
export const GATE: GridCoord={x:4,y:5}
export const PRESSURE_GATE: GridCoord={x:9,y:20}
export const PLATE: GridCoord={x:18,y:13}
export const EXIT: GridCoord={x:27,y:18}
export const BOULDERS=[{id:'plate-stone',x:18,y:12,minY:12,maxY:14}] as const
export const SPIKES=[{id:'plunder-spikes',tiles:[{x:24,y:11},{x:25,y:11}]}] as const
export const SNAKES=[
  {id:'west-stacks',zone:{name:'West stacks',x:2,y:11,width:4,height:4},path:[{x:4,y:12},{x:5,y:12},{x:5,y:13},{x:4,y:13}]},
  {id:'east-stacks',zone:{name:'East stacks',x:7,y:10,width:5,height:5},path:[{x:8,y:12},{x:9,y:12},{x:10,y:12},{x:10,y:13},{x:9,y:13},{x:8,y:13}]},
] as const
export const MONKEY={zone:{name:'Plunder pressure',x:24,y:3,width:6,height:11},perches:[{x:27,y:2},{x:28,y:9}]} as const
export const DECOR: readonly EnvironmentSprite[]=[
 {key:'root-corner-wrap-height-v2',x:199,y:608}, {key:'vine-hanging-v2',x:103,y:553,depthClass:'foreground'},
 {key:'root-wall-climb-height-v2',x:186,y:376}, {key:'root-heavy-v2',x:211,y:129,depthClass:'foreground'},
 {key:'root-wall-climb-height-v2',x:371,y:170}, {key:'root-floor-b-v2',x:302,y:281,depthClass:'floor-overlay'},
 {key:'statue-fragment-height-v2',x:435,y:273}, {key:'root-corner-wrap-height-v2',x:519,y:165},
 {key:'vine-hanging-v2',x:616,y:178,depthClass:'foreground'}, {key:'root-floor-a-v2',x:584,y:468,depthClass:'floor-overlay'},
 {key:'rubble-small-b-v2',x:520,y:478,depthClass:'floor-overlay'}, {key:'pillar-broken-height-v2',x:674,y:332},
 {key:'root-heavy-v2',x:864,y:252,depthClass:'foreground'}, {key:'root-wall-climb-height-v2',x:923,y:149},
 {key:'rubble-small-a-v2',x:784,y:460,depthClass:'floor-overlay'}, {key:'root-corner-wrap-height-v2',x:743,y:589},
 {key:'fern-b-v2',x:946,y:686}, {key:'statue-fragment-height-v2',x:939,y:650},
]
