import type { AngkorV2AssetKey } from '../../assets/angkorV2Manifest'
import type { GolemMode } from './model'
/** Derived presentation subposes; elapsed is simulation ticks + visual fraction. */
export function golemPose(mode:GolemMode,elapsed:number):AngkorV2AssetKey{
 if(mode==='STUNNED')return elapsed<2?'golem-smash-v2':elapsed<6?'golem-recoil-v2':'golem-stunned-v2'
 const poses={DORMANT:'golem-dormant-v2',AWAKENING:'golem-awaken-v2',READY:'golem-idle-v2',WINDUP:'golem-windup-v2',SMASH:'golem-smash-v2',RECOVER:'golem-recoil-v2'} as const
 return poses[mode]
}
