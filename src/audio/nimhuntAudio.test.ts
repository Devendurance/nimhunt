import { describe, expect, it } from 'vitest'
import {
  BGM_TRACK_CONFIG,
  BGM_VOLUME,
  MISSION_WORLD_MAP,
  NIMHUNT_AUDIO_SFX_GUARD,
  NimhuntAudioManager,
  SFX_URLS,
  SFX_VOLUME,
  WORLD_TRACK_URLS,
  createHudSfxTracker,
  detectGameplaySfx,
  resolveMissionTrack,
  type HudSfxSnapshot,
  type ManagedAudio,
  type SfxKey,
} from './nimhuntAudio.ts'

const baseHud: HudSfxSnapshot = {
  hp: 100,
  gemsCollected: 0,
  chestsOpened: 0,
  goblinState: 'PATROL',
  gateState: 'LOCKED',
  runStatus: 'PLAYING',
}

function hud(patch: Partial<HudSfxSnapshot>): HudSfxSnapshot {
  return { ...baseHud, ...patch }
}

describe('world -> music mapping', () => {
  it('maps shell and every world to a distinct track', () => {
    const urls = Object.values(WORLD_TRACK_URLS)
    expect(new Set(urls).size).toBe(4)
    for (const url of urls) {
      expect(url).toMatch(/^\/audio\/music\//)
      expect(url).not.toMatch(/ /)
    }
  })

  it('maps all current Angkor missions to the Angkor track', () => {
    expect(resolveMissionTrack('gem-runner')).toBe('angkor')
    expect(resolveMissionTrack('chest-hunter')).toBe('angkor')
    expect(resolveMissionTrack('vault-breaker')).toBe('angkor')
    expect(WORLD_TRACK_URLS[resolveMissionTrack('gem-runner')]).toContain('Angkor')
  })

  it('keeps a world map entry so Bavaria/Siberia attach without code changes', () => {
    expect(WORLD_TRACK_URLS.bavaria).toContain('Bavaria')
    expect(WORLD_TRACK_URLS.siberia).toContain('Siberia')
    expect(Object.keys(MISSION_WORLD_MAP)).toContain('gem-runner')
  })

  it('falls back to the main theme for unknown missions (never the wrong world)', () => {
    expect(resolveMissionTrack('future-bavaria-mission')).toBe('main')
  })

  it('uses presentation-safe volumes', () => {
    expect(BGM_VOLUME).toBeGreaterThanOrEqual(0.3)
    expect(BGM_VOLUME).toBeLessThanOrEqual(0.4)
    expect(SFX_VOLUME).toBeGreaterThanOrEqual(0.6)
    expect(SFX_VOLUME).toBeLessThanOrEqual(0.75)
  })

  it('encodes spaces in every audio URL', () => {
    for (const url of [...Object.values(WORLD_TRACK_URLS), ...Object.values(SFX_URLS)]) {
      expect(url).not.toMatch(/ /)
      expect(decodeURI(url)).toMatch(/ /)
    }
  })
})

describe('gameplay SFX transitions', () => {
  it('fires Magic Circle once per real gem collection', () => {
    expect(detectGameplaySfx(hud({}), hud({ gemsCollected: 1 }))).toEqual(['magic-circle'])
  })

  it('fires Treasure once per chest and skips the gem sound for gem-loot chests', () => {
    // Chest with gem loot raises both counters in one transition: one treasure sound, no clash.
    expect(
      detectGameplaySfx(hud({}), hud({ chestsOpened: 1, gemsCollected: 2 })),
    ).toEqual(['treasure'])
  })

  it('fires Defeat Everyone only on alive -> DEFEATED (never stun/contact)', () => {
    expect(detectGameplaySfx(hud({}), hud({ goblinState: 'STUNNED' }))).toEqual([])
    expect(detectGameplaySfx(hud({ goblinState: 'CHASE' }), hud({ goblinState: 'STUNNED' }))).toEqual([])
    expect(detectGameplaySfx(hud({ goblinState: 'STUNNED' }), hud({ goblinState: 'DEFEATED' }))).toEqual(['defeat'])
    expect(detectGameplaySfx(hud({ goblinState: 'DEFEATED' }), hud({ goblinState: 'DEFEATED' }))).toEqual([])
  })

  it('fires Open The Gate once on LOCKED -> OPEN', () => {
    expect(detectGameplaySfx(hud({}), hud({ gateState: 'OPEN' }))).toEqual(['open-gate'])
    expect(detectGameplaySfx(hud({ gateState: 'OPEN' }), hud({ gateState: 'OPEN' }))).toEqual([])
  })

  it('fires Lose A Life only on a real HP decrease (blocked moves are silent)', () => {
    expect(detectGameplaySfx(hud({}), hud({ hp: 75 }))).toEqual(['lose-life'])
    expect(detectGameplaySfx(hud({}), hud({}))).toEqual([])
    expect(detectGameplaySfx(hud({ hp: 50 }), hud({ hp: 75 }))).toEqual([])
  })

  it('fires Stage Complete once when entering MISSION_COMPLETE', () => {
    expect(detectGameplaySfx(hud({}), hud({ runStatus: 'MISSION_COMPLETE' }))).toEqual(['stage-complete'])
    expect(
      detectGameplaySfx(hud({ runStatus: 'MISSION_COMPLETE' }), hud({ runStatus: 'MISSION_COMPLETE' })),
    ).toEqual([])
    expect(detectGameplaySfx(hud({}), hud({ runStatus: 'FAILED' }))).toEqual([])
  })
})

describe('transition tracker (dedup / re-arm / restore)', () => {
  function runSequence(runKey: string, states: HudSfxSnapshot[]): SfxKey[] {
    const out: SfxKey[] = []
    const tracker = createHudSfxTracker(key => out.push(key))
    for (const state of states) tracker.push(state, runKey)
    return out
  }

  it('never replays historical SFX when restoring an active run', () => {
    const restored = hud({ hp: 25, gemsCollected: 6, chestsOpened: 4, gateState: 'OPEN', runStatus: 'PLAYING' })
    expect(runSequence('run-abc', [restored])).toEqual([])
    expect(runSequence('run-abc', [restored, restored])).toEqual([])
  })

  it('fires completion once across verification rerenders', () => {
    const playing = hud({ gemsCollected: 6 })
    const complete = hud({ gemsCollected: 6, runStatus: 'MISSION_COMPLETE' })
    expect(runSequence('run-abc', [playing, complete, complete, complete])).toEqual(['stage-complete'])
  })

  it('re-arms one-shot guards on retry/reset (new runKey)', () => {
    const out: SfxKey[] = []
    const tracker = createHudSfxTracker(key => out.push(key))
    tracker.push(hud({}), 'run-1')
    tracker.push(hud({ gemsCollected: 1 }), 'run-1')
    // Retry starts at a fresh snapshot: arming push stays silent even mid-progress.
    tracker.push(hud({}), 'run-2')
    tracker.push(hud({ gemsCollected: 1 }), 'run-2')
    expect(out).toEqual(['magic-circle', 'magic-circle'])
  })

  it('does not carry completion across runs', () => {
    const out: SfxKey[] = []
    const tracker = createHudSfxTracker(key => out.push(key))
    tracker.push(hud({}), 'run-1')
    tracker.push(hud({ runStatus: 'MISSION_COMPLETE' }), 'run-1')
    tracker.push(hud({ runStatus: 'MISSION_COMPLETE' }), 'run-2')
    expect(out).toEqual(['stage-complete'])
  })

  it('emits nothing for identical snapshots', () => {
    expect(runSequence('run-1', [hud({}), hud({})])).toEqual([])
  })
})

/** Controllable fake audio element for manager tests. Models paused/currentTime/ended like a real element. */
function createFakeAudioHarness(options: { rejectPlay?: boolean } = {}) {
  const instances: Array<{
    src: string
    played: number
    pauseCount: number
    paused: boolean
    ended: boolean
    currentTime: number
    currentTimeWrites: number
    volume: number
    loop: boolean
  }> = []
  const createAudio = (src: string): ManagedAudio => {
    const instance = {
      src,
      played: 0,
      pauseCount: 0,
      paused: true,
      ended: false,
      currentTime: 0,
      currentTimeWrites: 0,
      volume: 0,
      loop: false,
    }
    instances.push(instance)
    return {
      play: () => {
        instance.played += 1
        if (options.rejectPlay) return Promise.reject(new Error('AUTOPLAY_BLOCKED'))
        instance.paused = false
        return Promise.resolve()
      },
      pause: () => {
        instance.pauseCount += 1
        instance.paused = true
      },
      get volume() {
        return instance.volume
      },
      set volume(value: number) {
        instance.volume = value
      },
      get loop() {
        return instance.loop
      },
      set loop(value: boolean) {
        instance.loop = value
      },
      get paused() {
        return instance.paused
      },
      get ended() {
        return instance.ended
      },
      get currentTime() {
        return instance.currentTime
      },
      set currentTime(value: number | undefined) {
        instance.currentTimeWrites += 1
        if (typeof value === 'number') instance.currentTime = value
      },
    }
  }
  return { instances, createAudio }
}

function createStore(initial: boolean | null = null) {
  let value = initial
  return {
    loadEnabled: () => value,
    saveEnabled: (enabled: boolean) => {
      value = enabled
    },
    get: () => value,
  }
}

describe('NimhuntAudioManager', () => {
  it('keeps exactly one active BGM element and never restarts the same track', () => {
    const harness = createFakeAudioHarness()
    const manager = new NimhuntAudioManager({
      createAudio: harness.createAudio,
      ...createStore(),
      subscribeToDom: false,
    })
    manager.playBgm('main')
    manager.playBgm('main')
    manager.playBgm('main')
    expect(harness.instances).toHaveLength(1)
    expect(harness.instances[0]?.played).toBe(1)
    manager.playBgm('angkor')
    expect(harness.instances).toHaveLength(2)
    expect(harness.instances[0]?.pauseCount).toBeGreaterThanOrEqual(1)
    expect(manager.currentTrack()).toBe('angkor')
    manager.dispose()
  })

  it('loops the main theme and plays world tracks as one-shot entrance themes', () => {
    expect(BGM_TRACK_CONFIG.main.loop).toBe(true)
    expect(BGM_TRACK_CONFIG.angkor.loop).toBe(false)
    expect(BGM_TRACK_CONFIG.bavaria.loop).toBe(false)
    expect(BGM_TRACK_CONFIG.siberia.loop).toBe(false)
    const harness = createFakeAudioHarness()
    const manager = new NimhuntAudioManager({
      createAudio: harness.createAudio,
      ...createStore(),
      subscribeToDom: false,
    })
    manager.playBgm('main')
    expect(harness.instances[0]?.loop).toBe(true)
    expect(harness.instances[0]?.volume).toBe(BGM_VOLUME)
    for (const world of ['angkor', 'bavaria', 'siberia'] as const) {
      manager.playBgm(world)
      expect(manager.currentTrack()).toBe(world)
      expect(harness.instances[harness.instances.length - 1]?.loop).toBe(false)
    }
    manager.dispose()
  })

  it('persists mute and restores it on next load; mute silences BGM + SFX', () => {
    const harness = createFakeAudioHarness()
    const store = createStore()
    const manager = new NimhuntAudioManager({
      createAudio: harness.createAudio,
      loadEnabled: store.loadEnabled,
      saveEnabled: store.saveEnabled,
      subscribeToDom: false,
    })
    expect(manager.isEnabled()).toBe(true)
    manager.playBgm('main')
    manager.setEnabled(false)
    expect(store.get()).toBe(false)
    expect(harness.instances[0]?.pauseCount).toBeGreaterThanOrEqual(1)
    const playedBefore = harness.instances[0]?.played ?? 0
    manager.playBgm('angkor')
    expect(harness.instances[0]?.played).toBe(playedBefore)
    manager.playSfx('treasure')
    expect(harness.instances).toHaveLength(1)
    manager.setEnabled(true)
    expect(manager.currentTrack()).toBe('angkor')
    manager.dispose()
  })

  it('defaults to enabled and never throws when audio is unavailable', () => {
    const manager = new NimhuntAudioManager({
      createAudio: () => null,
      loadEnabled: () => null,
      saveEnabled: () => {},
      subscribeToDom: false,
    })
    expect(manager.isEnabled()).toBe(true)
    expect(() => {
      manager.playBgm('main')
      manager.playSfx('treasure')
      manager.warmup()
      manager.unlock()
      manager.stopBgm()
    }).not.toThrow()
    manager.dispose()
  })

  it('fails gracefully on autoplay rejection and starts the pending track after unlock', async () => {
    const harness = createFakeAudioHarness({ rejectPlay: true })
    const manager = new NimhuntAudioManager({
      createAudio: harness.createAudio,
      ...createStore(),
      subscribeToDom: false,
    })
    let rejected: unknown = null
    try {
      manager.playBgm('main')
      await Promise.resolve()
      await new Promise(resolve => setTimeout(resolve, 0))
    } catch (error) {
      rejected = error
    }
    expect(rejected).toBeNull()
    expect(harness.instances).toHaveLength(1)
    manager.unlock()
    expect(harness.instances[0]?.played).toBeGreaterThanOrEqual(2)
    manager.dispose()
  })

  it('throttles rapid duplicate damage SFX but allows spaced damage events', () => {
    let now = 1000
    const harness = createFakeAudioHarness()
    const manager = new NimhuntAudioManager({
      createAudio: harness.createAudio,
      ...createStore(),
      now: () => now,
      subscribeToDom: false,
    })
    manager.playSfx('lose-life')
    manager.playSfx('lose-life')
    const plays = harness.instances.flatMap(instance => Array(instance.played).fill(instance.src))
    const damagePlays = plays.filter(src => String(src).includes('09'))
    expect(damagePlays).toHaveLength(1)
    now += 500
    manager.playSfx('lose-life')
    const damagePlaysAfter = harness.instances
      .flatMap(instance => Array(instance.played).fill(instance.src))
      .filter(src => String(src).includes('09'))
    expect(damagePlaysAfter).toHaveLength(2)
    manager.dispose()
  })

  it('allows overlapping different SFX', () => {
    const harness = createFakeAudioHarness()
    const manager = new NimhuntAudioManager({
      createAudio: harness.createAudio,
      ...createStore(),
      subscribeToDom: false,
    })
    manager.playSfx('treasure')
    manager.playSfx('magic-circle')
    const played = harness.instances.filter(instance => instance.played > 0)
    expect(played).toHaveLength(2)
    manager.dispose()
  })
})

function flushMicrotasks(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0))
}

