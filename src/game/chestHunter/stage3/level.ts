import { compileTraversalMap } from '../../traversal/angkorV2/map.js'
import type { EnvironmentSprite } from '../../rendering/angkorV2/types.js'
import type { ChestPlacement } from '../../systems/chests.js'
import type { GridCoord } from '../../world/grid.js'
export interface Zone { name:string; x:number; y:number; width:number; height:number }
export const inZone=(p:GridCoord,z:Zone)=>p.x>=z.x&&p.x<z.x+z.width&&p.y>=z.y&&p.y<z.y+z.height
export const AREAS:readonly Zone[]=[
 {name:'Treasury Approach',x:2,y:21,width:14,height:4},
 {name:'Gilded Archives',x:2,y:2,width:11,height:7},
 {name:'Twin Seal Hall',x:17,y:17,width:7,height:8},
 {name:'Guardian Corridor',x:2,y:10,width:7,height:8},
 {name:'Plunder Chambers',x:19,y:2,width:11,height:12},
 {name:'Royal Vault',x:7,y:15,width:8,height:6},
]
const cells=Array.from({length:26},()=>Array<string>(32).fill('#'))
function carve(x:number,y:number,w:number,h:number){for(let r=y;r<y+h;r++)for(let c=x;c<x+w;c++)cells[r][c]='.'}
AREAS.forEach(a=>carve(a.x,a.y,a.width,a.height))
carve(6,18,1,3);carve(3,18,4,2);carve(4,9,2,1);carve(13,6,6,2);carve(9,12,10,2);carve(16,23,1,1)
cells[23][3]='S';cells[9][4]='D';cells[7][16]='B';cells[13][12]='B'
// A cache is glimpsed from entry over low masonry, reached from the guardian approach.
for(let x=2;x<=5;x++)cells[20][x]='L'
// Monumental vault: one pressure-controlled entrance, no side/rear bypass.
for(let y=15;y<=21;y++){cells[y][7]=y===19?'L':'T';cells[y][14]=y===19?'L':'T'}
for(let x=7;x<=14;x++){cells[15][x]='T';cells[21][x]=[9,11,12].includes(x)?'L':'T'}
cells[21][10]='.';cells[16][8]='P';cells[16][13]='G';cells[16][12]='T';cells[17][11]='T';cells[17][13]='T'
// Key pocket and visible alcoves: navigate around the south ends of carved partitions.
for(let y=2;y<=5;y++){cells[y][6]=y===3?'L':'T';cells[y][8]=y===3?'L':'T';cells[y][11]=y===3?'L':'T'}
cells[6][6]='.';cells[6][8]='.';cells[6][11]='.'
for(const x of [14,17])cells[6][x]='P'
// Guardian lanes have clear adjacent recesses and no mandatory standing targets.
cells[12][2]='G';cells[10][6]='G';cells[15][3]='P';cells[15][7]='P'
// Plunder chambers are sightline-broken alcoves, with precisely one monkey and snake.
for(let y=3;y<=5;y++)cells[y][26]=y===4?'L':'T'
for(let y=10;y<=12;y++)cells[y][24]=y===11?'L':'T'
cells[2][27]='T';cells[9][28]='T';cells[4][21]='P';cells[11][20]='P'
// The seal door is the ONLY entrance to the twin-track hall.
cells[23][15]='.';cells[22][14]='P';cells[23][8]='P';cells[18][17]='P';cells[18][23]='P'
const compiled=compileTraversalMap({id:'chest-hunter-v2-royal-treasury',name:'Royal Treasury',rows:cells.map(r=>r.join(''))})
export const stageMap={...compiled,visual:{...compiled.visual,cells:compiled.visual.cells.map((row,y)=>row.map((cell,x)=>({...cell,floor:(['cracked','mossy','root-damaged','weathered'] as const)[(x*3+y*5)%4]})))}}
export const CHEST_REQUIREMENT=6
export const ROYAL_CACHE_ID='royal-cache'
export const CHESTS:readonly ChestPlacement[]=[
 {id:'approach-cache',x:4,y:19,loot:'GEMS'},
 {id:'archive-heal',x:4,y:3,loot:'POTION'},
 {id:'archive-dust',x:6,y:6,loot:'EMPTY'},
 {id:'plunder-trap',x:25,y:11,loot:'TRAP'},
 {id:'archive-far',x:12,y:3,loot:'GEMS'},
 {id:'twin-blade',x:20,y:18,loot:'SWORD'},
 {id:'plunder-high',x:27,y:4,loot:'GEMS'},
 {id:'vault-heal',x:12,y:20,loot:'POTION'},
 {id:'guardian-cache',x:7,y:12,loot:'EMPTY'},
 {id:ROYAL_CACHE_ID,x:10,y:19,loot:'GEMS'},
]
export const KEY={id:'royal-seal-key',x:10,y:3} as const
export const GATE:GridCoord={x:15,y:23}
export const PRESSURE_GATE:GridCoord={x:10,y:21}
export const PLATES=[{id:'A',stoneId:'seal-stone-a',x:18,y:21},{id:'B',stoneId:'seal-stone-b',x:21,y:21}] as const
export const BOULDERS=[{id:'seal-stone-a',x:18,y:20,minY:20,maxY:22},{id:'seal-stone-b',x:21,y:20,minY:20,maxY:22}] as const
export const EXIT:GridCoord={x:12,y:17}
export const SNAKES=[{id:'plunder-serpent',zone:{name:'Plunder patrol',x:21,y:6,width:6,height:4},path:[{x:23,y:7},{x:24,y:7},{x:24,y:8},{x:23,y:8}]}] as const
export const MONKEY={zone:{name:'Plunder pressure',x:24,y:3,width:6,height:10},perches:[{x:27,y:2},{x:28,y:9}]} as const
export const DART_TIMING={warning:8,flight:2,recovery:16} as const
export const DART_GUARDIANS=[
 {id:'west-guardian',origin:{x:2,y:12},direction:'RIGHT',zone:{name:'West guardian tell',x:3,y:11,width:5,height:3},lane:[3,4,5,6,7].map(x=>({x,y:12}))},
 {id:'north-guardian',origin:{x:6,y:10},direction:'DOWN',zone:{name:'North guardian tell',x:5,y:13,width:3,height:3},lane:[11,12,13,14,15,16].map(y=>({x:6,y}))},
] as const
export const DECOR:readonly EnvironmentSprite[]=[
 {key:'root-corner-wrap-height-v2',x:225,y:729},{key:'root-wall-climb-height-v2',x:482,y:713},
 {key:'vine-hanging-v2',x:172,y:671,depthClass:'foreground'},{key:'root-heavy-v2',x:259,y:615,depthClass:'foreground'},
 {key:'root-wall-climb-height-v2',x:248,y:465},{key:'statue-fragment-height-v2',x:421,y:498},
 {key:'root-heavy-v2',x:280,y:127,depthClass:'foreground'},{key:'root-corner-wrap-height-v2',x:365,y:210},
 {key:'vine-hanging-v2',x:147,y:132,depthClass:'foreground'},{key:'pillar-broken-height-v2',x:80,y:274},
 {key:'root-wall-climb-height-v2',x:582,y:212},{key:'root-floor-a-v2',x:612,y:407,depthClass:'floor-overlay'},
 {key:'root-corner-wrap-height-v2',x:819,y:381},{key:'root-heavy-v2',x:860,y:247,depthClass:'foreground'},
 {key:'rubble-small-b-v2',x:674,y:607,depthClass:'floor-overlay'},{key:'root-floor-b-v2',x:688,y:752,depthClass:'floor-overlay'},
 {key:'root-wall-climb-height-v2',x:753,y:691},{key:'guardian-statue-height-v2',x:740,y:818},
 {key:'rubble-small-a-v2',x:162,y:553,depthClass:'floor-overlay'},{key:'fern-b-v2',x:299,y:786},
]
