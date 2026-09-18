/**
 * NimHunt presentation-only audio service (client-only).
 *
 * SCOPE GUARANTEE — audio must NEVER enter:
 * - ReplayAction / checkpoint payloads / hashes / server state / deterministic replay
 * - reward, payout, or DB logic
 *
 * This module owns background music (one active track max) and one-shot
 * gameplay SFX. It degrades silently: when audio is unavailable, blocked, or
 * muted, gameplay continues unaffected and no errors are thrown.
 */

export type BgmTrackKey = 'main' | 'angkor' | 'bavaria' | 'siberia'

export type SfxKey =
  | 'magic-circle'
  | 'defeat'
  | 'open-gate'
  | 'treasure'
  | 'lose-life'
  | 'stage-complete'

export const BGM_VOLUME = 0.35
export const SFX_VOLUME = 0.7

export const SOUND_STORAGE_KEY = 'nimhunt:sound-enabled'

/**
 * Reviewer contract: this audio layer is presentation-only and must never
 * feed ReplayAction, checkpoint payloads, replay hashes, server state,
 * reward/payout logic, or the database. SFX derive exclusively from client
 * HUD state transitions observed after the authoritative engine emits them.
 */
export const NIMHUNT_AUDIO_SFX_GUARD =
  'PRESENTATION_ONLY: never ReplayAction, checkpoint, hash, server, reward, payout, or DB.'

/** World -> background music file. Presentation mapping only. */
export const WORLD_TRACK_URLS: Record<BgmTrackKey, string> = {
  main: encodeURI('/audio/music/01 - Main NimHunt Theme.mp3'),
  angkor: encodeURI('/audio/music/02 - Angkor Ruins.mp3'),
  bavaria: encodeURI('/audio/music/03 - Bavaria.mp3'),
  siberia: encodeURI('/audio/music/04 - Siberia.mp3'),
}

/** Gameplay SFX files. Presentation mapping only. */
export const SFX_URLS: Record<SfxKey, string> = {
  'magic-circle': encodeURI('/audio/sfx/05 - Magic Circle.wav'),
  defeat: encodeURI('/audio/sfx/06 - Defeat Everyone.wav'),
  'open-gate': encodeURI('/audio/sfx/07 - Open The Gate.wav'),
  treasure: encodeURI('/audio/sfx/08 - Treasure.wav'),
  'lose-life': encodeURI('/audio/sfx/09 - Lose A Life.wav'),
  'stage-complete': encodeURI('/audio/sfx/10 - Stage Complete.wav'),
}

/**
 * Mission -> world music mapping. All currently playable missions take place
 * in Angkor. When Bavaria/Siberia missions become playable, add one line here
 * (e.g. `'sunken-chapel': 'bavaria'`) and their gameplay music follows
 * automatically. Unknown missions fall back to the main theme so gameplay
 * never plays the wrong world's music.
 */
export const MISSION_WORLD_MAP: Record<string, BgmTrackKey> = {
  'gem-runner': 'angkor',
  'chest-hunter': 'angkor',
  'vault-breaker': 'angkor',
}

export function resolveMissionTrack(mission: string): BgmTrackKey {
  return MISSION_WORLD_MAP[mission] ?? 'main'
}

export function resolveWorldTrack(world: BgmTrackKey): string {
  return WORLD_TRACK_URLS[world]
}

/** Minimal HUD snapshot the SFX layer is allowed to observe. */
export interface HudSfxSnapshot {
  readonly hp: number
  readonly gemsCollected: number
  readonly chestsOpened: number
  readonly goblinState: string
  readonly gateState: string
  readonly runStatus: string
}

/**
 * Pure transition detector: maps an actual HUD state transition to the SFX
 * that must fire. No timers, no side effects, no replay awareness.
 *
 * Rules (presentation only):
 * - gem sound only when gems rise WITHOUT a chest opening in the same
 *   transition (gem-loot chests are covered by the treasure sound, avoiding
 *   a double-fire on the same move).
 * - damage sound only on a real HP decrease (blocked moves change nothing).
 * - goblin sound only on alive -> DEFEATED (never for stun/contact).
 * - gate sound only on LOCKED -> OPEN.
 * - completion sound only on entering MISSION_COMPLETE.
 */
