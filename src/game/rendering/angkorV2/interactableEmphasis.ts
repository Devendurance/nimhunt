import type Phaser from 'phaser'
import { ANGKOR_V2_BY_KEY, type AngkorV2AssetKey } from '../../assets/angkorV2Manifest'
import { ITEM_PROFILES,gradeItemPixels,itemEmphasisSignal,type ItemProfile } from './interactableReadability'
interface Binding { image:Phaser.GameObjects.Image; original:AngkorV2AssetKey; graphics:Phaser.GameObjects.Graphics; seed:number; baseY?:number; discoveredAt?:number }
let nextEmphasisId=0
/** Owns only scene-local RGB textures, glints and <1px pickup bob. Never reads a reducer,
 * dispatches input or changes collision. Source transparency and foot/depth remain intact. */
export class InteractableEmphasis {
  private readonly bindings:Binding[]=[]
  private readonly textures=new Map<string,string>()
  private readonly originals=new Map<string,AngkorV2AssetKey>()
  private readonly id=nextEmphasisId++
  private clock=0
  private readonly reduced=typeof window==='undefined'?undefined:window.matchMedia('(prefers-reduced-motion: reduce)')
  private readonly scene:Phaser.Scene
  constructor(scene:Phaser.Scene){this.scene=scene}
  track(image:Phaser.GameObjects.Image,key:AngkorV2AssetKey):void {
    if(!ITEM_PROFILES[key])return
    this.bindings.push({image,original:key,graphics:this.scene.add.graphics(),seed:this.bindings.length})
  }
  private texture(key:AngkorV2AssetKey,p:ItemProfile,engaged:boolean):string {
    const variant=key+(engaged?'/engaged':'')
    const cached=this.textures.get(variant);if(cached)return cached
    const source=this.scene.textures.get('angkor-v2/'+key).getSourceImage() as HTMLImageElement
    const canvas=document.createElement('canvas');canvas.width=source.width;canvas.height=source.height
    const ctx=canvas.getContext('2d',{willReadFrequently:true})!;ctx.drawImage(source,0,0)
    const pixels=ctx.getImageData(0,0,canvas.width,canvas.height);pixels.data.set(gradeItemPixels(pixels.data,p,engaged));ctx.putImageData(pixels,0,0)
    const name='angkor-v2/readability/'+this.id+'/'+variant
    this.scene.textures.addCanvas(name,canvas);this.textures.set(variant,name);this.originals.set(name,key);return name
  }
  update(delta:number):void {
    this.clock+=Math.max(0,Math.min(delta,50))
    if(!this.bindings.length)return
    const view=this.scene.cameras.main.worldView
    for(const binding of this.bindings){
      const {image,graphics}=binding;graphics.clear()
      if(!image.scene)continue
      const raw=this.originals.get(image.texture.key)??image.texture.key.replace('angkor-v2/','') as AngkorV2AssetKey
      const p=ITEM_PROFILES[raw];if(!p)continue
      const engaged=p.kind==='plate'&&image.isTinted
      const texture=this.texture(raw,p,engaged);if(image.texture.key!==texture)image.setTexture(texture)
      binding.baseY??=image.y
      const baseY=binding.baseY,asset=ANGKOR_V2_BY_KEY[raw],bounds={left:image.x-image.displayWidth*asset.anchor.x,top:baseY-image.displayHeight*asset.anchor.y}
      const visible=image.visible&&image.alpha>.01&&bounds.left+image.displayWidth>view.x&&bounds.left<view.right&&bounds.top+image.displayHeight>view.y&&bounds.top<view.bottom
      if(visible&&binding.discoveredAt===undefined)binding.discoveredAt=this.clock
      const open=raw.includes('-open-'),signal=itemEmphasisSignal(this.clock,visible?this.clock-(binding.discoveredAt??this.clock):-1,binding.seed,p,this.reduced?.matches??false,open)
      if(p.bob)image.setY(baseY+signal.bob)
      graphics.setVisible(visible).setAlpha(image.alpha).setDepth(image.depth+.02)
      if(!visible)continue
      if(p.bob){
        // Contact stays on floor; the pickup moves only visually, never its depth/foot.
        graphics.fillStyle(0x12201a,.32).fillEllipse(image.x,baseY-1,12,3)
      }
      if(signal.glint){
        const x=image.x+image.displayWidth*.15,y=baseY-image.displayHeight*(p.kind==='mechanism'?.2:p.kind==='chest'||p.kind==='royal'?.53:.7)
        graphics.lineStyle(1,p.color,signal.glint).lineBetween(x-3,y,x+3,y).lineBetween(x,y-3,x,y+3)
      }
      if(p.kind==='plate'){
        const cy=baseY-15
        graphics.lineStyle(engaged?2:1,engaged?0x8bddab:0xe4ba66,engaged?.95:.55).strokeRect(image.x-12,cy-12,24,24)
        if(engaged)graphics.fillStyle(0xb8f2c7,.95).fillRect(image.x-10,cy-10,4,2).fillRect(image.x+6,cy+8,4,2)
      }
      if(p.kind==='gate'){
        if(open)graphics.lineStyle(2,0x87dab4,.85).lineBetween(image.x-8,baseY-3,image.x+8,baseY-3)
        else graphics.fillStyle(0xf2bf59,.9).fillRect(image.x-2,baseY-20,4,4)
      }
      if(p.kind==='passage'){
        if(open)graphics.fillStyle(0x94e8ef,.22).fillEllipse(image.x,baseY-17,20,10).lineStyle(2,0xa9edf1,.8).lineBetween(image.x-8,baseY-26,image.x-8,baseY-16).lineBetween(image.x+8,baseY-26,image.x+8,baseY-16)
        else graphics.fillStyle(0xd4a64e,.8).fillRect(image.x-3,baseY-24,6,3)
      }
    }
  }
  destroy():void {
    for(const b of this.bindings){if(b.image.scene&&b.baseY!==undefined&&ITEM_PROFILES[b.original]?.bob)b.image.setY(b.baseY);b.graphics.destroy()}
    for(const key of this.textures.values())this.scene.textures.remove(key)
    this.bindings.length=0;this.textures.clear();this.originals.clear()
  }
}
