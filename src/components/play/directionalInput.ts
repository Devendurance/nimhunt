import type { Direction } from '../../game/world/grid'

export const D_PAD_SIZE = 60
export const D_PAD_GAP = 8
export const D_PAD_NARROW_SIZE = 56
export const D_PAD_NARROW_GAP = 7

type PointerDownEvent = {
  readonly button: number
  preventDefault: () => void
}

type ClickEvent = {
  readonly detail: number
}

/**
 * Pointerdown is the touch/mouse activation path. Native keyboard activation
 * produces a click with detail 0, while a pointer-generated click has detail 1.
 * Keeping those paths separate makes one intentional touch one grid action.
 */
export function handleDirectionalPointerDown(
  event: PointerDownEvent,
  direction: Direction,
  onMove: (direction: Direction) => void,
  inputLocked: boolean,
): boolean {
  if (event.button !== 0 || inputLocked) return false
  event.preventDefault()
  onMove(direction)
  return true
}

export function handleDirectionalClick(
  event: ClickEvent,
  direction: Direction,
  onMove: (direction: Direction) => void,
  inputLocked: boolean,
): boolean {
  if (inputLocked || event.detail !== 0) return false
  onMove(direction)
  return true
}
