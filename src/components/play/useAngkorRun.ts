import { useCallback, useEffect, useRef, useState } from 'react'
import { createNimHuntGame, type NimHuntGameInstance } from '../../game/createNimHuntGame'
import { createInitialHUDState } from '../../game/events/gameEvents'
import type { MissionType } from '../../game/domain/mission'
import type { Direction } from '../../game/world/grid'

/**
 * Shared Phaser lifecycle for the single Angkor Room 01 engine.
 * Guarantees exactly one game instance per mount with StrictMode-safe
 * setup/teardown: the container is emptied before attach and the game
 * is fully destroyed (canvas removed) on unmount or mission change.
 */
export function useAngkorRun(mission: MissionType) {
  const containerRef = useRef<HTMLDivElement>(null)
  const instanceRef = useRef<NimHuntGameInstance | null>(null)
  const [hud, setHud] = useState(() => createInitialHUDState(mission))

  useEffect(() => {
    if (!containerRef.current) return
    setHud(createInitialHUDState(mission))
    const game = createNimHuntGame(containerRef.current, { mission })
    instanceRef.current = game
    const unsubscribe = game.subscribe(setHud)
    return () => {
      unsubscribe()
      game.destroy()
      instanceRef.current = null
    }
  }, [mission])

  const move = useCallback((direction: Direction) => {
    instanceRef.current?.move(direction)
  }, [])

  const reset = useCallback(() => {
    instanceRef.current?.reset()
  }, [])

  return { containerRef, hud, move, reset }
}
