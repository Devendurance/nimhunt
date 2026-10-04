import { describe,it,expect,vi } from 'vitest'
import { ITEM_PROFILES,gradeItemPixels,itemEmphasisSignal } from './interactableReadability'
import { InteractableEmphasis } from './interactableEmphasis'
import { ANGKOR_V2_BY_KEY } from '../../assets/angkorV2Manifest'
import type Phaser from 'phaser'

describe('V2 item presentation, separate from authority',()=>{
 it('grades only listed interactive art; floors/architecture/wildlife are untouched',()=>{
  for(const key of ['floor-mossy-height-v2','wall-cap-sandstone-height-v2','guardian-statue-height-v2','explorer-gameplay-down-v2','snake-coiled-v2','anaconda-upright-v3'] as const)expect(ITEM_PROFILES[key]).toBeUndefined()
 })
 it('preserves every alpha/source byte and black silhouette while strengthening key contrast',()=>{
  const source=new Uint8ClampedArray([0,0,0,0,20,15,10,180,120,100,55,255,200,190,170,64]),copy=new Uint8ClampedArray(source)
  for(const p of Object.values(ITEM_PROFILES)){
   const out=gradeItemPixels(source,p);expect(source).toEqual(copy)
   for(let i=3;i<source.length;i+=4)expect(out[i]).toBe(source[i])
   expect(out.slice(0,8)).toEqual(source.slice(0,8))
  }
  const key=gradeItemPixels(source,ITEM_PROFILES['bronze-temple-key-v2']!);expect(key[8]).toBeGreaterThan(source[8]);expect(key[8]-key[10]).toBeGreaterThan(source[8]-source[10])
 })
 it('keeps silver cool, bronze warm and pressure engagement brighter with identical alpha',()=>{
  const source=new Uint8ClampedArray([140,140,140,220])
  const silver=gradeItemPixels(source,ITEM_PROFILES['silver-archive-key-v2']!),bronze=gradeItemPixels(source,ITEM_PROFILES['bronze-temple-key-v2']!)
  expect(silver[2]).toBeGreaterThan(silver[0]);expect(bronze[0]).toBeGreaterThan(bronze[2])
  const plate=ITEM_PROFILES['pressure-plate-v2']!,inactive=gradeItemPixels(source,plate),active=gradeItemPixels(source,plate,true)
  expect(active[1]).toBeGreaterThan(inactive[1]);expect(active[3]).toBe(inactive[3])
 })
 it('has a restrained first-viewport key discovery, periodic glint and subpixel bob; open/hidden/reduced suppress motion',()=>{
  const key=ITEM_PROFILES['royal-seal-key-v2']!
  expect(itemEmphasisSignal(375,375,1,key,false,false).glint).toBeGreaterThan(.9)
  for(let t=0;t<10000;t+=31)expect(Math.abs(itemEmphasisSignal(t,t,0,key,false,false).bob)).toBeLessThanOrEqual(.75)
  expect(itemEmphasisSignal(100,100,0,key,true,false)).toEqual({bob:0,glint:0})
  expect(itemEmphasisSignal(100,-1,0,key,false,false)).toEqual({bob:0,glint:0})
  expect(itemEmphasisSignal(100,100,0,key,false,true)).toEqual({bob:0,glint:0})
 })
 it('keeps every pair canvas/anchor/footprint aligned, with readable visible sizes',()=>{
  for(const [closed,open]of [['chest-closed-v2','chest-open-v2'],['royal-cache-closed-v2','royal-cache-open-v2'],['side-gate-locked-v2','side-gate-open-v2']]as const){
   const a=ANGKOR_V2_BY_KEY[closed],b=ANGKOR_V2_BY_KEY[open]
   expect(a.anchor).toEqual(b.anchor);expect(a.sourceDimensions).toEqual(b.sourceDimensions);expect(a.logicalFootprint).toEqual(b.logicalFootprint);expect(a.displayDimensions).toEqual(b.displayDimensions)
  }
  expect(ANGKOR_V2_BY_KEY['bronze-temple-key-v2'].displayDimensions.height*189/256).toBeGreaterThanOrEqual(24)
  expect(ANGKOR_V2_BY_KEY['silver-archive-key-v2'].displayDimensions.height*219/256).toBeLessThanOrEqual(26)
 })
 it('owns/reuses grade textures, observes swaps, restores baseline Y and never changes depth or authority',()=>{
  const chain=()=>{const g:Record<string,unknown>={destroy:vi.fn()};for(const k of ['clear','setVisible','setAlpha','setDepth','fillStyle','lineStyle','fillEllipse','fillRect','strokeRect','lineBetween'])g[k]=vi.fn(()=>g);return g}
  const graphics:ReturnType<typeof chain>[]=[],pixels=new Uint8ClampedArray([120,100,60,255]),ctx={drawImage:vi.fn(),getImageData:()=>({data:new Uint8ClampedArray(pixels)}),putImageData:vi.fn()}
  vi.stubGlobal('document',{createElement:()=>({width:1,height:1,getContext:()=>ctx})})
  const scene={textures:{get:()=>({getSourceImage:()=>({width:1,height:1})}),addCanvas:vi.fn(),remove:vi.fn()},add:{graphics:()=>{const g=chain();graphics.push(g);return g}},cameras:{main:{worldView:{x:0,y:0,right:300,bottom:300}}}}
  const manager=new InteractableEmphasis(scene as unknown as Phaser.Scene)
  const image={scene,texture:{key:'angkor-v2/bronze-temple-key-v2'},x:50,y:80,depth:1234,displayWidth:30,displayHeight:34,visible:true,alpha:1,isTinted:false,setTexture(key:string){this.texture.key=key;return this},setY(y:number){this.y=y;return this}}
  manager.track(image as unknown as Phaser.GameObjects.Image,'bronze-temple-key-v2');manager.update(50);manager.update(50)
  expect(scene.textures.addCanvas).toHaveBeenCalledTimes(1);expect(image.depth).toBe(1234);expect(Math.abs(image.y-80)).toBeLessThanOrEqual(.75)
  expect(graphics[0].setDepth).toHaveBeenLastCalledWith(1234.02)
  image.visible=false;manager.update(50);expect(image.y).toBe(80)
  manager.destroy();manager.destroy();expect(scene.textures.remove).toHaveBeenCalledTimes(1);expect(graphics[0].destroy).toHaveBeenCalledTimes(1)
  vi.unstubAllGlobals()
 })
})