/** Fake with a mutable autoplay gate: blocked (mobile) until the test allows playback. */
function createGatedAudioHarness() {
  const gate = { reject: true }
  const instances: Array<{
    src: string
    played: number
    pauseCount: number
    paused: boolean
    ended: boolean
    currentTime: number
    currentTimeWrites: number
    volume: number
    loop: boolean
  }> = []
  const createAudio = (src: string): ManagedAudio => {
    const instance = {
      src,
      played: 0,
      pauseCount: 0,
      paused: true,
      ended: false,
      currentTime: 0,
      currentTimeWrites: 0,
      volume: 0,
      loop: false,
    }
    instances.push(instance)
    return {
      play: () => {
        instance.played += 1
        if (gate.reject) return Promise.reject(new Error('AUTOPLAY_BLOCKED'))
        instance.paused = false
        return Promise.resolve()
      },
      pause: () => {
        instance.pauseCount += 1
        instance.paused = true
      },
      get volume() {
        return instance.volume
      },
      set volume(value: number) {
        instance.volume = value
      },
      get loop() {
        return instance.loop
      },
      set loop(value: boolean) {
        instance.loop = value
      },
      get paused() {
        return instance.paused
      },
      get ended() {
        return instance.ended
      },
      get currentTime() {
        return instance.currentTime
      },
      set currentTime(value: number | undefined) {
        instance.currentTimeWrites += 1
        if (typeof value === 'number') instance.currentTime = value
      },
    }
  }
  return { gate, instances, createAudio }
}

