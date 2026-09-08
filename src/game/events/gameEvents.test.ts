import { describe, expect, it, vi } from 'vitest'
import { createGameBridge, createInitialHUDState, type PlayerHUDState } from './gameEvents'

describe('GameBridge Event System', () => {
  const initialState: PlayerHUDState = {
    ...createInitialHUDState(),
    gridX: 3,
    gridY: 3,
    facing: 'DOWN',
    isMoving: false,
    stepCount: 0,
    roomName: 'Test Room',
  }

  it('initializes with the provided state', () => {
    const bridge = createGameBridge(initialState)
    expect(bridge.getState()).toEqual(initialState)
  })

  it('notifies subscriber immediately on subscribe and on subsequent emitState calls', () => {
    const bridge = createGameBridge(initialState)
    const listener = vi.fn()

    const unsubscribe = bridge.subscribe(listener)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith(initialState)

    const updatedState: PlayerHUDState = {
      ...initialState,
      gridX: 4,
      facing: 'RIGHT',
      stepCount: 1,
      isMoving: true,
    }

    bridge.emitState(updatedState)
    expect(listener).toHaveBeenCalledTimes(2)
    expect(listener).toHaveBeenCalledWith(updatedState)
    expect(bridge.getState()).toEqual(updatedState)

    unsubscribe()
    bridge.emitState({ ...updatedState, stepCount: 2 })
    expect(listener).toHaveBeenCalledTimes(2) // No new calls after unsubscribe
  })

  it('clears listeners on destroy', () => {
    const bridge = createGameBridge(initialState)
    const listener = vi.fn()
    bridge.subscribe(listener)

    bridge.destroy()
    bridge.emitState({ ...initialState, stepCount: 5 })
    expect(listener).toHaveBeenCalledTimes(1) // only initial call
  })
})
