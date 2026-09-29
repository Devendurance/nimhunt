import { useEffect, useState } from 'react'
import {
  createHudHapticsTracker,
  getSharedHaptics,
  type HudHapticsSnapshot,
} from './nimhuntHaptics'

export function useHapticsEnabled(): { readonly supported: boolean; readonly enabled: boolean; readonly toggle: () => void } {
  const [state, setState] = useState(() => {
    const haptics = getSharedHaptics()
    return { supported: haptics.isSupported(), enabled: haptics.isEnabled() }
  })

  useEffect(() => {
    const haptics = getSharedHaptics()
    return haptics.subscribe(enabled => setState({ supported: haptics.isSupported(), enabled }))
  }, [])

  return {
    ...state,
    toggle: () => {
      try {
        const haptics = getSharedHaptics()
        haptics.setEnabled(!haptics.isEnabled())
      } catch {
        // Haptics must never throw into UI or gameplay.
      }
    },
  }
}

export function useGameplayHaptics(hud: HudHapticsSnapshot, runKey: string): void {
  const [tracker] = useState(() => createHudHapticsTracker(pattern => {
    try {
      getSharedHaptics().vibrate(pattern)
    } catch {
      // Unsupported or broken vibration must never reach gameplay.
    }
  }))

  useEffect(() => {
    try {
      tracker.push(hud, runKey)
    } catch {
      // Haptic transition detection is presentation-only.
    }
  }, [hud, runKey, tracker])
}
