import type Phaser from 'phaser'
import { ANGKOR_V2_BY_KEY, ANGKOR_V2_TRAVERSAL_ANIMATION as A } from '../../assets/angkorV2Manifest'
import { angkorV2TextureKey, type AngkorV2Environment } from '../../rendering/angkorV2/environment'
import { environmentDepth } from '../../rendering/angkorV2/geometry'
import type { TileTraversal } from './movement'

/** Rendering only. The controller owns logical moves and a single grounded foot. */
export class TraversalPlayer {
  readonly sprite: Phaser.GameObjects.Sprite
  private readonly shadow: Phaser.GameObjects.Ellipse
  private readonly detach: () => void
  private gaitMs = 0
  private lastSeq = 0
  private destroyed = false
  private readonly traversal: TileTraversal

  constructor(scene: Phaser.Scene, environment: AngkorV2Environment, traversal: TileTraversal) {
    this.traversal = traversal
    const texture = scene.textures.get(angkorV2TextureKey(A.key))
    for (let i = 0; i < A.columns * A.rows; i++) if (!texture.has(String(i))) texture.add(String(i), 0, (i % A.columns) * A.frameWidth, Math.floor(i / A.columns) * A.frameHeight, A.frameWidth, A.frameHeight)
    const asset = ANGKOR_V2_BY_KEY[A.key], foot = traversal.foot
    this.sprite = scene.add.sprite(foot.x, foot.y, texture.key, String(A.idleColumn))
      .setOrigin(asset.anchor.x, asset.anchor.y).setDisplaySize(asset.displayDimensions.width, asset.displayDimensions.height)
    this.shadow = scene.add.ellipse(foot.x, foot.y - 1, 14, 5, 0x24271b, .45)
    this.detach = environment.trackActor(this.sprite, { width: asset.displayDimensions.width, visibleHeight: asset.displayDimensions.height * A.visibleSourceHeight / A.frameHeight })
    this.update(0, false)
  }
  update(deltaMs: number, reducedMotion: boolean): void {
    if (this.destroyed) return
    if (this.traversal.seq !== this.lastSeq) {
      if (this.traversal.seq <= this.lastSeq) this.gaitMs = 0
      this.lastSeq = this.traversal.seq
    }
    if (this.traversal.moving) this.gaitMs = (this.gaitMs + deltaMs) % A.stepCycleMs
    else this.gaitMs = 0
    const row = A.directions.indexOf(this.traversal.facing)
    const column = this.traversal.moving && !reducedMotion ? Math.floor(this.gaitMs / (A.stepCycleMs / A.columns)) % A.columns : A.idleColumn
    this.sprite.setFrame(String(row * A.columns + column), false, false)
    const foot = this.traversal.foot
    this.sprite.setPosition(foot.x, foot.y)
    this.shadow.setPosition(foot.x, foot.y - 1).setDepth(environmentDepth('actor', foot.y) - .5)
  }
  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true; this.detach(); this.sprite.destroy(); this.shadow.destroy()
  }
}
