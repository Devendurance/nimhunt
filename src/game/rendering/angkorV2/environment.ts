import type Phaser from 'phaser'
import { ANGKOR_V2_BY_KEY, ANGKOR_V2_EXPLORER_GAMEPLAY, ANGKOR_V2_PRODUCTION_MANIFEST, type AngkorV2AssetKey, type AngkorV2DepthClass } from '../../assets/angkorV2Manifest'
import { ANGKOR_V2_RENDER as R, compileWallModules, environmentDepth, readabilityOccluders, readabilityAlpha, validateEnvironmentMap, type EnvironmentDepthClass, type EnvironmentMap, type VisualBounds } from './geometry'
import { InteractableEmphasis } from './interactableEmphasis'
import { CAP_MATERIALS, FLOOR_MATERIALS, createFloorSurface, createWallSurface } from './surfaces'

export const angkorV2TextureKey = (key: AngkorV2AssetKey) => `angkor-v2/${key}`
export function preloadAngkorV2Environment(scene: Phaser.Scene, additional: readonly AngkorV2AssetKey[] = []): void {
  const keys = new Set<AngkorV2AssetKey>([...ANGKOR_V2_PRODUCTION_MANIFEST.map(a => a.key as AngkorV2AssetKey), ...additional])
  for (const key of keys) if (!scene.textures.exists(angkorV2TextureKey(key))) scene.load.image(angkorV2TextureKey(key), ANGKOR_V2_BY_KEY[key].path)
}
const classForAsset: Record<AngkorV2DepthClass, EnvironmentDepthClass> = {
  floor: 'floor', 'ground-detail': 'floor-overlay', hazard: 'ground-item', collectible: 'ground-item', prop: 'low-prop', actor: 'actor', architecture: 'architecture', wall: 'wall', foreground: 'foreground', effect: 'effect',
}
export interface EnvironmentSprite {
  readonly key: AngkorV2AssetKey; readonly x: number; readonly y: number;
  readonly depthClass?: EnvironmentDepthClass; readonly depthY?: number;
  readonly occludesPlayer?: boolean; readonly alpha?: number; readonly flipX?: boolean; readonly shadow?: boolean;
}
export interface DepthTarget { readonly x: number; readonly y: number; setDepth(depth: number): unknown }
interface Occluder { object: Phaser.GameObjects.Image; bounds: VisualBounds; depth: number; baseAlpha: number; targetAlpha: number; opaqueAt: (x: number, y: number) => boolean }
interface ActorBinding { object: DepthTarget; foot: () => { x: number; y: number }; width: number; visibleHeight: number; lastX?: number; lastY?: number }
let nextEnvironmentId = 0

/** Opt-in Phaser rendering foundation. It does not create physics/colliders,
 * read replay state, advance simulation, or alter caller-owned movement. */
export class AngkorV2Environment {
  readonly wallModules: ReturnType<typeof compileWallModules>
  private readonly scene: Phaser.Scene
  private readonly itemEmphasis: InteractableEmphasis
  private readonly owned: Phaser.GameObjects.GameObject[] = []
  private readonly runtimeTextures: string[] = []
  private readonly occluders: Occluder[] = []
  private readonly actors = new Set<ActorBinding>()
  private destroyed = false
  private readabilityEnabled = true
  private dirty = true
  private readonly shutdown = () => this.destroy()

