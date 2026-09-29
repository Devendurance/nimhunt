import type { Direction } from '../../game/world/grid'

const directionByKey: Readonly<Record<string, Direction>> = {
  ArrowUp: 'UP',
  w: 'UP',
  ArrowDown: 'DOWN',
  s: 'DOWN',
  ArrowLeft: 'LEFT',
  a: 'LEFT',
  ArrowRight: 'RIGHT',
  d: 'RIGHT',
}

export function getDirectionForKey(key: string): Direction | undefined {
  return directionByKey[key] ?? directionByKey[key.toLowerCase()]
}

export function isGameplayTextTarget(target: EventTarget | null): boolean {
  if (typeof HTMLElement === 'undefined' || !(target instanceof HTMLElement)) return false
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}
