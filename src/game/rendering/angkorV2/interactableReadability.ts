import type { AngkorV2AssetKey } from '../../assets/angkorV2Manifest'

export interface ItemProfile {
  readonly brightness: number; readonly saturation: number; readonly temperature: 'warm' | 'cool' | 'neutral'
  readonly kind: 'key' | 'gem' | 'potion' | 'chest' | 'royal' | 'plate' | 'gate' | 'passage'
  readonly color: number; readonly bob: boolean
}
const profile=(kind:ItemProfile['kind'],brightness:number,saturation:number,temperature:ItemProfile['temperature'],color:number,bob=false):ItemProfile=>({kind,brightness,saturation,temperature,color,bob})
/** Rendering-only grades. No floor, wall, wildlife or collision asset is eligible. */
export const ITEM_PROFILES:Partial<Record<AngkorV2AssetKey,ItemProfile>>={
  'bronze-temple-key-v2':profile('key',.34,1.32,'warm',0xffdd78,true),
  'silver-archive-key-v2':profile('key',.38,1.12,'cool',0xd7f0ff,true),
  'royal-seal-key-v2':profile('key',.36,1.4,'warm',0xffe694,true),
  'blue-gem-v2':profile('gem',.07,1.12,'cool',0xb7eeff,true),
  'potion-v2':profile('potion',.18,1.38,'neutral',0xffc9c0,true),
  'chest-closed-v2':profile('chest',.24,1.22,'warm',0xffdc80),
  'chest-open-v2':profile('chest',.16,1.18,'warm',0xffdc80),
  'royal-cache-closed-v2':profile('royal',.3,1.28,'warm',0xffe89d),
  'royal-cache-open-v2':profile('royal',.22,1.24,'warm',0xffe89d),
  'pressure-plate-v2':profile('plate',.18,1.16,'warm',0xe5c16d),
  'side-gate-locked-v2':profile('gate',.08,1.12,'warm',0xffd478),
  'side-gate-open-v2':profile('gate',.08,1.12,'neutral',0x8adebd),
  'temple-passage-closed-height-v2':profile('passage',0,1,'neutral',0xdfb660),
  'temple-passage-open-height-v2':profile('passage',0,1,'neutral',0x94e8ef),
  'temple-passage-closed-v2':profile('passage',0,1,'neutral',0xdfb660),
  'temple-passage-open-v2':profile('passage',0,1,'neutral',0x94e8ef),
}
/** Preserve geometry/alpha exactly, including state-pair registration and dark edges.
 * The original PNG remains immutable; a scene-owned texture contains the RGB grade. */
export function gradeItemPixels(source:Uint8ClampedArray,p:ItemProfile,engaged=false):Uint8ClampedArray {
  const out=new Uint8ClampedArray(source)
  const t=p.temperature==='warm'?[1.05,1.01,.93]:p.temperature==='cool'?[.96,1.02,1.09]:[1,1,1]
  for(let i=0;i<out.length;i+=4){
    if(!source[i+3])continue
    const r=source[i],g=source[i+1],b=source[i+2],l=.2126*r+.7152*g+.0722*b
    if(l<=35)continue
    const light=Math.max(0,Math.min(1,(l-35)/140)),gain=1+p.brightness*(.35+.65*light)+(engaged?.35*light:0)
    out[i]=(l+(r-l)*p.saturation)*gain*t[0]
    out[i+1]=(l+(g-l)*p.saturation)*gain*t[1]
    out[i+2]=(l+(b-l)*p.saturation)*gain*t[2]
  }
  return out
}
export interface EmphasisSignal { bob:number; glint:number }
export function itemEmphasisSignal(clock:number,visibleAge:number,seed:number,p:ItemProfile,reduced:boolean,open:boolean):EmphasisSignal {
  if(reduced||visibleAge<0||open)return{bob:0,glint:0}
  const discovery=p.kind==='key'&&visibleAge<750 ? Math.sin(Math.max(0,visibleAge)/750*Math.PI)*.95 : 0
  const period=p.kind==='royal'?4400:5600,age=(clock+seed*617)%period
  const periodic=age<240 ? Math.sin(age/240*Math.PI)*(p.kind==='key'||p.kind==='royal'?.75:.5):0
  return{bob:p.bob?Math.sin((clock+seed*137)/650)*.75:0,glint:Math.max(discovery,periodic)}
}
