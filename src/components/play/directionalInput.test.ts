import { describe, expect, it, vi } from 'vitest'
import {
  D_PAD_GAP,
  D_PAD_NARROW_GAP,
  D_PAD_NARROW_SIZE,
  D_PAD_SIZE,
  handleDirectionalClick,
  handleDirectionalPointerDown,
} from './directionalInput.ts'
import { getDirectionForKey } from './gameplayInput.ts'

describe('P6 shared directional input contract', () => {
  it('uses the larger normal-phone and narrow-screen D-pad dimensions without overflowing 320px', () => {
    expect(D_PAD_SIZE).toBe(60)
    expect(D_PAD_GAP).toBe(8)
    expect(D_PAD_NARROW_SIZE).toBe(56)
    expect(D_PAD_NARROW_GAP).toBe(7)
    expect(3 * D_PAD_SIZE + 2 * D_PAD_GAP).toBe(196)
    expect(3 * D_PAD_NARROW_SIZE + 2 * D_PAD_NARROW_GAP).toBe(182)
    expect(3 * D_PAD_NARROW_SIZE + 2 * D_PAD_NARROW_GAP).toBeLessThanOrEqual(320 - 24)
  })

  it('fires one move for a pointer interaction and ignores its follow-up click', () => {
    const move = vi.fn()
    const preventDefault = vi.fn()
    expect(handleDirectionalPointerDown({ button: 0, preventDefault }, 'LEFT', move, false)).toBe(true)
    expect(handleDirectionalClick({ detail: 1 }, 'LEFT', move, false)).toBe(false)
    expect(preventDefault).toHaveBeenCalledTimes(1)
    expect(move).toHaveBeenCalledTimes(1)
    expect(move).toHaveBeenCalledWith('LEFT')
  })

  it('keeps synthetic keyboard clicks to one move and ignores locked input', () => {
    const move = vi.fn()
    const preventDefault = vi.fn()
    expect(handleDirectionalClick({ detail: 0 }, 'UP', move, false)).toBe(true)
    expect(move).toHaveBeenCalledTimes(1)
    expect(handleDirectionalPointerDown({ button: 0, preventDefault }, 'DOWN', move, true)).toBe(false)
    expect(handleDirectionalClick({ detail: 0 }, 'DOWN', move, true)).toBe(false)
    expect(move).toHaveBeenCalledTimes(1)
  })

  it('preserves Arrow/WASD direction mapping and shares the product/practice D-pad', () => {
    expect(getDirectionForKey('ArrowUp')).toBe('UP')
    expect(getDirectionForKey('W')).toBe('UP')
    expect(getDirectionForKey('a')).toBe('LEFT')
    expect(getDirectionForKey('ArrowRight')).toBe('RIGHT')
    expect(getDirectionForKey('S')).toBe('DOWN')
  })
})
