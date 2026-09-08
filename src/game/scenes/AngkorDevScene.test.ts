import { describe, expect, it, vi } from 'vitest'
import { createGameBridge, createInitialHUDState } from '../events/gameEvents'
import { createPuzzleState, type PuzzleState } from '../systems/puzzle'
import { ROOM_01_PUZZLE } from '../world/room01'

const pending = vi.hoisted(() => ({
  steps: [] as (() => void)[],
  tweens: [] as (() => void)[],
  timers: [] as (() => void)[],
}))
vi.mock('../rendering/puzzleArtwork', () => ({ createPuzzleArtwork: () => {}, PUZZLE_TEXTURES: {} }))
vi.mock('../entities/Player', () => ({
  Player: class {
    gridX = 3; gridY = 3; facing = 'DOWN'; isMoving = false
    moveTo(to: { x: number; y: number }, facing: string, done: () => void) {
      this.isMoving = true; this.facing = facing
      pending.steps.push(() => { this.gridX = to.x; this.gridY = to.y; this.isMoving = false; done() })
    }
    bump(_direction: string, done: () => void) { done() }
    reset() { this.gridX = 3; this.gridY = 3; this.facing = 'DOWN'; this.isMoving = false }
    showHit() {}
    destroy() {}
  },
}))
vi.mock('phaser', () => ({
  default: {
    Scene: class {
      events = { once: vi.fn() }
      game = { events: { on: vi.fn(), off: vi.fn() } }
      tweens = { add: (config: { onComplete?: () => void }) => { if (config.onComplete) pending.tweens.push(config.onComplete) }, killTweensOf: vi.fn() }
      time = { delayedCall: (_ms: number, callback: () => void) => { pending.timers.push(callback); return { remove: vi.fn() } } }
    },
    Scenes: { Events: { SHUTDOWN: 'shutdown' } },
  },
}))
import { AngkorDevScene } from './AngkorDevScene'

function setup() {
  pending.steps = []; pending.tweens = []; pending.timers = []
  vi.stubGlobal('window', { matchMedia: () => ({ matches: true }) })
  const bridge = createGameBridge(createInitialHUDState())
  const scene = new AngkorDevScene(bridge)
  const internals = scene as unknown as {
    player: { gridX: number; gridY: number }
    puzzle: PuzzleState
    renderRoomTiles(): void; renderContents(): void; renderPuzzle(): void; renderGems(): void
  }
  for (const method of ['renderRoomTiles', 'renderContents', 'renderPuzzle', 'renderGems'] as const) vi.spyOn(internals, method).mockImplementation(() => {})
  scene.create()
  return { scene, internals, bridge }
}

describe('Puzzle scene transition lifecycle', () => {
  it('commits a push only after both animations, blocking overlapping input', () => {
    const { scene, internals, bridge } = setup()
    internals.player.gridX = 4; internals.player.gridY = 5
    scene.handleMove('DOWN')
    scene.handleMove('DOWN')
    expect(pending.steps).toHaveLength(1)
    expect(bridge.getState().isMoving).toBe(true)
    pending.steps[0]()
    expect(bridge.getState().stepCount).toBe(0)
    scene.handleMove('RIGHT')
    expect(pending.steps).toHaveLength(1)
    pending.tweens[0]()
    expect(bridge.getState()).toMatchObject({ gridX: 4, gridY: 6, stepCount: 1, isMoving: false })
    expect(internals.puzzle.boulderPositions[0]).toMatchObject({ x: 4, y: 7 })
  })

  it('reset invalidates an unfinished push commit', () => {
    const { scene, internals, bridge } = setup()
    internals.player.gridX = 4; internals.player.gridY = 5
    scene.handleMove('DOWN')
    pending.steps[0]()
    scene.handleReset()
    pending.tweens[0]()
    expect(bridge.getState()).toEqual(createInitialHUDState())
    expect(internals.puzzle).toEqual(createPuzzleState(ROOM_01_PUZZLE))
  })

  it('locks gate opening plus movement and commits once', () => {
    const { scene, internals, bridge } = setup()
    internals.player.gridX = 7; internals.player.gridY = 3
    internals.puzzle = { ...internals.puzzle, hasTempleKey: true }
    scene.handleMove('RIGHT')
    scene.handleMove('RIGHT')
    expect(pending.steps).toHaveLength(0)
    expect(pending.timers).toHaveLength(1)
    expect(bridge.getState().gateState).toBe('LOCKED')
    pending.timers[0]()
    scene.handleMove('RIGHT')
    expect(pending.steps).toHaveLength(1)
    pending.steps[0]()
    expect(bridge.getState()).toMatchObject({ gateState: 'OPEN', hasTempleKey: true, gridX: 8, stepCount: 1, isMoving: false })
  })

  it('reset cancels gate opening before a step can begin', () => {
    const { scene, internals, bridge } = setup()
    internals.player.gridX = 7; internals.player.gridY = 3
    internals.puzzle = { ...internals.puzzle, hasTempleKey: true }
    scene.handleMove('RIGHT')
    scene.handleReset()
    pending.timers[0]()
    expect(pending.steps).toHaveLength(0)
    expect(bridge.getState()).toEqual(createInitialHUDState())
  })

  it('reset during the gate step discards its pending commit', () => {
    const { scene, internals, bridge } = setup()
    internals.player.gridX = 7; internals.player.gridY = 3
    internals.puzzle = { ...internals.puzzle, hasTempleKey: true }
    scene.handleMove('RIGHT')
    pending.timers[0]()
    scene.handleReset()
    pending.steps[0]() // Adversarial callback: real Player also invalidates this.
    expect(bridge.getState()).toEqual(createInitialHUDState())
    expect(internals.puzzle.gateState).toBe('LOCKED')
  })
})
