import { compileTraversalMap } from '../../traversal/angkorV2/map'
import type { EnvironmentSprite } from '../../rendering/angkorV2/environment'
import type { GridCoord } from '../../world/grid'
import { inZone, type Zone } from '../stage1/level'
export { inZone }
export const AREAS: readonly Zone[] = [
 {name:'Inner Lock Vestibule',x:2,y:21,width:9,height:3},
 {name:'Fractured Causeway',x:3,y:12,width:8,height:9},
 {name:'Guardian Antechamber',x:12,y:18,width:17,height:5},
 {name:'Golem Chamber',x:13,y:9,width:15,height:9},
 {name:'Broken Seal Passage',x:22,y:10,width:2,height:4},
 {name:'Inner Vault',x:25,y:10,width:5,height:3},
]
const cells=Array.from({length:26},()=>Array<string>(32).fill('T'))
function carve(x:number,y:number,w:number,h:number){for(let j=y;j<y+h;j++)for(let i=x;i<x+w;i++)cells[j][i]='.'}
carve(2,21,9,3);carve(4,19,2,2);carve(3,15,8,4);carve(8,12,3,3);carve(3,12,5,2)
carve(11,16,2,2);carve(12,18,17,5);carve(13,9,15,9)
// A single sealed throat leads to the final door. No cosmetic collision inference.
for(let y=9;y<=13;y++)for(let x=21;x<=30;x++)cells[y][x]='T'
carve(22,10,2,3);carve(25,10,5,3);carve(23,13,1,1);carve(24,12,1,1)
cells[22][3]='S';cells[20][4]='B';cells[17][11]='B'
for(const p of [{x:8,y:22},{x:3,y:17},{x:10,y:15},{x:12,y:20},{x:28,y:20},{x:14,y:10},{x:26,y:10},{x:13,y:16},{x:27,y:16},{x:26,y:10}])cells[p.y][p.x]='P'
cells[12][3]='G';cells[22][25]='G';cells[9][20]='G';cells[14][13]='L';cells[14][27]='L';cells[19][16]='C'
cells[13][23]='D';cells[12][24]='D'
const compiled=compileTraversalMap({id:'vault-breaker-v2-inner-vault',name:'Inner Vault',rows:cells.map(r=>r.join(''))})
export const stageMap={...compiled,visual:{...compiled.visual,cells:compiled.visual.cells.map((row,y)=>row.map((cell,x)=>({...cell,floor:(['mossy','root-damaged','cracked','weathered'] as const)[(x*5+y*3)%4],material:'mossy' as const})))}}
export const GOLEM_ROOT:readonly GridCoord[]=[{x:19,y:13},{x:20,y:13},{x:19,y:14},{x:20,y:14}]
export const GOLEM_FOOT={x:640,y:480}
export const GOLEM_ZONE:Zone={name:'Golem influence',x:13,y:5,width:15,height:13}
export const ACTIVATION_ZONE:Zone={name:'Guardian awakening',x:14,y:9,width:13,height:7}
export const ANCHORS=[
 {id:'west-anchor',x:15,y:14,bait:{x:16,y:14}},
 {id:'east-anchor',x:26,y:17,bait:{x:26,y:16}},
 {id:'south-anchor',x:20,y:17,bait:{x:20,y:16}},
] as const
export type AnchorId=typeof ANCHORS[number]['id']
export const SEAL_PASSAGE:readonly GridCoord[]=[{x:23,y:13}]
export const VAULT_DOOR:GridCoord={x:24,y:12},FINAL_BAIT:GridCoord={x:23,y:12},SHRINE:GridCoord={x:28,y:11}
export const GEMS=[{id:'threshold-gem',x:6,y:22},{id:'causeway-gem',x:5,y:13},{id:'vault-offering',x:29,y:10}] as const
export const POTION={id:'causeway-potion',x:9,y:14} as const
export const DART_TIMING={warning:8,flight:2,recovery:16} as const
export const DART_GUARDIANS=[{id:'causeway-guardian',origin:{x:3,y:12},zone:{name:'Causeway defense',x:4,y:12,width:7,height:3},lane:[4,5,6,7].map(x=>({x,y:12}))}] as const
export const GOLEM_TIMING={awakening:10,ready:4,windup:[14,12,10],smash:2,recovery:12,finalWindup:14} as const
export const DECOR:readonly EnvironmentSprite[]=[
 {key:'root-corner-wrap-height-v2',x:80,y:662},{key:'root-wall-climb-height-v2',x:340,y:706},
 {key:'root-heavy-v2',x:127,y:500,depthClass:'foreground'},{key:'vine-hanging-v2',x:328,y:412,depthClass:'foreground'},
 {key:'statue-fragment-height-v2',x:465,y:708},{key:'root-wall-climb-height-v2',x:928,y:637},
 {key:'root-corner-wrap-height-v2',x:433,y:294},{key:'root-heavy-v2',x:887,y:336,depthClass:'foreground'},
 {key:'rubble-small-a-v2',x:526,y:561,depthClass:'floor-overlay'},{key:'rubble-small-b-v2',x:746,y:394,depthClass:'floor-overlay'},
 {key:'root-wall-climb-height-v2',x:891,y:203},{key:'vine-hanging-v2',x:951,y:81,depthClass:'foreground'},
]
