import { describe, expect, it, vi } from 'vitest'
import type Phaser from 'phaser'

vi.mock('phaser', () => ({ default: { GameObjects: { Sprite: class Sprite {} } } }))
import { Player } from './Player'

function setup() {
  const graphic = () => ({ setStrokeStyle: vi.fn(), setPosition: vi.fn(), setAlpha: vi.fn(), destroy: vi.fn() })
  const container = { x: 112, y: 112, setDepth: vi.fn(), setPosition: vi.fn(), destroy: vi.fn() }
  const tweens: { onComplete?: () => void }[] = []
  const scene = {
    textures: { exists: () => false },
    add: { ellipse: graphic, rectangle: graphic, circle: graphic, container: () => container },
    tweens: { add: vi.fn((config: { onComplete?: () => void }) => { tweens.push(config) }), killTweensOf: vi.fn() },
  }
  return { player: new Player(scene as unknown as Phaser.Scene, { x: 3, y: 3 }), tweens, scene, container }
}

describe('Player animation lifecycle', () => {
  it('locks blocked feedback so rapid input cannot overlap movement', () => {
    const { player, tweens } = setup()
    player.bump('UP')
    expect(player.isMoving).toBe(true)
    player.bump('RIGHT')
    player.moveTo({ x: 4, y: 3 }, 'RIGHT', vi.fn())
    expect(tweens).toHaveLength(1)
    tweens[0].onComplete?.()
    expect(player.isMoving).toBe(false)
  })
  it('reset invalidates a pending movement callback and restores spawn', () => {
    const { player, tweens, scene, container } = setup()
    const completed = vi.fn()
    player.moveTo({ x: 4, y: 3 }, 'RIGHT', completed)
    player.reset({ x: 3, y: 3 })
    tweens[0].onComplete?.()
    expect(completed).not.toHaveBeenCalled()
    expect([player.gridX, player.gridY, player.facing, player.isMoving]).toEqual([3, 3, 'DOWN', false])
    expect(container.setPosition).toHaveBeenCalledWith(112, 112)
    expect(scene.tweens.killTweensOf).toHaveBeenCalledTimes(2)
  })
  it('reset invalidates a pending bump and destroy invalidates movement', () => {
    const { player, tweens } = setup()
    const completed = vi.fn()
    player.bump('LEFT', completed)
    player.reset({ x: 3, y: 3 })
    tweens[0].onComplete?.()
    player.moveTo({ x: 4, y: 3 }, 'RIGHT', completed)
    player.destroy()
    tweens[1].onComplete?.()
    expect(completed).not.toHaveBeenCalled()
  })
})
