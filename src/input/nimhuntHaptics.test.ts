import { describe, expect, it, vi } from 'vitest'
import {
  createHudHapticsTracker,
  detectGameplayHaptic,
  HAPTICS_GUARD,
  NimhuntHapticsManager,
  type HudHapticsSnapshot,
} from './nimhuntHaptics.ts'

const baseHud: HudHapticsSnapshot = {
  hp: 100,
  gemsCollected: 0,
  chestsOpened: 0,
  hasTempleKey: false,
  hasSword: false,
  goblinState: 'PATROL',
  gateState: 'LOCKED',
  runStatus: 'PLAYING',
}

describe('P6 presentation-only haptics', () => {
  it('detects meaningful HUD events without using movement/replay state', () => {
    expect(detectGameplayHaptic(baseHud, { ...baseHud, gemsCollected: 1 })).toBe(10)
    expect(detectGameplayHaptic(baseHud, { ...baseHud, hp: 75 })).toBe(22)
    expect(detectGameplayHaptic(baseHud, { ...baseHud, runStatus: 'MISSION_COMPLETE' })).toEqual([16, 28, 16])
    expect(detectGameplayHaptic(baseHud, baseHud)).toBeNull()
  })

  it('arms silently on a restored run and emits only later presentation transitions', () => {
    const emit = vi.fn()
    const tracker = createHudHapticsTracker(emit)
    const restored = { ...baseHud, gemsCollected: 4 }
    tracker.push(restored, 'run-1')
    expect(emit).not.toHaveBeenCalled()
    tracker.push({ ...restored, gemsCollected: 5 }, 'run-1')
    expect(emit).toHaveBeenCalledWith(10)
    tracker.push({ ...restored, gemsCollected: 5 }, 'run-2')
    expect(emit).toHaveBeenCalledTimes(1)
  })

  it('feature-detects, persists, throttles, and suppresses reduced-motion vibration', () => {
    let now = 0
    const vibrate = vi.fn(() => true)
    const saveEnabled = vi.fn()
    const manager = new NimhuntHapticsManager({
      vibrate,
      loadEnabled: () => false,
      saveEnabled,
      now: () => now,
      prefersReducedMotion: () => false,
    })

    expect(manager.isSupported()).toBe(true)
    expect(manager.isEnabled()).toBe(false)
    manager.setEnabled(true)
    expect(manager.isEnabled()).toBe(true)
    expect(saveEnabled).toHaveBeenCalledWith(true)
    expect(manager.vibrate(10)).toBe(true)
    now = 40
    expect(manager.vibrate(10)).toBe(false)
    now = 100
    expect(manager.vibrate([16, 28, 16])).toBe(true)
    expect(vibrate).toHaveBeenCalledTimes(2)

    const reduced = new NimhuntHapticsManager({ vibrate, prefersReducedMotion: () => true })
    expect(reduced.vibrate(10)).toBe(false)
  })

  it('does not expose or persist a dead toggle when vibrate is unavailable', () => {
    const saveEnabled = vi.fn()
    const manager = new NimhuntHapticsManager({ vibrate: null, saveEnabled })
    expect(manager.isSupported()).toBe(false)
    expect(manager.isEnabled()).toBe(false)
    manager.setEnabled(true)
    expect(saveEnabled).not.toHaveBeenCalled()
  })

  it('documents the client-only guard', () => {
    expect(HAPTICS_GUARD).toContain('never ReplayAction')
    expect(HAPTICS_GUARD).toContain('never ReplayAction, checkpoint, hash, server, reward, payout, or DB.')
  })
})
