import { DIRECTION_VECTORS,type Direction,type GridCoord } from '../../world/grid'
import { CORE,EXIT,GEMS,POTION,ROTARY } from './level'
import { planStageMove,reduceStage,sameCell,type StageAction,type StageState } from './model'
/** Legal tile inputs only. The search includes seal transitions so a path never
 * silently changes the requested gate combination along the way. */
export function walkTo(read:()=>StageState,dispatch:(a:StageAction)=>unknown,target:GridCoord):void{
  const start=read(),queue=[{state:{...start,events:[]},path:[] as Direction[]}],seen=new Set<string>()
  for(let i=0;i<queue.length;i++){
    const node=queue[i],s=node.state
    if(sameCell(s.player,target)){for(const direction of node.path)dispatch({type:'MOVE',direction});return}
    for(const direction of Object.keys(DIRECTION_VECTORS) as Direction[]){
      const plan=planStageMove(s,direction);if(!plan||plan.push)continue
      const next=reduceStage(s,{type:'MOVE',direction}),key=[next.player.x,next.player.y,next.rotaryState,next.mechanismCoreActivated].join(',')
      if(seen.has(key))continue;seen.add(key);queue.push({state:{...next,events:[]},path:[...node.path,direction]})
    }
  }
  throw new Error('Unreachable Ancient Mechanism tile '+target.x+','+target.y)
}
export function setRotary(read:()=>StageState,dispatch:(a:StageAction)=>unknown,value:StageState['rotaryState']):void{
  walkTo(read,dispatch,{x:ROTARY.x,y:ROTARY.y+1})
  for(let i=0;read().rotaryState!==value&&i<3;i++){
    dispatch({type:'MOVE',direction:'UP'});dispatch({type:'MOVE',direction:'DOWN'})
  }
  if(read().rotaryState!==value)throw new Error('Seal did not cycle')
}
export function solveMechanism(read:()=>StageState,dispatch:(a:StageAction)=>unknown,optional=true):void{
  if(optional){walkTo(read,dispatch,GEMS[0]);walkTo(read,dispatch,POTION)}
  const y=read().boulders[0].y
  if(y===16){walkTo(read,dispatch,{x:6,y:15});dispatch({type:'MOVE',direction:'DOWN'})}
  if(y===18){walkTo(read,dispatch,{x:6,y:19});dispatch({type:'MOVE',direction:'UP'})}
  if(optional){setRotary(read,dispatch,'A');walkTo(read,dispatch,GEMS[1])}
  setRotary(read,dispatch,'B');walkTo(read,dispatch,CORE)
  if(optional)walkTo(read,dispatch,GEMS[2])
  setRotary(read,dispatch,'C');walkTo(read,dispatch,EXIT)
}
