import { DIRECTION_VECTORS, type Direction, type GridCoord } from '../../world/grid'
import { CHESTS, EXIT, GATE, KEY, PRESSURE_GATE, PLATES, ROYAL_CACHE_ID, BOULDERS } from './level'
import { planStageMove, sameCell, type StageAction, type StageState } from './model'
/** Test-only solver: every transition uses real cardinal MOVE authority. */
export function solveTreasure(read:()=>StageState, dispatch:(a:StageAction)=>StageState) {
  const walk=(goal:GridCoord)=>{
    for(let n=0;n<300;n++) {
      const state=read();if(sameCell(state.player,goal))return
      const queue=[{p:state.player,path:[] as Direction[]}],seen=new Set<string>();let path:Direction[]|undefined
      for(let i=0;i<queue.length;i++) {
        const {p,path:route}=queue[i];if(sameCell(p,goal)){path=route;break}
        for(const direction of Object.keys(DIRECTION_VECTORS) as Direction[]) {
          const plan=planStageMove({...state,player:p},direction)
          if(!plan||plan.push)continue
          const key=plan.to.x+','+plan.to.y;if(!seen.has(key)){seen.add(key);queue.push({p:plan.to,path:[...route,direction]})}
        }
      }
      if(!path?.length)throw new Error('No route to '+JSON.stringify(goal))
      dispatch({type:'MOVE',direction:path[0]})
      if(read().status==='failed')throw new Error('Solver failed')
    }
    throw new Error('Route limit')
  }
  walk(CHESTS[0]);walk(CHESTS[8]);walk(CHESTS[1]);walk(CHESTS[2]);walk(KEY);walk(CHESTS[4]);walk(GATE);walk(CHESTS[5])
  for(const track of BOULDERS){
    const stone=read().boulders.find(b=>b.id===track.id)!
    if(stone.y===track.minY){walk({x:track.x,y:track.minY-1});dispatch({type:'MOVE',direction:'DOWN'})}
    else if(stone.y===track.maxY){walk({x:track.x,y:track.maxY+1});dispatch({type:'MOVE',direction:'UP'})}
  }
  walk(PRESSURE_GATE);walk(CHESTS.find(c=>c.id===ROYAL_CACHE_ID)!);walk(CHESTS[7]);walk(CHESTS[6]);walk(CHESTS[3]);walk(EXIT)
  return {walk,plates:PLATES}
}
