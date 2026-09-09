import Phaser from 'phaser'
import {
  type Direction,
  type GridCoord,
  tileToPixel,
} from '../world/grid'
import { ANGKOR_DEPTH } from '../assets/angkorAssets'

export class Player {
  public gridX: number
  public gridY: number
  public facing: Direction
  public isMoving: boolean

  private scene: Phaser.Scene
  private container: Phaser.GameObjects.Container
  private sprite: Phaser.GameObjects.Sprite | Phaser.GameObjects.Rectangle
  private facingDot: Phaser.GameObjects.Arc
  private shadow: Phaser.GameObjects.Ellipse
  private generation = 0

  constructor(scene: Phaser.Scene, startCoord: GridCoord) {
    this.scene = scene
    this.gridX = startCoord.x
    this.gridY = startCoord.y
    this.facing = 'DOWN'
    this.isMoving = false

    const { x, y } = tileToPixel(startCoord)

    // Grounded shadow at player feet
    this.shadow = scene.add.ellipse(0, 12, 20, 7, 0x000000, 0.35)

    // Explorer character sprite: 29px visible height grounded to tile
    if (scene.textures?.exists('explorer_framed')) {
      const spr = scene.add.sprite(0, 0, 'explorer_framed')
      spr.setScale(29 / spr.height)
      this.sprite = spr
    } else {
      // Fallback dev explorer box
      const rect = scene.add.rectangle(0, 0, 26, 26, 0x2D8C73)
      rect.setStrokeStyle(1.5, 0xF3EAD7)
      this.sprite = rect
    }

    // Direction/facing indicator (Gem Blue dot)
    this.facingDot = scene.add.circle(0, 14, 2.5, 0x3E88F7)
    this.facingDot.setStrokeStyle(1, 0xF3EAD7, 0.8)

    // Group into an atomic container
    this.container = scene.add.container(x, y, [
      this.shadow,
      this.sprite,
      this.facingDot,
    ])
    this.container.setDepth(ANGKOR_DEPTH.PLAYER)

    this.updateFacingVisual(this.facing)
  }

  public getContainer(): Phaser.GameObjects.Container {
    return this.container
  }

  public moveTo(
    targetCoord: GridCoord,
    facing: Direction,
    onComplete: () => void,
  ): void {
    if (this.isMoving) return

    this.isMoving = true
    const generation = this.generation
    this.facing = facing
    this.updateFacingVisual(facing)

    const { x: targetX, y: targetY } = tileToPixel(targetCoord)

    this.scene.tweens.add({
      targets: this.container,
      x: targetX,
      y: targetY,
      duration: 160,
      ease: 'Sine.easeInOut',
      onComplete: () => {
        if (generation !== this.generation) return
        this.gridX = targetCoord.x
        this.gridY = targetCoord.y
        this.isMoving = false
        onComplete()
      },
    })
  }

  public bump(direction: Direction, onComplete?: () => void): void {
    if (this.isMoving) return
    this.isMoving = true
    const generation = this.generation
    this.facing = direction
    this.updateFacingVisual(direction)

    const offset = 4
    let nudgeX = 0
    let nudgeY = 0

    if (direction === 'UP') nudgeY = -offset
    if (direction === 'DOWN') nudgeY = offset
    if (direction === 'LEFT') nudgeX = -offset
    if (direction === 'RIGHT') nudgeX = offset

    const originalX = this.container.x
    const originalY = this.container.y

    this.scene.tweens.add({
      targets: this.container,
      x: originalX + nudgeX,
      y: originalY + nudgeY,
      duration: 50,
      yoyo: true,
      ease: 'Sine.easeOut',
      onComplete: () => {
        if (generation !== this.generation) return
        this.container.setPosition(originalX, originalY)
        this.isMoving = false
        onComplete?.()
      },
    })
  }

  public reset(coord: GridCoord): void {
    this.generation++
    this.scene.tweens.killTweensOf(this.sprite)
    this.sprite.setAlpha(1)
    if (this.sprite instanceof Phaser.GameObjects.Sprite) this.sprite.setFlipX(false)
    this.scene.tweens.killTweensOf(this.container)
    this.gridX = coord.x
    this.gridY = coord.y
    this.facing = 'DOWN'
    this.isMoving = false

    const { x, y } = tileToPixel(coord)
    this.container.setPosition(x, y)
    this.updateFacingVisual('DOWN')
  }

  public destroy(): void {
    this.generation++
    this.scene.tweens.killTweensOf(this.sprite)
    this.scene.tweens.killTweensOf(this.container)
    this.container.destroy(true)
  }

  public showHit(): void {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    this.scene.tweens.killTweensOf(this.sprite)
    this.sprite.setAlpha(1)
    this.scene.tweens.add({ targets: this.sprite, alpha: 0.35, duration: 90, yoyo: true })
  }

  private updateFacingVisual(direction: Direction): void {
    if (this.sprite instanceof Phaser.GameObjects.Sprite) {
      if (direction === 'LEFT') {
        this.sprite.setFlipX(true)
      } else if (direction === 'RIGHT') {
        this.sprite.setFlipX(false)
      }
    }

    // Position facing dot to clearly signal orientation
    switch (direction) {
      case 'UP':
        this.facingDot.setPosition(0, -13)
        break
      case 'DOWN':
        this.facingDot.setPosition(0, 13)
        break
      case 'LEFT':
        this.facingDot.setPosition(-13, 0)
        break
      case 'RIGHT':
        this.facingDot.setPosition(13, 0)
        break
    }
  }
}
