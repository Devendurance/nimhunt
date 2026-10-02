import { describe, expect, it } from 'vitest'
import { bindTraversalKeyboard } from './input'
import { TileTraversal, type TraversalMove } from './movement'
import type { GridRoom } from '../../world/grid'

const room: GridRoom = { id: 'keys', name: 'keys', width: 5, height: 5, playerStart: { x: 2, y: 2 }, layout: ['#####', '#...#', '#.S.#', '#...#', '#####'] }
const keyEvent = (type: string, key: string, code: string, repeat = false) => Object.assign(new Event(type, { cancelable: true }), { key, code, repeat })
describe('V2 keyboard hold ownership', () => {
  it('shares Arrow/WASD mapping, ignores OS repeat and releases by physical key', () => {
    const target = Object.assign(new EventTarget(), { document: Object.assign(new EventTarget(), { hidden: false }) })
    const moves: TraversalMove[] = [], t = new TileTraversal(room, move => moves.push(move))
    const unbind = bindTraversalKeyboard(t, target as unknown as Window)
    const down = keyEvent('keydown', 'W', 'KeyW')
    target.dispatchEvent(down); t.update(0)
    expect(down.defaultPrevented).toBe(true)
    target.dispatchEvent(keyEvent('keydown', 'w', 'KeyW', true))
    target.dispatchEvent(keyEvent('keyup', 'w', 'KeyW')); t.update(145)
    expect(moves).toHaveLength(1); expect(t.moving).toBe(false)
    target.dispatchEvent(keyEvent('keydown', 'ArrowRight', 'ArrowRight')); t.update(0)
    expect(moves[1].direction).toBe('RIGHT')
    unbind(); t.update(145); target.dispatchEvent(keyEvent('keydown', 'a', 'KeyA')); t.update(145)
    expect(moves).toHaveLength(2)
  })
  it('clears held and buffered input on blur/hidden page without cancelling an accepted tile', () => {
    const target = Object.assign(new EventTarget(), { document: Object.assign(new EventTarget(), { hidden: false }) })
    const moves: TraversalMove[] = [], t = new TileTraversal(room, move => moves.push(move))
    const unbind = bindTraversalKeyboard(t, target as unknown as Window)
    target.dispatchEvent(keyEvent('keydown', 'ArrowRight', 'ArrowRight')); t.update(0)
    target.dispatchEvent(keyEvent('keydown', 'ArrowDown', 'ArrowDown')); target.dispatchEvent(new Event('blur'))
    expect(t.bufferedDirection).toBeUndefined(); t.update(145); expect(moves).toHaveLength(1)
    target.dispatchEvent(keyEvent('keydown', 'a', 'KeyA')); t.update(0)
    target.document.hidden = true; target.document.dispatchEvent(new Event('visibilitychange'))
    t.update(145); expect(moves).toHaveLength(2); expect(t.moving).toBe(false)
    unbind()
  })
})
