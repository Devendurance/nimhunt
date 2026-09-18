import { describe, expect, it } from 'vitest'
import {
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
  it('maps shell and every world to a distinct loopable track', () => {
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

/** Controllable fake audio element for manager tests. */
function createFakeAudioHarness(options: { rejectPlay?: boolean } = {}) {
  const instances: Array<{ src: string; played: number; paused: number; volume: number; loop: boolean }> = []
  const createAudio = (src: string): ManagedAudio => {
    const instance = { src, played: 0, paused: 0, volume: 0, loop: false }
    instances.push(instance)
    return {
      play: () => {
        instance.played += 1
        if (options.rejectPlay) return Promise.reject(new Error('AUTOPLAY_BLOCKED'))
        return Promise.resolve()
      },
      pause: () => {
        instance.paused += 1
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
    expect(harness.instances[0]?.played).toBe(3)
    manager.playBgm('angkor')
    expect(harness.instances).toHaveLength(2)
    expect(harness.instances[0]?.paused).toBeGreaterThanOrEqual(1)
    expect(manager.currentTrack()).toBe('angkor')
    manager.dispose()
  })

  it('loops BGM at presentation volume', () => {
    const harness = createFakeAudioHarness()
    const manager = new NimhuntAudioManager({
      createAudio: harness.createAudio,
      ...createStore(),
      subscribeToDom: false,
    })
    manager.playBgm('bavaria')
    expect(harness.instances[0]?.loop).toBe(true)
    expect(harness.instances[0]?.volume).toBe(BGM_VOLUME)
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
    expect(harness.instances[0]?.paused).toBeGreaterThanOrEqual(1)
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

describe('audio regression guard', () => {
  it('documents the presentation-only contract for reviewers', () => {
    expect(NIMHUNT_AUDIO_SFX_GUARD).toContain('ReplayAction')
  })
})
