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

/** Loop behavior belongs to the track type, not the manager.
 * main loops forever; world tracks are one-shot entrance themes. */
export const BGM_TRACK_CONFIG: Record<BgmTrackKey, { readonly loop: boolean }> = {
  main: { loop: true },
  angkor: { loop: false },
  bavaria: { loop: false },
  siberia: { loop: false },
}

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
  /**
   * Present on real elements; lets the manager tell "already playing"
   * (no-op) from "paused" (resume). Fakes may omit these fields.
   */
  readonly paused?: boolean
  currentTime?: number
  /**
   * True once a non-looping track played to its natural end. Lets the
   * manager tell "finished one-shot" (never replay) from "paused"
   * (resume). Fakes may omit it (treated as not ended).
   */
  readonly ended?: boolean
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
    // NOTE: play() must NEVER reset currentTime here. This factory backs
    // both BGM (resume from currentTime) and SFX (SFX seeks explicitly in
    // playSfx). Resetting here restarted the BGM on every user gesture.
    return {
      play: () => el.play(),
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
      get paused(): boolean | undefined {
        try {
          return el.paused
        } catch {
          return undefined
        }
      },
      get ended(): boolean | undefined {
        try {
          return el.ended
        } catch {
          return undefined
        }
      },
      get currentTime(): number | undefined {
        try {
          return el.currentTime
        } catch {
          return undefined
        }
      },
      set currentTime(value: number | undefined) {
        try {
          if (typeof value === 'number') el.currentTime = value
        } catch {
          // Seek is best-effort.
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
  /** One-shot gesture latch: once true, later gestures are no-ops for BGM. */
  private unlocked = false
  /** Monotonic attempt id so stale async play() settlements can't clobber fresh state. */
  private bgmAttempt = 0
  private hiddenPaused = false
  private mutedPaused = false
  private readonly pools = new Map<SfxKey, ManagedAudio[]>()
  private poolCursor = 0
  private readonly lastSfxAt = new Map<SfxKey, number>()
  private readonly listeners = new Set<(enabled: boolean) => void>()
  private domSubscribed = false
  private gestureSubscribed = false
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
      this.mutedPaused = true
      this.safePauseBgm()
    } else {
      this.mutedPaused = false
      if (this.desiredTrack) this.playBgm(this.desiredTrack)
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

  /** One-shot latch state: true once audio is unlocked (gesture or autoplay). */
  isUnlocked(): boolean {
    return this.unlocked
  }

  /**
   * Request a BGM track. Idempotent: a same-track request while already
   * playing returns immediately without touching src, currentTime, or
   * playback. A same-track request while paused (hidden/muted/blocked)
   * resumes from the preserved currentTime — UNLESS the track is a finished
   * one-shot (naturally ended), which must never replay within the same
   * room entry. Only a DIFFERENT track swaps the element and starts over.
   */
  playBgm(track: BgmTrackKey): void {
    this.desiredTrack = track
    if (!this.enabled) return
    if (this.bgmTrack === track && this.bgmAudio) {
      // Finished one-shot: stay silent. No play(), no seek, no new element.
      // (Checked first: an ended track also looks "paused".)
      if (this.isBgmEnded(this.bgmAudio)) return
      // Paused for a reason owned elsewhere: visibility resumes it, unmute
      // resumes it. Never steal that resume here (it would restart/mis-time).
      if (this.hiddenPaused || this.mutedPaused) return
      // Already playing: no-op. No src/currentTime/load()/play() writes.
      if (!this.bgmBlocked && this.isBgmPlaying(this.bgmAudio)) return
      this.attemptBgmPlay()
      return
    }
    this.safePauseBgm()
    this.bgmTrack = track
    this.bgmAudio = null
    const audio = createAudioSafe(this.createAudio, WORLD_TRACK_URLS[track])
    if (!audio) return
    try {
      audio.loop = BGM_TRACK_CONFIG[track].loop
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
    // One-shots always restart from the beginning. Scoped to SFX only:
    // BGM resume must preserve currentTime.
    try {
      audio.currentTime = 0
    } catch {
      // Seek is best-effort.
    }
    this.swallowSfxPlay(audio)
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

  /**
   * One-shot gesture unlock. Idempotent: after the latch is set, every
   * later pointerdown/touchstart/keydown is a no-op for BGM, so scrolling
   * or tapping never restarts the current song. The latch is set
   * synchronously on the first valid gesture so the touchstart+pointerdown
   * double-fire of a single physical touch cannot double-start the track;
   * an async autoplay rejection afterwards clears the latch and re-arms
   * the listeners for a future gesture.
   */
  unlock(): void {
    if (this.unlocked) return
    if (!this.enabled || !this.desiredTrack) return
    if (this.hiddenPaused || this.mutedPaused) return
    if (
      this.bgmTrack === this.desiredTrack &&
      this.bgmAudio &&
      !this.bgmBlocked &&
      this.isBgmPlaying(this.bgmAudio)
    ) {
      // Already playing: latch only, never touch playback.
      this.markUnlocked()
      return
    }
    this.unlocked = true
    this.detachGestureListeners()
    this.bgmBlocked = false
    this.playBgm(this.desiredTrack)
    if (!this.bgmAudio) {
      // Nothing playable (factory unavailable): stay armed for a later retry.
      this.rearmGestureListeners()
    }
  }

  dispose(): void {
    this.detachGestureListeners()
    if (typeof document !== 'undefined' && this.domSubscribed) {
      try {
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
      this.attachGestureListeners()
      document.addEventListener('visibilitychange', this.onVisibility)
      this.domSubscribed = true
    } catch {
      // Audio unlock/visibility handling is best-effort.
    }
  }

  private attachGestureListeners(): void {
    if (this.gestureSubscribed) return
    try {
      if (typeof window === 'undefined') return
      window.addEventListener('pointerdown', this.onGesture, true)
      window.addEventListener('touchstart', this.onGesture, true)
      window.addEventListener('keydown', this.onGesture, true)
      this.gestureSubscribed = true
    } catch {
      // Audio unlock handling is best-effort.
    }
  }

  private detachGestureListeners(): void {
    if (!this.gestureSubscribed) return
    this.gestureSubscribed = false
    try {
      if (typeof window === 'undefined') return
      window.removeEventListener('pointerdown', this.onGesture, true)
      window.removeEventListener('touchstart', this.onGesture, true)
      window.removeEventListener('keydown', this.onGesture, true)
    } catch {
      // Teardown is best-effort.
    }
  }

  private markUnlocked(): void {
    this.unlocked = true
    this.detachGestureListeners()
  }

  private rearmGestureListeners(): void {
    this.unlocked = false
    this.attachGestureListeners()
  }

  private handleVisibility(): void {
    try {
      if (typeof document === 'undefined') return
      if (document.hidden) {
        // Pause only; currentTime is preserved for resume.
        this.hiddenPaused = true
        this.safePauseBgm()
        return
      }
      if (this.hiddenPaused) {
        this.hiddenPaused = false
        // visibilitychange is not a user gesture: resume only the already-
        // unlocked track from its preserved currentTime. Never reset it.
        if (this.enabled && !this.mutedPaused && this.unlocked && this.desiredTrack) {
          this.playBgm(this.desiredTrack)
        }
      }
    } catch {
      // Visibility handling must never throw into gameplay.
    }
  }

  private attemptBgmPlay(): void {
    const audio = this.bgmAudio
    if (!audio) return
    const epoch = (this.bgmAttempt += 1)
    let outcome: Promise<void> | void
    try {
      outcome = audio.play()
    } catch {
      this.onBgmAttemptFailed(epoch)
      return
    }
    if (outcome && typeof (outcome as Promise<void>).then === 'function') {
      ;(outcome as Promise<void>).then(
        () => this.onBgmAttemptSucceeded(epoch),
        () => this.onBgmAttemptFailed(epoch),
      )
      return
    }
    this.onBgmAttemptSucceeded(epoch)
  }

  private onBgmAttemptSucceeded(epoch: number): void {
    // Stale settlements (superseded by a newer attempt) must not move state.
    if (epoch !== this.bgmAttempt) return
    this.bgmBlocked = false
    // Autoplay was permitted: latch so later gestures stay no-ops.
    this.markUnlocked()
  }

  private onBgmAttemptFailed(epoch: number): void {
    if (epoch !== this.bgmAttempt) return
    this.bgmBlocked = true
    // Still blocked: keep the one-shot listeners armed for a future gesture.
    this.rearmGestureListeners()
  }

  private isBgmPlaying(audio: ManagedAudio): boolean {
    try {
      if (typeof audio.paused === 'boolean') return !audio.paused
    } catch {
      // Unknown state falls through to "attempt playback".
    }
    return false
  }

  /**
   * True only when the element reports a natural end. Missing/throwing
   * `ended` (older fakes) means "not ended" so behavior is unchanged.
   */
  private isBgmEnded(audio: ManagedAudio): boolean {
    try {
      return audio.ended === true
    } catch {
      return false
    }
  }

  /**
   * Attempts SFX playback, swallowing every rejection / sync throw so
   * audio failures never surface as console noise or unhandled rejections.
   * Deliberately decoupled from BGM unlock/blocked state: an SFX failure
   * must never move BGM bookkeeping.
   */
  private swallowSfxPlay(audio: ManagedAudio): void {
    try {
      const result = audio.play()
      if (result && typeof (result as Promise<void>).catch === 'function') {
        ;(result as Promise<void>).catch(() => {
          // SFX failures stay silent and never touch BGM state.
        })
      }
    } catch {
      // SFX failures must never throw into gameplay.
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
