import { describe, expect, it, vi } from 'vitest'
import type Phaser from 'phaser'

vi.mock('phaser', () => ({ default: { GameObjects: { Sprite: class Sprite {} } } }))
import { Goblin } from './Goblin'

function setup() {
  const graphic = () => ({
    setStrokeStyle: vi.fn(),
    setPosition: vi.fn(),
    setAlpha: vi.fn(),
    setVisible: vi.fn(),
    destroy: vi.fn(),
  })
  const container = {
    x: 240,
    y: 144,
    setDepth: vi.fn(),
    setPosition: vi.fn(),
    setAlpha: vi.fn(),
    destroy: vi.fn(),
  }
  const tweens: { onComplete?: () => void }[] = []
  const scene = {
    textures: { exists: () => false },
    add: {
      ellipse: graphic,
      rectangle: graphic,
      circle: graphic,
      container: () => container,
    },
    tweens: {
      add: vi.fn((config: { onComplete?: () => void }) => {
        tweens.push(config)
      }),
      killTweensOf: vi.fn(),
    },
  }
  return {
    goblin: new Goblin(scene as unknown as Phaser.Scene, { x: 7, y: 4 }),
    tweens,
    scene,
    container,
  }
}

describe('Goblin entity lifecycle', () => {
  it('initializes in PATROL at specified coordinates', () => {
    const { goblin } = setup()
    expect(goblin.gridX).toBe(7)
    expect(goblin.gridY).toBe(4)
    expect(goblin.aiState).toBe('PATROL')
    expect(goblin.isMoving).toBe(false)
  })

  it('moves to target coordinate with tween and updates position upon completion', () => {
    const { goblin, tweens } = setup()
    const done = vi.fn()
    goblin.moveTo({ x: 7, y: 5 }, 'DOWN', done)
    expect(goblin.isMoving).toBe(true)
    expect(tweens).toHaveLength(1)
    tweens[0].onComplete?.()
    expect(goblin.isMoving).toBe(false)
    expect(goblin.gridX).toBe(7)
    expect(goblin.gridY).toBe(5)
    expect(done).toHaveBeenCalled()
  })

  it('setAIState toggles defeated opacity and alert indicator', () => {
    const { goblin, container } = setup()
    goblin.setAIState('CHASE')
    expect(goblin.aiState).toBe('CHASE')
    expect(container.setAlpha).toHaveBeenCalledWith(1.0)

    goblin.setAIState('DEFEATED')
    expect(goblin.aiState).toBe('DEFEATED')
    expect(container.setAlpha).toHaveBeenCalledWith(0.35)
  })

  it('reset cancels pending movement and restores spawn position and patrol state', () => {
    const { goblin, tweens, container } = setup()
    const done = vi.fn()
    goblin.moveTo({ x: 7, y: 5 }, 'DOWN', done)
    goblin.reset({ x: 7, y: 4 })
    tweens[0].onComplete?.()
    expect(done).not.toHaveBeenCalled()
    expect(goblin.gridX).toBe(7)
    expect(goblin.gridY).toBe(4)
    expect(goblin.aiState).toBe('PATROL')
    expect(container.setPosition).toHaveBeenCalledWith(240, 144)
  })

  it('completes immediately and does not tween when target coordinate equals current position', () => {
    const { goblin, tweens, container } = setup()
    const done = vi.fn()
    goblin.moveTo({ x: 7, y: 4 }, 'UP', done)
    expect(goblin.isMoving).toBe(false)
    expect(tweens).toHaveLength(0)
    expect(done).toHaveBeenCalled()
    expect(goblin.facing).toBe('UP')
    expect(container.setPosition).toHaveBeenCalledWith(240, 144)
  })

  it('handles incoming move while already moving by completing prior target and starting new tween', () => {
    const { goblin, tweens, scene } = setup()
    const done1 = vi.fn()
    const done2 = vi.fn()
    goblin.moveTo({ x: 7, y: 5 }, 'DOWN', done1)
    expect(goblin.isMoving).toBe(true)
    expect(tweens).toHaveLength(1)

    // Second move arrives before first completes
    goblin.moveTo({ x: 7, y: 6 }, 'DOWN', done2)
    expect(scene.tweens.killTweensOf).toHaveBeenCalled()
    expect(goblin.isMoving).toBe(true)
    expect(tweens).toHaveLength(2)

    // Complete second tween
    tweens[1].onComplete?.()
    expect(goblin.isMoving).toBe(false)
    expect(goblin.gridX).toBe(7)
    expect(goblin.gridY).toBe(6)
    expect(done2).toHaveBeenCalled()
  })
})
