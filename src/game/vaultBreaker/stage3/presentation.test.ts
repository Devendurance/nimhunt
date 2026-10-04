import { it,expect } from 'vitest'
import { ANGKOR_V2_BY_KEY } from '../../assets/angkorV2Manifest'
import { ITEM_PROFILES } from '../../rendering/angkorV2/interactableReadability'
import { golemPose } from './presentation'
it('registered state pairs and pose metadata preserve display geometry and explicit logical footprint',()=>{
 for(const pair of [['vault-anchor-intact-v2','vault-anchor-broken-v2'],['inner-vault-door-sealed-v2','inner-vault-door-broken-v2']] as const){
  const a=ANGKOR_V2_BY_KEY[pair[0]],b=ANGKOR_V2_BY_KEY[pair[1]]
  expect(a.sourceDimensions).toEqual(b.sourceDimensions);expect(a.displayDimensions).toEqual(b.displayDimensions);expect(a.anchor).toEqual(b.anchor);expect(a.logicalFootprint).toEqual(b.logicalFootprint)
 }
 for(const mode of ['DORMANT','AWAKENING','READY','WINDUP','SMASH','RECOVER','STUNNED'] as const){const key=golemPose(mode,8),asset=ANGKOR_V2_BY_KEY[key];expect(asset.logicalFootprint).toEqual({width:2,height:2});expect(asset.displayDimensions).toEqual({width:128,height:128});expect(ITEM_PROFILES[key]).toBeUndefined();expect(asset.loadScope).toBe('stage')}
 expect(golemPose('STUNNED',0)).toBe('golem-smash-v2');expect(golemPose('STUNNED',3)).toBe('golem-recoil-v2');expect(golemPose('STUNNED',8)).toBe('golem-stunned-v2')
})
