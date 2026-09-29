/**
 * NimHunt presentation-only haptics.
 *
 * This layer is deliberately isolated from ReplayAction, checkpoints, hashes,
 * server state, rewards, and gameplay decisions. Unsupported browsers simply
 * hide the preference and ignore vibration requests.
 */

export type HapticPattern = number | number[]
type Vibrate = (pattern: HapticPattern) => unknown

export const HAPTICS_STORAGE_KEY = 'nimhunt:haptics-enabled'
export const HAPTICS_GUARD = 'PRESENTATION_ONLY: never ReplayAction, checkpoint, hash, server, reward, payout, or DB.'

const HAPTIC_MIN_INTERVAL_MS = 80

export interface HapticsDeps {
  readonly vibrate?: Vibrate | null
  readonly loadEnabled?: () => boolean | null
  readonly saveEnabled?: (enabled: boolean) => void
  readonly now?: () => number
  readonly prefersReducedMotion?: () => boolean
}

export interface HudHapticsSnapshot {
  readonly hp: number
  readonly gemsCollected: number
  readonly chestsOpened: number
  readonly hasTempleKey: boolean
  readonly hasSword: boolean
  readonly goblinState: string
  readonly gateState: string
  readonly runStatus: string
}

export function detectGameplayHaptic(prev: HudHapticsSnapshot, next: HudHapticsSnapshot): HapticPattern | null {
  if (prev.runStatus !== 'MISSION_COMPLETE' && next.runStatus === 'MISSION_COMPLETE') return [16, 28, 16]
  if (next.hp < prev.hp) return 22
  if (
    next.gemsCollected > prev.gemsCollected
    || next.chestsOpened > prev.chestsOpened
    || (!prev.hasTempleKey && next.hasTempleKey)
    || (!prev.hasSword && next.hasSword)
    || (prev.gateState === 'LOCKED' && next.gateState === 'OPEN')
    || (prev.goblinState !== 'DEFEATED' && next.goblinState === 'DEFEATED')
  ) return 10
  return null
}

export function createHudHapticsTracker(emit: (pattern: HapticPattern) => void): {
  push: (hud: HudHapticsSnapshot, runKey: string) => void
} {
  let armedKey: string | null = null
  let prev: HudHapticsSnapshot | null = null
  return {
    push(hud, runKey) {
      if (armedKey !== runKey) {
        armedKey = runKey
        prev = hud
        return
      }
      if (!prev) {
        prev = hud
        return
      }
      const pattern = detectGameplayHaptic(prev, hud)
      if (pattern !== null) emit(pattern)
      prev = hud
    },
  }
}

export class NimhuntHapticsManager {
  private readonly vibrateFn: Vibrate | null
  private readonly saveEnabled: (enabled: boolean) => void
  private readonly now: () => number
  private readonly prefersReducedMotion: () => boolean
  private enabled: boolean
  private lastVibrateAt = Number.NEGATIVE_INFINITY
  private readonly listeners = new Set<(enabled: boolean) => void>()

  constructor(deps: HapticsDeps = {}) {
    this.vibrateFn = deps.vibrate === undefined ? defaultVibrate() : deps.vibrate
    this.saveEnabled = deps.saveEnabled ?? defaultSaveEnabled
    this.now = deps.now ?? (() => Date.now())
    this.prefersReducedMotion = deps.prefersReducedMotion ?? defaultPrefersReducedMotion
    this.enabled = readInitialEnabled(deps.loadEnabled ?? defaultLoadEnabled)
  }

  isSupported(): boolean {
    return this.vibrateFn !== null
  }

  isEnabled(): boolean {
    return this.isSupported() && this.enabled
  }

  setEnabled(enabled: boolean): void {
    if (!this.isSupported() || this.enabled === enabled) return
    this.enabled = enabled
    try {
      this.saveEnabled(enabled)
    } catch {
      // Local preference persistence is best-effort.
    }
    for (const listener of this.listeners) {
      try {
        listener(this.isEnabled())
      } catch {
        // Listener failures must never reach gameplay.
      }
    }
  }

  subscribe(listener: (enabled: boolean) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  vibrate(pattern: HapticPattern): boolean {
    if (!this.isEnabled() || this.prefersReducedMotion()) return false
    const now = this.safeNow()
    if (now - this.lastVibrateAt < HAPTIC_MIN_INTERVAL_MS) return false
    try {
      this.vibrateFn?.(pattern)
      this.lastVibrateAt = now
      return true
    } catch {
      return false
    }
  }

  private safeNow(): number {
    try {
      return this.now()
    } catch {
      return 0
    }
  }
}

function defaultVibrate(): Vibrate | null {
  try {
    if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return null
    return pattern => navigator.vibrate(pattern)
  } catch {
    return null
  }
}

function defaultPrefersReducedMotion(): boolean {
  try {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false
  } catch {
    return false
  }
}

function defaultLoadEnabled(): boolean | null {
  try {
    if (typeof localStorage === 'undefined') return null
    const raw = localStorage.getItem(HAPTICS_STORAGE_KEY)
    if (raw === 'true') return true
    if (raw === 'false') return false
    return null
  } catch {
    return null
  }
}

function defaultSaveEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(HAPTICS_STORAGE_KEY, enabled ? 'true' : 'false')
  } catch {
    // Local preference persistence is best-effort.
  }
}

function readInitialEnabled(load: () => boolean | null): boolean {
  try {
    return load() ?? true
  } catch {
    return true
  }
}

let shared: NimhuntHapticsManager | null = null

export function getSharedHaptics(): NimhuntHapticsManager {
  if (!shared) shared = new NimhuntHapticsManager()
  return shared
}

export function resetSharedHapticsForTests(): void {
  shared = null
}
