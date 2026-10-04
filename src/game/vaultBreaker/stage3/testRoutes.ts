import { DIRECTION_VECTORS,type Direction,type GridCoord } from '../../world/grid'
import { ANCHORS,FINAL_BAIT,GEMS,POTION,SHRINE } from './level'
import { planStageMove,sameCell,type StageState,type StageAction } from './model'
/** Legal reducer inputs only; fixture helpers never teleport or grant objectives. */
export function walkTo(read:()=>StageState,dispatch:(a:StageAction)=>unknown,target:GridCoord){
 const s=read(),queue=[{p:s.player,path:[] as Direction[]}],seen=new Set([s.player.x+','+s.player.y])
 for(let i=0;i<queue.length;i++){
  const {p,path}=queue[i];if(sameCell(p,target)){for(const direction of path)dispatch({type:'MOVE',direction});return}
  for(const direction of Object.keys(DIRECTION_VECTORS) as Direction[]){
   const move=planStageMove({...s,player:p},direction);if(!move||(!sameCell(target,SHRINE)&&sameCell(move.to,SHRINE)))continue
   const key=move.to.x+','+move.to.y;if(seen.has(key))continue;seen.add(key);queue.push({p:move.to,path:[...path,direction]})
  }
 }
 throw new Error('Unreachable Inner Vault tile '+target.x+','+target.y)
}
export function waitFor(read:()=>StageState,dispatch:(a:StageAction)=>unknown,predicate:(s:StageState)=>boolean,max=150){
 for(let i=0;!predicate(read())&&i<max;i++)dispatch({type:'TICK'})
 if(!predicate(read()))throw new Error('Boss condition did not occur')
}
export function bait(read:()=>StageState,dispatch:(a:StageAction)=>unknown,target:GridCoord){
 if(read().golem.mode==='DORMANT')walkTo(read,dispatch,{x:21,y:15})
 walkTo(read,dispatch,target)
 waitFor(read,dispatch,s=>s.golem.mode==='WINDUP'&&sameCell(s.golem.target!,target))
 const cells=read().golem.telegraphedCells
 const safe=[{x:target.x,y:target.y+2},{x:target.x-2,y:target.y},{x:target.x+2,y:target.y}].find(p=>!cells.some(c=>sameCell(c,p))&&planStageMove({...read(),player:{x:p.x,y:p.y-1}},'DOWN'))!
 if(!safe)throw new Error('No authored safe escape')
 walkTo(read,dispatch,safe);waitFor(read,dispatch,s=>s.golem.mode!=='WINDUP')
}
export function solveVault(read:()=>StageState,dispatch:(a:StageAction)=>unknown,optional=true){
 if(optional){walkTo(read,dispatch,GEMS[0]);walkTo(read,dispatch,GEMS[1]);walkTo(read,dispatch,POTION)}
 for(const anchor of [ANCHORS[2],ANCHORS[0],ANCHORS[1]])bait(read,dispatch,anchor.bait)
 bait(read,dispatch,FINAL_BAIT)
 if(optional)walkTo(read,dispatch,GEMS[2])
 walkTo(read,dispatch,SHRINE)
}