  constructor(scene: Phaser.Scene, map: EnvironmentMap) {
    validateEnvironmentMap(map); this.scene = scene; this.itemEmphasis = new InteractableEmphasis(scene); this.wallModules = compileWallModules(map)
    const id = nextEnvironmentId++, source = (key: AngkorV2AssetKey) => {
      if (!scene.textures.exists(angkorV2TextureKey(key))) throw new Error(`Angkor V2 texture not preloaded: ${key}`)
      return scene.textures.get(angkorV2TextureKey(key)).getSourceImage() as HTMLImageElement
    }
    // Reject incomplete preload before allocating owned objects or textures.
    for (const key of [...Object.values(FLOOR_MATERIALS), ...Object.values(CAP_MATERIALS), 'wall-face-sandstone-height-v2'] as AngkorV2AssetKey[]) source(key)
    const floorKey = `angkor-v2/runtime/${id}/floor`
    scene.textures.addCanvas(floorKey, createFloorSurface(map, source)); this.runtimeTextures.push(floorKey)
    const floor = scene.add.image(0, 0, floorKey).setOrigin(0).setDepth(environmentDepth('floor', 0)); this.owned.push(floor)
    this.wallModules.forEach((w, index) => {
      const key = `angkor-v2/runtime/${id}/wall/${index}`, surface = createWallSurface(w, source)
      scene.textures.addCanvas(key, surface); this.runtimeTextures.push(key)
      const image = scene.add.image(w.x * R.tile - 2, w.y * R.tile - w.height, key).setOrigin(0).setDepth(environmentDepth('wall', w.baseY))
      this.owned.push(image)
      this.addOccluder(image, { x: image.x, y: image.y, width: surface.width, height: surface.height }, surface)
    })
    scene.events.once('shutdown', this.shutdown)
  }

  addSprite(placement: EnvironmentSprite): Phaser.GameObjects.Image {
    if (this.destroyed) throw new Error('Angkor V2 environment is destroyed')
    const asset = ANGKOR_V2_BY_KEY[placement.key], key = angkorV2TextureKey(placement.key)
    if (!asset || asset.renderMode !== 'sprite' || !this.scene.textures.exists(key)) throw new Error(`Missing Angkor V2 sprite: ${placement.key}`)
    const kind = placement.depthClass ?? classForAsset[asset.depthClass], baseY = placement.depthY ?? placement.y
    if (!Number.isFinite(placement.x) || !Number.isFinite(placement.y)) throw new Error('Environment sprite requires a finite foot point')
    const depth = environmentDepth(kind, baseY)
    const image = this.scene.add.image(placement.x, placement.y, key)
      .setOrigin(asset.anchor.x, asset.anchor.y).setDisplaySize(asset.displayDimensions.width, asset.displayDimensions.height)
      .setDepth(depth).setAlpha(placement.alpha ?? 1).setFlipX(placement.flipX ?? false)
    this.owned.push(image); this.itemEmphasis.track(image, placement.key)
    if (placement.shadow) {
      const shadow = this.scene.add.ellipse(placement.x, placement.y - 1, asset.displayDimensions.width * .6, 5, 0x24271b, .35)
        .setDepth(environmentDepth(kind, baseY) - .5)
      this.owned.push(shadow)
    }
    if (placement.occludesPlayer ?? (kind === 'architecture' || kind === 'foreground')) {
      const bounds = { x: placement.x - asset.displayDimensions.width * asset.anchor.x, y: placement.y - asset.displayDimensions.height * asset.anchor.y, ...asset.displayDimensions }
      this.addOccluder(image, bounds, this.scene.textures.get(key).getSourceImage() as HTMLImageElement)
    }
    return image
  }

  /** Brief receipt of already-resolved chest loot. No world pickup or delayed effect authority. */
  showItemReceipt(key: AngkorV2AssetKey, x: number, y: number): Phaser.GameObjects.Image {
    const image = this.addSprite({ key, x, y: y - 17, depthY: y, depthClass: 'effect', occludesPlayer: false })
    this.scene.tweens.add({ targets: image, alpha: 0, delay: 650, duration: 250, onComplete: () => image.destroy() })
    return image
  }

