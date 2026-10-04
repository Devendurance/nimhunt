import { compileTraversalMap } from '../../traversal/angkorV2/map'
import type { EnvironmentSprite } from '../../rendering/angkorV2/environment'
import type { GridCoord } from '../../world/grid'
import { inZone, type Zone } from '../stage1/level'
export { inZone }
export type RotaryState = 'A' | 'B' | 'C'
export const AREAS: readonly Zone[] = [
  { name:'Mechanism Foyer',x:2,y:21,width:9,height:3 },
  { name:'Counterweight Hall',x:2,y:13,width:9,height:7 },
  { name:'Rotary Gallery',x:12,y:10,width:13,height:7 },
  { name:'Relay Chamber',x:21,y:14,width:9,height:5 },
  { name:'Guardian Run',x:14,y:4,width:16,height:5 },
  { name:'Inner Lock',x:24,y:1,width:6,height:6 },
]
const cells=Array.from({length:26},()=>Array<string>(32).fill('T'))
function carve(x:number,y:number,width:number,height:number){for(let row=y;row<y+height;row++)for(let col=x;col<x+width;col++)cells[row][col]='.'}
carve(2,21,9,3);carve(4,19,2,2);carve(2,13,9,7)
carve(11,14,1,1);carve(11,18,1,1)
carve(12,10,8,7);carve(20,11,1,1);carve(21,9,4,4)
carve(20,15,1,1);carve(21,14,9,5)
carve(12,18,7,5) // Counterweight B's optional, independently sealed service recess.
carve(16,9,1,1);carve(16,7,2,2)
carve(14,4,16,3);carve(24,2,2,2);carve(26,1,4,2);carve(27,3,1,1)
cells[22][3]='S';cells[20][4]='B'
for(const p of [{x:11,y:14},{x:11,y:18},{x:20,y:11},{x:20,y:15},{x:16,y:9},{x:27,y:3}])cells[p.y][p.x]='D'
// Architectural sightlines, not a rectangular open field. Every solid is explicit.
cells[22][8]='P';cells[21][10]='G';cells[14][3]='P';cells[19][9]='C'
cells[10][13]='P';cells[16][18]='P';cells[12][22]='L'
for(const x of [24,25,26])cells[15][x]=x===25?'L':'T'
cells[17][23]='P';cells[18][29]='G';cells[20][16]='P'
cells[4][14]='G';cells[7][28]='G';cells[5][19]='P';cells[4][23]='L'
cells[1][27]='T';cells[1][29]='T'
const compiled=compileTraversalMap({id:'vault-breaker-v2-ancient-mechanism',name:'Ancient Mechanism',rows:cells.map(r=>r.join(''))})
export const stageMap={...compiled,visual:{...compiled.visual,cells:compiled.visual.cells.map((row,y)=>row.map((cell,x)=>({
  ...cell,floor:(['mossy','root-damaged','cracked','weathered'] as const)[(x*3+y*7)%4],material:'mossy' as const,
})))}}
export const BOULDERS=[{id:'counterweight-stone',x:6,y:16,minY:16,maxY:18}] as const
export const PLATE:GridCoord={x:6,y:17}
export const ROTARY:GridCoord={x:16,y:13}
export const CORE={id:'mechanism-core',x:27,y:16} as const
export const EXIT:GridCoord={x:28,y:2}
export const GATES=[
 {id:'counterweight-a',x:11,y:14},{id:'counterweight-b',x:11,y:18},
 {id:'rotary-a',x:20,y:11},{id:'relay',x:20,y:15},{id:'rotary-c',x:16,y:9},{id:'inner-lock',x:27,y:3},
] as const
export type GateId=typeof GATES[number]['id']
export const RELAY_REQUIREMENT:RotaryState='B',FINAL_REQUIREMENT:RotaryState='C'
/** Gate truth is shared by reducer, collision, scene and puzzle graph tests. */
export function linkedGates(plate:boolean,rotary:RotaryState,core:boolean):Record<GateId,boolean>{
  return {'counterweight-a':plate,'counterweight-b':!plate,'rotary-a':rotary==='A',relay:plate&&rotary===RELAY_REQUIREMENT,
    'rotary-c':rotary===FINAL_REQUIREMENT,'inner-lock':core&&plate&&rotary===FINAL_REQUIREMENT}
}
export const GEMS=[{id:'service-recess',x:17,y:20},{id:'rotary-recess',x:24,y:11},{id:'relay-cache',x:28,y:18}] as const
export const POTION={id:'service-potion',x:14,y:21} as const
export const SNAKES=[{id:'rotary-serpent',zone:{name:'Rotary recess patrol',x:21,y:9,width:4,height:4},path:[{x:22,y:10},{x:23,y:10},{x:23,y:11},{x:22,y:11}]}] as const
export const DART_TIMING={warning:8,flight:2,recovery:16} as const
export const DART_GUARDIANS=[
 {id:'hall-guardian',origin:{x:14,y:4},direction:'RIGHT',zone:{name:'First defense',x:15,y:4,width:8,height:3},lane:[15,16,17,18,19,20,21,22].map(x=>({x,y:4}))},
 {id:'lock-guardian',origin:{x:28,y:7},direction:'UP',zone:{name:'Inner defense',x:25,y:4,width:4,height:3},lane:[6,5,4].map(y=>({x:28,y}))},
] as const
export const DECOR:readonly EnvironmentSprite[]=[
 {key:'temple-passage-closed-height-v2',x:303,y:691,depthY:697,shadow:true},
 {key:'root-corner-wrap-height-v2',x:77,y:652},{key:'root-wall-climb-height-v2',x:339,y:601},
 {key:'pillar-broken-height-v2',x:276,y:734},{key:'vine-hanging-v2',x:94,y:425,depthClass:'foreground'},
 {key:'root-wall-climb-height-v2',x:374,y:422},{key:'root-heavy-v2',x:606,y:329,depthClass:'foreground'},
 {key:'root-floor-b-v2',x:438,y:704,depthClass:'floor-overlay'},{key:'statue-fragment-height-v2',x:586,y:613},
 {key:'root-corner-wrap-height-v2',x:803,y:414},{key:'root-wall-climb-height-v2',x:957,y:549},
 {key:'rubble-small-a-v2',x:757,y:574,depthClass:'floor-overlay'},{key:'root-heavy-v2',x:474,y:157,depthClass:'foreground'},
 {key:'vine-hanging-v2',x:735,y:161,depthClass:'foreground'},{key:'root-corner-wrap-height-v2',x:958,y:97},
]
