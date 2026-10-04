import { DIRECTION_VECTORS, type Direction, type GridCoord } from '../../world/grid'
import { EXIT, GATE, GEMS, KEY, POTION } from './level'
import { planStageMove, sameCell, type StageAction, type StageState } from './model'
/** Test-only actual legal moves; never patches game state or teleports actors. */
export function walkTo(read:()=>StageState,dispatch:(action:StageAction)=>unknown,target:GridCoord):void{
  const state=read(),queue=[{point:state.player,path:[] as Direction[]}],seen=new Set([state.player.x+','+state.player.y])
  for(let i=0;i<queue.length;i++){
    const node=queue[i]
    if(sameCell(node.point,target)){for(const direction of node.path)dispatch({type:'MOVE',direction});return}
    for(const direction of Object.keys(DIRECTION_VECTORS) as Direction[]){
      const plan=planStageMove({...state,player:node.point},direction)
      if(!plan||plan.push)continue
      const id=plan.to.x+','+plan.to.y;if(seen.has(id))continue
      seen.add(id);queue.push({point:plan.to,path:[...node.path,direction]})
    }
  }
  throw new Error('Unreachable Temple Approach tile '+target.x+','+target.y)
}
export function solveApproach(read:()=>StageState,dispatch:(action:StageAction)=>unknown,optional=true):void{
  if(optional){walkTo(read,dispatch,GEMS[0]);walkTo(read,dispatch,POTION);walkTo(read,dispatch,GEMS[1])}
  if(read().boulders[0].y===6){walkTo(read,dispatch,{x:13,y:7});dispatch({type:'MOVE',direction:'UP'})}
  walkTo(read,dispatch,KEY);walkTo(read,dispatch,GATE)
  if(optional)walkTo(read,dispatch,GEMS[2])
  const y=read().boulders[1].y
  if(y===10){walkTo(read,dispatch,{x:27,y:9});dispatch({type:'MOVE',direction:'DOWN'})}
  if(y===12){walkTo(read,dispatch,{x:27,y:13});dispatch({type:'MOVE',direction:'UP'})}
  // Already-occupied test fixtures still trigger a legal occupancy update.
  if(!read().pressurePlateActive){walkTo(read,dispatch,{x:28,y:12});dispatch({type:'MOVE',direction:'UP'})}
  walkTo(read,dispatch,EXIT)
}