  /** Track an existing image/container using its caller-owned floor foot point.
   * Only these bindings receive dynamic Y depth; static architecture stays fixed. */
  trackActor(object: DepthTarget, options: { foot?: () => { x: number; y: number }; width?: number; visibleHeight?: number } = {}): () => void {
    if (this.destroyed) throw new Error('Angkor V2 environment is destroyed')
    const binding: ActorBinding = { object, foot: options.foot ?? (() => ({ x: object.x, y: object.y })), width: options.width ?? ANGKOR_V2_BY_KEY[ANGKOR_V2_EXPLORER_GAMEPLAY.key].displayDimensions.width, visibleHeight: options.visibleHeight ?? ANGKOR_V2_EXPLORER_GAMEPLAY.visibleDisplayHeight }
    if (!(Number.isFinite(binding.width) && binding.width > 0 && Number.isFinite(binding.visibleHeight) && binding.visibleHeight > 0)) throw new Error('Actor readability bounds must be positive and finite')
    this.actors.add(binding); this.dirty = true
    return () => { this.actors.delete(binding); this.dirty = true }
  }
  setReadabilityEnabled(enabled: boolean): void { this.readabilityEnabled = enabled; this.dirty = true }

  update(deltaMs: number): void {
    if (this.destroyed) return
    this.itemEmphasis.update(deltaMs)
    let changed = this.dirty
    for (const actor of this.actors) {
      const foot = actor.foot()
      if (!Number.isFinite(foot.x) || !Number.isFinite(foot.y)) throw new Error('Actor foot must be finite')
      if (foot.x !== actor.lastX || foot.y !== actor.lastY) {
        actor.object.setDepth(environmentDepth('actor', foot.y)); actor.lastX = foot.x; actor.lastY = foot.y; changed = true
      }
    }
    if (changed) {
      const fading = new Map<number, number>()
      if (this.readabilityEnabled) for (const actor of this.actors) {
        const foot = actor.foot()
        const contributors = readabilityOccluders({ ...foot, width: actor.width, visibleHeight: actor.visibleHeight }, this.occluders)
        const alpha = readabilityAlpha(contributors.length)
        for (const index of contributors) fading.set(index, Math.min(fading.get(index) ?? 1, alpha))
      }
      this.occluders.forEach((o, index) => { o.targetAlpha = o.baseAlpha * (fading.get(index) ?? 1) })
      this.dirty = false
    }
    const amount = Math.max(0, Math.min(1, deltaMs / R.fadeDuration))
    for (const o of this.occluders) {
      if (Math.abs(o.object.alpha - o.targetAlpha) < .005) { if (o.object.alpha !== o.targetAlpha) o.object.setAlpha(o.targetAlpha) }
      else o.object.setAlpha(o.object.alpha + Math.sign(o.targetAlpha - o.object.alpha) * Math.min(Math.abs(o.targetAlpha - o.object.alpha), amount))
    }
  }
  get fadedStructureCount(): number { return this.occluders.filter(o => o.targetAlpha < o.baseAlpha).length }
  get readabilitySettled(): boolean { return this.occluders.every(o => Math.abs(o.object.alpha - o.targetAlpha) < .005) }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true; this.scene.events.off('shutdown', this.shutdown)
    this.itemEmphasis.destroy()
    this.owned.forEach(object => object.destroy()); this.runtimeTextures.forEach(key => this.scene.textures.remove(key))
    this.actors.clear(); this.occluders.length = 0; this.owned.length = 0; this.runtimeTextures.length = 0
  }

  private addOccluder(object: Phaser.GameObjects.Image, bounds: VisualBounds, image: CanvasImageSource): void {
    // Sample real alpha so open gateways and branch gaps do not fade needlessly.
    const source = image as HTMLImageElement | HTMLCanvasElement
    const canvas = document.createElement('canvas'); canvas.width = source.width; canvas.height = source.height
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!; ctx.drawImage(image, 0, 0)
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const opaqueAt = (x: number, y: number) => {
      const px = Math.floor((x - bounds.x) / bounds.width * canvas.width), py = Math.floor((y - bounds.y) / bounds.height * canvas.height)
      const sx = object.flipX ? canvas.width - px - 1 : px
      return sx >= 0 && py >= 0 && sx < canvas.width && py < canvas.height && data[(py * canvas.width + sx) * 4 + 3] > 160
    }
    this.occluders.push({ object, bounds, depth: object.depth, baseAlpha: object.alpha, targetAlpha: object.alpha, opaqueAt })
    this.dirty = true
  }
}