/** Minimal window/document stubs so gesture + visibility listener lifecycle is testable in node. */
function installDomStubs() {
  const gestureHandlers = new Map<string, () => void>()
  const removed: string[] = []
  let visibilityHandler: (() => void) | null = null
  let hidden = false
  const fakeWindow = {
    addEventListener: (type: string, cb: () => void) => {
      gestureHandlers.set(type, cb)
    },
    removeEventListener: (type: string) => {
      removed.push(type)
      gestureHandlers.delete(type)
    },
  }
  const fakeDocument = {
    get hidden() {
      return hidden
    },
    addEventListener: (type: string, cb: () => void) => {
      if (type === 'visibilitychange') visibilityHandler = cb
    },
    removeEventListener: () => {},
  }
  ;(globalThis as Record<string, unknown>).window = fakeWindow
  ;(globalThis as Record<string, unknown>).document = fakeDocument
  return {
    gestureHandlers,
    removed,
    fireVisibility: () => visibilityHandler?.(),
    setHidden: (value: boolean) => {
      hidden = value
    },
    cleanup: () => {
      delete (globalThis as Record<string, unknown>).window
      delete (globalThis as Record<string, unknown>).document
    },
  }
}

describe('BGM restart regression (one-shot unlock + idempotence)', () => {
  it('first gesture unlocks/starts BGM; 10 repeated gestures never restart it', async () => {
    const harness = createGatedAudioHarness()
    const manager = new NimhuntAudioManager({
      createAudio: harness.createAudio,
      ...createStore(),
      subscribeToDom: false,
    })
    manager.playBgm('main')
    await flushMicrotasks()
    // Autoplay blocked: still locked, track remembered.
    expect(manager.isUnlocked()).toBe(false)
    expect(harness.instances).toHaveLength(1)
    const blockedPlays = harness.instances[0]?.played ?? 0
    harness.gate.reject = false
    manager.unlock()
    await flushMicrotasks()
    expect(manager.isUnlocked()).toBe(true)
    const startedPlays = harness.instances[0]?.played ?? 0
    expect(startedPlays).toBe(blockedPlays + 1)
    // Simulate playback progress, then hammer with gestures (scrolls/taps).
    harness.instances[0]!.currentTime = 42
    for (let i = 0; i < 10; i += 1) manager.unlock()
    await flushMicrotasks()
    expect(harness.instances).toHaveLength(1)
    expect(harness.instances[0]?.played).toBe(startedPlays)
    expect(harness.instances[0]?.currentTime).toBe(42)
    expect(manager.currentTrack()).toBe('main')
    manager.dispose()
  })

  it('touchstart + pointerdown double-fire starts the track once and detaches listeners', async () => {
    const dom = installDomStubs()
    try {
      const harness = createGatedAudioHarness()
      const manager = new NimhuntAudioManager({
        createAudio: harness.createAudio,
        ...createStore(),
      })
      manager.playBgm('main')
      await flushMicrotasks()
      expect(manager.isUnlocked()).toBe(false)
      harness.gate.reject = false
      const before = harness.instances[0]?.played ?? 0
      // One physical touch fires both: the second must be a no-op.
      dom.gestureHandlers.get('touchstart')?.()
      dom.gestureHandlers.get('pointerdown')?.()
      await flushMicrotasks()
      expect(harness.instances).toHaveLength(1)
      expect(harness.instances[0]?.played).toBe(before + 1)
      expect(manager.isUnlocked()).toBe(true)
      expect(dom.removed).toContain('pointerdown')
      expect(dom.removed).toContain('touchstart')
      expect(dom.removed).toContain('keydown')
      // A stale keydown closure after detach still cannot restart playback.
      const staleKeydown = dom.gestureHandlers.get('keydown')
      staleKeydown?.()
      await flushMicrotasks()
      expect(harness.instances[0]?.played).toBe(before + 1)
      manager.dispose()
    } finally {
      dom.cleanup()
    }
  })

  it('same-track playBgm never touches currentTime once playing', async () => {
    const harness = createFakeAudioHarness()
    const manager = new NimhuntAudioManager({
      createAudio: harness.createAudio,
      ...createStore(),
      subscribeToDom: false,
    })
    manager.playBgm('main')
    await flushMicrotasks()
    harness.instances[0]!.currentTime = 42
    const writes = harness.instances[0]?.currentTimeWrites ?? 0
    manager.playBgm('main')
    manager.playBgm('main')
    manager.playBgm('main')
    await flushMicrotasks()
    expect(harness.instances).toHaveLength(1)
    expect(harness.instances[0]?.played).toBe(1)
    expect(harness.instances[0]?.currentTime).toBe(42)
    expect(harness.instances[0]?.currentTimeWrites).toBe(writes)
    manager.dispose()
  })

  it('visibility hide/show pauses and resumes the same track from its currentTime', async () => {
    const dom = installDomStubs()
    try {
      const harness = createFakeAudioHarness()
      const manager = new NimhuntAudioManager({
        createAudio: harness.createAudio,
        ...createStore(),
      })
      manager.playBgm('main')
      await flushMicrotasks()
      expect(manager.isUnlocked()).toBe(true)
      harness.instances[0]!.currentTime = 77
      const playedBefore = harness.instances[0]?.played ?? 0
      dom.setHidden(true)
      dom.fireVisibility()
      expect(harness.instances[0]?.pauseCount).toBeGreaterThanOrEqual(1)
      expect(harness.instances[0]?.currentTime).toBe(77)
      expect(harness.instances[0]?.played).toBe(playedBefore)
      dom.setHidden(false)
      dom.fireVisibility()
      await flushMicrotasks()
      expect(harness.instances).toHaveLength(1)
      expect(harness.instances[0]?.played).toBe(playedBefore + 1)
      expect(harness.instances[0]?.currentTime).toBe(77)
      expect(manager.currentTrack()).toBe('main')
      manager.dispose()
    } finally {
      dom.cleanup()
    }
  })

  it('mute/unmute resumes from currentTime instead of restarting', async () => {
    const harness = createFakeAudioHarness()
    const manager = new NimhuntAudioManager({
      createAudio: harness.createAudio,
      ...createStore(),
      subscribeToDom: false,
    })
    manager.playBgm('main')
    await flushMicrotasks()
    harness.instances[0]!.currentTime = 55
    const playedBefore = harness.instances[0]?.played ?? 0
    manager.setEnabled(false)
    expect(harness.instances[0]?.pauseCount).toBeGreaterThanOrEqual(1)
    manager.setEnabled(true)
    await flushMicrotasks()
    expect(harness.instances).toHaveLength(1)
    expect(harness.instances[0]?.played).toBe(playedBefore + 1)
    expect(harness.instances[0]?.currentTime).toBe(55)
    manager.dispose()
  })

  it('switching to a different track starts the new track exactly once', async () => {
    const harness = createFakeAudioHarness()
    const manager = new NimhuntAudioManager({
      createAudio: harness.createAudio,
      ...createStore(),
      subscribeToDom: false,
    })
    manager.playBgm('main')
    await flushMicrotasks()
    manager.playBgm('angkor')
    await flushMicrotasks()
    expect(harness.instances).toHaveLength(2)
    expect(harness.instances[0]?.pauseCount).toBeGreaterThanOrEqual(1)
    expect(harness.instances[1]?.played).toBe(1)
    expect(manager.currentTrack()).toBe('angkor')
    manager.playBgm('angkor')
    await flushMicrotasks()
    expect(harness.instances).toHaveLength(2)
    expect(harness.instances[1]?.played).toBe(1)
    manager.dispose()
  })

  it('SFX still work after unlock and never disturb BGM state', async () => {
    const harness = createGatedAudioHarness()
    const manager = new NimhuntAudioManager({
      createAudio: harness.createAudio,
      ...createStore(),
      subscribeToDom: false,
    })
    manager.playBgm('main')
    await flushMicrotasks()
    harness.gate.reject = false
    manager.unlock()
    await flushMicrotasks()
    expect(manager.isUnlocked()).toBe(true)
    const bgmPlays = harness.instances[0]?.played ?? 0
    manager.playSfx('treasure')
    const sfxPlayed = harness.instances
      .filter(instance => instance.src.includes('Treasure'))
      .some(instance => instance.played > 0)
    expect(sfxPlayed).toBe(true)
    expect(harness.instances[0]?.played).toBe(bgmPlays)
    expect(manager.isUnlocked()).toBe(true)
    manager.dispose()
  })

  it('autoplay rejection stays graceful, locked, and armed for a later gesture', async () => {
    const harness = createFakeAudioHarness({ rejectPlay: true })
    const manager = new NimhuntAudioManager({
      createAudio: harness.createAudio,
      ...createStore(),
      subscribeToDom: false,
    })
    manager.playBgm('main')
    await flushMicrotasks()
    expect(manager.isUnlocked()).toBe(false)
    manager.unlock()
    await flushMicrotasks()
    // Still blocked: no latch, no throw, still retryable.
    expect(manager.isUnlocked()).toBe(false)
    expect(harness.instances).toHaveLength(1)
    expect(harness.instances[0]?.played).toBeGreaterThanOrEqual(2)
    manager.dispose()
  })

  it('unlock with no desired track is a silent no-op', () => {
    const harness = createFakeAudioHarness()
    const manager = new NimhuntAudioManager({
      createAudio: harness.createAudio,
      ...createStore(),
      subscribeToDom: false,
    })
    expect(() => manager.unlock()).not.toThrow()
    expect(manager.isUnlocked()).toBe(false)
    expect(harness.instances).toHaveLength(0)
    manager.dispose()
  })
})

