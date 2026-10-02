import { getDirectionForKey, isGameplayTextTarget } from '../../../components/play/gameplayInput'
import type { TileTraversal } from './movement'

/** Shared Arrow/WASD mapping, with physical-key ownership instead of OS repeat. */
export function bindTraversalKeyboard(controller: TileTraversal, target: Window = window): () => void {
  const source = (event: KeyboardEvent) => 'keyboard:' + (event.code || event.key.toLowerCase())
  const down = (event: KeyboardEvent) => {
    const direction = getDirectionForKey(event.key)
    if (!direction || isGameplayTextTarget(event.target)) return
    event.preventDefault()
    if (!event.repeat) controller.press(source(event), direction)
  }
  const up = (event: KeyboardEvent) => controller.release(source(event))
  const clear = () => controller.clearInput()
  const visibility = () => { if (target.document.hidden) clear() }
  target.addEventListener('keydown', down); target.addEventListener('keyup', up); target.addEventListener('blur', clear)
  target.document.addEventListener('visibilitychange', visibility)
  return () => {
    clear(); target.removeEventListener('keydown', down); target.removeEventListener('keyup', up); target.removeEventListener('blur', clear)
    target.document.removeEventListener('visibilitychange', visibility)
  }
}
