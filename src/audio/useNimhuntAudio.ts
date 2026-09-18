import { useEffect, useState } from 'react'
import {
  createHudSfxTracker,
  getSharedAudio,
  resolveMissionTrack,
  type BgmTrackKey,
  type HudSfxSnapshot,
} from './nimhuntAudio'

function scheduleIdle(callback: () => void): () => void {
  try {
    const w = window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number
      cancelIdleCallback?: (id: number) => void
    }
    if (typeof w.requestIdleCallback === 'function') {
      const id = w.requestIdleCallback(callback, { timeout: 2000 })
      return () => {
        try {
          w.cancelIdleCallback?.(id)
        } catch {
          // Best-effort.
        }
      }
    }
  } catch {
    // Fall through to setTimeout.
  }
  const id = setTimeout(callback, 1500)
  return () => clearTimeout(id)
}

/** Reactive sound-enabled flag backed by the shared audio manager. */
export function useSoundEnabled(): { readonly enabled: boolean; readonly toggle: () => void } {
  const [enabled, setEnabled] = useState(() => {
    try {
      return getSharedAudio().isEnabled()
    } catch {
      return true
    }
  })
  useEffect(() => getSharedAudio().subscribe(setEnabled), [])
  return {
    enabled,
    toggle: () => {
      try {
        const audio = getSharedAudio()
        audio.setEnabled(!audio.isEnabled())
      } catch {
        // Toggle must never throw into UI.
      }
    },
  }
}

/**
 * Requests a BGM track while mounted.
 * - `context: 'shell'` stops music on unmount (leaving /play quiets the app).
 * - `context: 'gameplay'` restores the main theme on unmount (exiting a run).
 * Same-track (re)mounts never restart the audio (manager dedupes).
 */
export function useNimhuntBgm(track: BgmTrackKey, context: 'shell' | 'gameplay'): void {
  useEffect(() => {
    let cancelIdle: (() => void) | null = null
    try {
      getSharedAudio().playBgm(track)
      cancelIdle = scheduleIdle(() => {
        try {
          getSharedAudio().warmup()
        } catch {
          // Warmup must never throw.
        }
      })
    } catch {
      // Audio must never break mounting.
    }
    return () => {
      try {
        cancelIdle?.()
        if (context === 'gameplay') getSharedAudio().playBgm('main')
        else getSharedAudio().stopBgm()
      } catch {
        // Teardown must never throw.
      }
    }
  }, [track, context])
}

/** Convenience: gameplay music follows the mission's world automatically. */
export function useMissionBgm(mission: string): void {
  useNimhuntBgm(resolveMissionTrack(mission), 'gameplay')
}

/**
 * Wires HUD state transitions to one-shot SFX. Presentation-only: it reads
 * the Phaser HUD snapshot and never touches replay actions, checkpoints,
 * hashes, or server state. Restored runs never replay historical SFX (the
 * tracker arms silently on first sight / runKey change).
 */
export function useGameplaySfx(hud: HudSfxSnapshot, runKey: string): void {
  const [tracker] = useState(() =>
    createHudSfxTracker(key => {
      try {
        getSharedAudio().playSfx(key)
      } catch {
        // Audio failures never throw into gameplay.
      }
    }),
  )
  useEffect(() => {
    try {
      tracker.push(hud, runKey)
    } catch {
      // SFX diffing must never throw into gameplay.
    }
  }, [hud, runKey, tracker])
}