export function detectGameplaySfx(prev: HudSfxSnapshot, next: HudSfxSnapshot): SfxKey[] {
  const out: SfxKey[] = []
  if (next.hp < prev.hp) out.push('lose-life')
  const chestOpened = next.chestsOpened > prev.chestsOpened
  if (chestOpened) out.push('treasure')
  if (next.gemsCollected > prev.gemsCollected && !chestOpened) out.push('magic-circle')
  if (prev.gateState === 'LOCKED' && next.gateState === 'OPEN') out.push('open-gate')
  if (prev.goblinState !== 'DEFEATED' && next.goblinState === 'DEFEATED') out.push('defeat')
  if (prev.runStatus !== 'MISSION_COMPLETE' && next.runStatus === 'MISSION_COMPLETE') out.push('stage-complete')
  return out
}

/**
 * Stateful transition tracker. The FIRST snapshot seen for a runKey only arms
 * the tracker and never emits, so restoring an active run (or re-mounting
 * after server verification) replays no historical SFX. A new runKey re-arms.
 */
export function createHudSfxTracker(emit: (key: SfxKey) => void): {
  push: (hud: HudSfxSnapshot, runKey: string) => void
} {
  let armedKey: string | null = null
  let prev: HudSfxSnapshot | null = null
  return {
    push(hud: HudSfxSnapshot, runKey: string) {
      if (armedKey !== runKey) {
        armedKey = runKey
        prev = hud
        return
      }
      if (!prev) {
        prev = hud
        return
      }
      for (const key of detectGameplaySfx(prev, hud)) emit(key)
      prev = hud
    },
  }
}

/** Minimal audio element surface the manager needs (HTMLAudioElement satisfies this). */
export interface ManagedAudio {
  play: () => Promise<void> | void
  pause: () => void
  volume: number
  loop: boolean
}

export interface NimhuntAudioDeps {
  readonly createAudio?: (src: string) => ManagedAudio | null
  readonly loadEnabled?: () => boolean | null
  readonly saveEnabled?: (enabled: boolean) => void
  readonly now?: () => number
  /** Set false in tests to skip global gesture/visibility listeners. */
  readonly subscribeToDom?: boolean
}

const LOSE_LIFE_MIN_INTERVAL_MS = 400
const STAGE_COMPLETE_MIN_INTERVAL_MS = 2000
const SFX_MIN_INTERVAL_MS = 250
const SFX_POOL_SIZE = 2

function defaultCreateAudio(src: string): ManagedAudio | null {
  try {
    if (typeof Audio === 'undefined') return null
    const el = new Audio(src)
    el.preload = 'auto'
    return {
      play: () => {
        try {
          el.currentTime = 0
        } catch {
          // currentTime reset is best-effort; play must still be attempted.
        }
        return el.play()
      },
      pause: () => {
        try {
          el.pause()
        } catch {
          // Pause must never throw into gameplay.
        }
      },
      get volume() {
        return el.volume
      },
      set volume(value: number) {
        try {
          el.volume = value
        } catch {
          // Volume is best-effort.
        }
      },
      get loop() {
        return el.loop
      },
      set loop(value: boolean) {
        try {
          el.loop = value
        } catch {
          // Loop flag is best-effort.
        }
      },
    }
  } catch {
    return null
  }
}

function defaultLoadEnabled(): boolean | null {
  try {
    if (typeof localStorage === 'undefined') return null
    const raw = localStorage.getItem(SOUND_STORAGE_KEY)
    if (raw === 'true') return true
    if (raw === 'false') return false
    return null
  } catch {
    return null
  }
}

function defaultSaveEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(SOUND_STORAGE_KEY, enabled ? 'true' : 'false')
  } catch {
    // Persistence is best-effort; muted state must never block gameplay.
  }
}

/**
 * Single-owner client audio manager. Exactly one BGM element is active at a
 * time; same-track requests never restart the track. All play() rejections
 * (mobile autoplay blocks, Nimiq Pay webview policy) are swallowed and the
 * desired track is retried after the next user gesture.
 */