describe('audio regression guard', () => {
  it('documents the presentation-only contract for reviewers', () => {
    expect(NIMHUNT_AUDIO_SFX_GUARD).toContain('ReplayAction')
  })
})

/** Simulates a non-looping track reaching its natural end. */
function finishNaturally(instance: { paused: boolean; ended: boolean }): void {
  instance.paused = true
  instance.ended = true
}

describe('world entrance one-shot themes', () => {
  it('ended Angkor + same-track request never replays (no play, no seek, no new element)', async () => {
    const harness = createFakeAudioHarness()
    const manager = new NimhuntAudioManager({
      createAudio: harness.createAudio,
      ...createStore(),
      subscribeToDom: false,
    })
    manager.playBgm('angkor')
    await flushMicrotasks()
    expect(harness.instances).toHaveLength(1)
    expect(harness.instances[0]?.played).toBe(1)
    finishNaturally(harness.instances[0]!)
    const writes = harness.instances[0]?.currentTimeWrites ?? 0
    manager.playBgm('angkor')
    await flushMicrotasks()
    expect(harness.instances).toHaveLength(1)
    expect(harness.instances[0]?.played).toBe(1)
    expect(harness.instances[0]?.currentTimeWrites).toBe(writes)
    manager.dispose()
  })

  it('10 rerenders after the world track ended cause zero additional plays', async () => {
    const harness = createFakeAudioHarness()
    const manager = new NimhuntAudioManager({
      createAudio: harness.createAudio,
      ...createStore(),
      subscribeToDom: false,
    })
    manager.playBgm('siberia')
    await flushMicrotasks()
    finishNaturally(harness.instances[0]!)
    for (let i = 0; i < 10; i += 1) manager.playBgm('siberia')
    await flushMicrotasks()
    expect(harness.instances).toHaveLength(1)
    expect(harness.instances[0]?.played).toBe(1)
    manager.dispose()
  })

  it('repeated unlock gestures after the world track ended never replay it', async () => {
    const harness = createFakeAudioHarness()
    const manager = new NimhuntAudioManager({
      createAudio: harness.createAudio,
      ...createStore(),
      subscribeToDom: false,
    })
    manager.playBgm('angkor')
    await flushMicrotasks()
    finishNaturally(harness.instances[0]!)
    const played = harness.instances[0]?.played ?? 0
    for (let i = 0; i < 10; i += 1) manager.unlock()
    await flushMicrotasks()
    expect(harness.instances).toHaveLength(1)
    expect(harness.instances[0]?.played).toBe(played)
    manager.dispose()
  })

  it('hide/show while the world track is playing resumes from the same currentTime', async () => {
    const dom = installDomStubs()
    try {
      const harness = createFakeAudioHarness()
      const manager = new NimhuntAudioManager({
        createAudio: harness.createAudio,
        ...createStore(),
      })
      manager.playBgm('bavaria')
      await flushMicrotasks()
      harness.instances[0]!.currentTime = 33
      const playedBefore = harness.instances[0]?.played ?? 0
      dom.setHidden(true)
      dom.fireVisibility()
      expect(harness.instances[0]?.pauseCount).toBeGreaterThanOrEqual(1)
      expect(harness.instances[0]?.currentTime).toBe(33)
      dom.setHidden(false)
      dom.fireVisibility()
      await flushMicrotasks()
      expect(harness.instances).toHaveLength(1)
      expect(harness.instances[0]?.played).toBe(playedBefore + 1)
      expect(harness.instances[0]?.currentTime).toBe(33)
      manager.dispose()
    } finally {
      dom.cleanup()
    }
  })

  it('hide/show after the world track ended stays silent', async () => {
    const dom = installDomStubs()
    try {
      const harness = createFakeAudioHarness()
      const manager = new NimhuntAudioManager({
        createAudio: harness.createAudio,
        ...createStore(),
      })
      manager.playBgm('angkor')
      await flushMicrotasks()
      finishNaturally(harness.instances[0]!)
      const played = harness.instances[0]?.played ?? 0
      dom.setHidden(true)
      dom.fireVisibility()
      dom.setHidden(false)
      dom.fireVisibility()
      await flushMicrotasks()
      expect(harness.instances).toHaveLength(1)
      expect(harness.instances[0]?.played).toBe(played)
      manager.dispose()
    } finally {
      dom.cleanup()
    }
  })

  it('mute/unmute while the world track is playing resumes instead of restarting', async () => {
    const harness = createFakeAudioHarness()
    const manager = new NimhuntAudioManager({
      createAudio: harness.createAudio,
      ...createStore(),
      subscribeToDom: false,
    })
    manager.playBgm('angkor')
    await flushMicrotasks()
    harness.instances[0]!.currentTime = 21
    const playedBefore = harness.instances[0]?.played ?? 0
    manager.setEnabled(false)
    expect(harness.instances[0]?.pauseCount).toBeGreaterThanOrEqual(1)
    manager.setEnabled(true)
    await flushMicrotasks()
    expect(harness.instances).toHaveLength(1)
    expect(harness.instances[0]?.played).toBe(playedBefore + 1)
    expect(harness.instances[0]?.currentTime).toBe(21)
    manager.dispose()
  })

  it('mute/unmute after the world track ended stays silent', async () => {
    const harness = createFakeAudioHarness()
    const manager = new NimhuntAudioManager({
      createAudio: harness.createAudio,
      ...createStore(),
      subscribeToDom: false,
    })
    manager.playBgm('angkor')
    await flushMicrotasks()
    finishNaturally(harness.instances[0]!)
    const played = harness.instances[0]?.played ?? 0
    manager.setEnabled(false)
    manager.setEnabled(true)
    await flushMicrotasks()
    expect(harness.instances).toHaveLength(1)
    expect(harness.instances[0]?.played).toBe(played)
    manager.dispose()
  })

  it('exiting gameplay restores the looping main theme', async () => {
    const harness = createFakeAudioHarness()
    const manager = new NimhuntAudioManager({
      createAudio: harness.createAudio,
      ...createStore(),
      subscribeToDom: false,
    })
    manager.playBgm('main')
    await flushMicrotasks()
    manager.playBgm('angkor')
    await flushMicrotasks()
    finishNaturally(harness.instances[1]!)
    manager.playBgm('main')
    await flushMicrotasks()
    expect(harness.instances).toHaveLength(3)
    expect(harness.instances[2]?.loop).toBe(true)
    expect(harness.instances[2]?.played).toBe(1)
    expect(manager.currentTrack()).toBe('main')
    manager.dispose()
  })

  it('re-entering a world after the main theme starts a fresh one-shot once', async () => {
    const harness = createFakeAudioHarness()
    const manager = new NimhuntAudioManager({
      createAudio: harness.createAudio,
      ...createStore(),
      subscribeToDom: false,
    })
    manager.playBgm('main')
    await flushMicrotasks()
    manager.playBgm('angkor')
    await flushMicrotasks()
    finishNaturally(harness.instances[1]!)
    manager.playBgm('main')
    await flushMicrotasks()
    manager.playBgm('angkor')
    await flushMicrotasks()
    expect(harness.instances).toHaveLength(4)
    expect(harness.instances[3]?.loop).toBe(false)
    expect(harness.instances[3]?.played).toBe(1)
    expect(harness.instances[3]?.currentTime).toBe(0)
    expect(manager.currentTrack()).toBe('angkor')
    manager.dispose()
  })

  it('gameplay SFX still fire after the world entrance theme ends', async () => {
    const harness = createFakeAudioHarness()
    const manager = new NimhuntAudioManager({
      createAudio: harness.createAudio,
      ...createStore(),
      subscribeToDom: false,
    })
    manager.playBgm('angkor')
    await flushMicrotasks()
    finishNaturally(harness.instances[0]!)
    manager.playSfx('treasure')
    manager.playSfx('magic-circle')
    const played = harness.instances.filter(instance => instance.played > 0)
    expect(played.some(instance => instance.src.includes('Treasure'))).toBe(true)
    expect(played.some(instance => String(instance.src).includes('Magic%20Circle'))).toBe(true)
    // The finished BGM element itself gained no extra plays.
    expect(harness.instances[0]?.played).toBe(1)
    manager.dispose()
  })
})
