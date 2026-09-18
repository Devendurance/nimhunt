import Phaser from 'phaser'
import {
  type Direction,
  type GridCoord,
  tileToPixel,
} from '../world/grid'
import { ANGKOR_DEPTH } from '../assets/angkorAssets'
import type { GoblinAIState } from '../systems/goblin'

export class Goblin {
  public gridX: number
  public gridY: number
  public facing: Direction
  public isMoving: boolean
  public aiState: GoblinAIState

  private scene: Phaser.Scene
  private container: Phaser.GameObjects.Container
  private sprite: Phaser.GameObjects.Sprite | Phaser.GameObjects.Rectangle
  private shadow: Phaser.GameObjects.Ellipse
  private alertIndicator: Phaser.GameObjects.Arc
  private generation = 0
  private targetCoord?: GridCoord

  constructor(scene: Phaser.Scene, startCoord: GridCoord) {
    this.scene = scene
    this.gridX = startCoord.x
    this.gridY = startCoord.y
    this.targetCoord = startCoord
    this.facing = 'DOWN'
    this.isMoving = false
    this.aiState = 'PATROL'

    const { x, y } = tileToPixel(startCoord)

    // Grounded drop shadow at feet
    this.shadow = scene.add.ellipse(0, 12, 18, 6, 0x000000, 0.4)

    // Goblin sprite: ~28px visible height grounded
    if (scene.textures?.exists('goblin_framed')) {
      const spr = scene.add.sprite(0, 0, 'goblin_framed')
      spr.setScale(28 / spr.height)
      this.sprite = spr
    } else {
      // Fallback dev goblin shape
      const rect = scene.add.rectangle(0, 0, 24, 24, 0x3B6B35)
      rect.setStrokeStyle(1.5, 0xE03E3E)
      this.sprite = rect
    }

    // Tiny alert indicator shown during CHASE (red dot above head)
    this.alertIndicator = scene.add.circle(0, -16, 3, 0xE03E3E)
    this.alertIndicator.setStrokeStyle(1, 0xF3EAD7, 0.9)
    this.alertIndicator.setVisible(false)

    this.container = scene.add.container(x, y, [
      this.shadow,
      this.sprite,
      this.alertIndicator,
    ])
    this.container.setDepth(ANGKOR_DEPTH.PLAYER - 1) // Just below player so player steps cleanly
  }

  public getContainer(): Phaser.GameObjects.Container {
    return this.container
  }

  public setAIState(state: GoblinAIState): void {
    this.aiState = state
    if (state === 'DEFEATED') {
      this.alertIndicator.setVisible(false)
      this.container.setAlpha(0.35)
    } else if (state === 'CHASE') {
      this.alertIndicator.setVisible(true)
      this.container.setAlpha(1.0)
    } else {
      this.alertIndicator.setVisible(false)
      this.container.setAlpha(1.0)
    }
  }

  public moveTo(
    targetCoord: GridCoord,
    facing: Direction,
    onComplete?: () => void
  ): void {
    if (this.aiState === 'DEFEATED') {
      onComplete?.()
      return
    }

    // If an in-flight tween was moving towards a prior target, complete that position first
    if (this.isMoving && this.targetCoord) {
      this.scene.tweens.killTweensOf(this.container)
      this.gridX = this.targetCoord.x
      this.gridY = this.targetCoord.y
      const { x: prevX, y: prevY } = tileToPixel(this.targetCoord)
      this.container.setPosition(prevX, prevY)
      this.isMoving = false
    }

    this.facing = facing

    // Flip sprite horizontally when moving left vs right
    if (this.sprite instanceof Phaser.GameObjects.Sprite) {
      if (facing === 'LEFT') {
        this.sprite.setFlipX(true)
      } else if (facing === 'RIGHT') {
        this.sprite.setFlipX(false)
      }
    }

    // Stationary: already at destination, no visual translation tween needed
    if (targetCoord.x === this.gridX && targetCoord.y === this.gridY) {
      const { x: targetX, y: targetY } = tileToPixel(targetCoord)
      this.container.setPosition(targetX, targetY)
      onComplete?.()
      return
    }

    this.isMoving = true
    this.targetCoord = targetCoord
    const generation = this.generation
    const { x: targetX, y: targetY } = tileToPixel(targetCoord)

    this.scene.tweens.add({
      targets: this.container,
      x: targetX,
      y: targetY,
      duration: 120,
      ease: 'Sine.easeInOut',
      onComplete: () => {
        if (generation !== this.generation) return
        this.gridX = targetCoord.x
        this.gridY = targetCoord.y
        this.isMoving = false
        onComplete?.()
      },
    })
  }

  public reset(startCoord: GridCoord): void {
    this.generation++
    this.scene.tweens.killTweensOf(this.container)
    this.gridX = startCoord.x
    this.gridY = startCoord.y
    this.targetCoord = startCoord
    this.facing = 'DOWN'
    this.isMoving = false
    this.setAIState('PATROL')

    const { x, y } = tileToPixel(startCoord)
    this.container.setPosition(x, y)
    this.container.setAlpha(1.0)
    if (this.sprite instanceof Phaser.GameObjects.Sprite) {
      this.sprite.setFlipX(false)
    }
  }

  public destroy(): void {
    this.generation++
    this.scene.tweens.killTweensOf(this.container)
    this.container.destroy()
  }
}