export class NimhuntAudioManager {
  private readonly createAudio: (src: string) => ManagedAudio | null
  private readonly saveEnabled: (enabled: boolean) => void
  private readonly now: () => number
  private enabled: boolean
  private desiredTrack: BgmTrackKey | null = null
  private bgmTrack: BgmTrackKey | null = null
  private bgmAudio: ManagedAudio | null = null
  private bgmBlocked = false
  private hiddenPaused = false
  private readonly pools = new Map<SfxKey, ManagedAudio[]>()
  private poolCursor = 0
  private readonly lastSfxAt = new Map<SfxKey, number>()
  private readonly listeners = new Set<(enabled: boolean) => void>()
  private domSubscribed = false
  private readonly onGesture = () => this.unlock()
  private readonly onVisibility = () => this.handleVisibility()

  constructor(deps: NimhuntAudioDeps = {}) {
    this.createAudio = deps.createAudio ?? defaultCreateAudio
    this.saveEnabled = deps.saveEnabled ?? defaultSaveEnabled
    this.now = deps.now ?? (() => Date.now())
    this.enabled = readInitialEnabled(deps.loadEnabled ?? defaultLoadEnabled)
    if (deps.subscribeToDom !== false) this.subscribeDom()
  }

  isEnabled(): boolean {
    return this.enabled
  }

  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return
    this.enabled = enabled
    try {
      this.saveEnabled(enabled)
    } catch {
      // Persistence must never throw into UI.
    }
    if (!enabled) {
      this.safePauseBgm()
    } else if (this.desiredTrack) {
      this.playBgm(this.desiredTrack)
    }
    for (const listener of this.listeners) {
      try {
        listener(enabled)
      } catch {
        // Listener errors must never break the toggle.
      }
    }
  }

  subscribe(listener: (enabled: boolean) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  currentTrack(): BgmTrackKey | null {
    return this.bgmTrack
  }

  /** Request a BGM track. Same-track requests never restart the audio. */
  playBgm(track: BgmTrackKey): void {
    this.desiredTrack = track
    if (!this.enabled) return
    if (this.bgmTrack === track && this.bgmAudio) {
      this.attemptBgmPlay()
      return
    }
    this.safePauseBgm()
    this.bgmTrack = track
    this.bgmAudio = null
    const audio = createAudioSafe(this.createAudio, WORLD_TRACK_URLS[track])
    if (!audio) return
    try {
      audio.loop = true
      audio.volume = BGM_VOLUME
    } catch {
      // Flags are best-effort.
    }
    this.bgmAudio = audio
    this.attemptBgmPlay()
  }

  stopBgm(): void {
    this.desiredTrack = null
    this.bgmTrack = null
    this.safePauseBgm()
    this.bgmAudio = null
  }

  /** Fire a one-shot SFX. Muted, throttled, or unavailable audio is a no-op. */
  playSfx(key: SfxKey): void {
    if (!this.enabled) return
    const now = this.safeNow()
    const minInterval =
      key === 'lose-life'
        ? LOSE_LIFE_MIN_INTERVAL_MS
        : key === 'stage-complete'
          ? STAGE_COMPLETE_MIN_INTERVAL_MS
          : SFX_MIN_INTERVAL_MS
    const last = this.lastSfxAt.get(key) ?? Number.NEGATIVE_INFINITY
    if (now - last < minInterval) return
    const audio = this.nextPooledAudio(key)
    if (!audio) return
    this.lastSfxAt.set(key, now)
    try {
      audio.volume = SFX_VOLUME
    } catch {
      // Volume is best-effort.
    }
    this.swallowPlay(audio)
  }

  /**
   * Opportunistic non-blocking warmup: builds the SFX pool so first plays
   * start fast. Never plays anything and never gates game boot.
   */
  warmup(): void {
    if (!this.enabled) return
    try {
      for (const key of Object.keys(SFX_URLS) as SfxKey[]) this.nextPooledAudio(key)
    } catch {
      // Warmup must never throw.
    }
  }

  /** Called on first user gesture; retries the desired track if blocked. */
  unlock(): void {
    if (!this.enabled || !this.desiredTrack) return
    if (this.bgmTrack === this.desiredTrack && this.bgmAudio && !this.bgmBlocked) {
      this.attemptBgmPlay()
      return
    }
    this.bgmBlocked = false
    this.playBgm(this.desiredTrack)
  }

  dispose(): void {
    if (typeof window !== 'undefined' && this.domSubscribed) {
      try {
        window.removeEventListener('pointerdown', this.onGesture, true)
        window.removeEventListener('touchstart', this.onGesture, true)
        window.removeEventListener('keydown', this.onGesture, true)
        document.removeEventListener('visibilitychange', this.onVisibility)
      } catch {
        // Teardown is best-effort.
      }
      this.domSubscribed = false
    }
    this.listeners.clear()
  }

  private subscribeDom(): void {
    try {
      if (typeof window === 'undefined' || typeof document === 'undefined') return
      window.addEventListener('pointerdown', this.onGesture, true)
      window.addEventListener('touchstart', this.onGesture, true)
      window.addEventListener('keydown', this.onGesture, true)
      document.addEventListener('visibilitychange', this.onVisibility)
      this.domSubscribed = true
    } catch {
      // Audio unlock/visibility handling is best-effort.
    }
  }

  private handleVisibility(): void {
    try {
      if (document.hidden) {
        this.hiddenPaused = true
        this.safePauseBgm()
        return
      }
      if (this.hiddenPaused) {
        this.hiddenPaused = false
        if (this.enabled && this.desiredTrack) this.playBgm(this.desiredTrack)
      }
    } catch {
      // Visibility handling must never throw into gameplay.
    }
  }

  private attemptBgmPlay(): void {
    const audio = this.bgmAudio
    if (!audio) return
    if (this.swallowPlay(audio)) this.bgmBlocked = false
    else this.bgmBlocked = true
  }

  /**
   * Attempts playback, swallowing every autoplay rejection / sync throw so
   * audio failures never surface as console noise or unhandled rejections.
   * Returns true when playback was (re)attempted without an immediate block.
   */
  private swallowPlay(audio: ManagedAudio): boolean {
    try {
      const result = audio.play()
      if (result && typeof (result as Promise<void>).catch === 'function') {
        ;(result as Promise<void>).catch(() => {
          this.bgmBlocked = true
        })
        return true
      }
      return true
    } catch {
      return false
    }
  }

  private safePauseBgm(): void {
    try {
      this.bgmAudio?.pause()
    } catch {
      // Pause must never throw.
    }
  }

  private nextPooledAudio(key: SfxKey): ManagedAudio | null {
    let pool = this.pools.get(key)
    if (!pool) {
      pool = []
      try {
        for (let i = 0; i < SFX_POOL_SIZE; i += 1) {
          const audio = this.createAudio(SFX_URLS[key])
          if (audio) {
            try {
              audio.loop = false
            } catch {
              // Best-effort.
            }
            pool.push(audio)
          }
        }
      } catch {
        // Pool construction is best-effort.
      }
      this.pools.set(key, pool)
    }
    if (pool.length === 0) return null
    const audio = pool[this.poolCursor % pool.length] ?? null
    this.poolCursor += 1
    return audio
  }

  private safeNow(): number {
    try {
      return this.now()
    } catch {
      return 0
    }
  }
}

function readInitialEnabled(load: () => boolean | null): boolean {
  try {
    return load() ?? true
  } catch {
    return true
  }
}

function createAudioSafe(
  createAudio: (src: string) => ManagedAudio | null,
  src: string,
): ManagedAudio | null {
  try {
    return createAudio(src)
  } catch {
    return null
  }
}

let shared: NimhuntAudioManager | null = null

/** Lazily created shared client audio instance (safe to import in tests/SSR). */
export function getSharedAudio(): NimhuntAudioManager {
  if (!shared) shared = new NimhuntAudioManager()
  return shared
}

/** Test-only escape hatch to reset the shared instance. */
export function resetSharedAudioForTests(): void {
  try {
    shared?.dispose()
  } catch {
    // Best-effort.
  }
  shared = null
}
