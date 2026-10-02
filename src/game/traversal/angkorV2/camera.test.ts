import { describe, expect, it } from 'vitest'
import { ANGKOR_V2_VIEWPORT, traversalViewport, cameraTarget, followCamera } from './camera'

const world = { width: 960, height: 768 }
describe('bounded V2 traversal camera', () => {
  it('chooses 11 columns on narrow phones and never expands beyond 12 on desktop', () => {
    expect(traversalViewport(320)).toEqual({ width: 352, height: 320 })
    expect(traversalViewport(390)).toEqual({ width: 384, height: 320 })
    expect(traversalViewport(1920)).toEqual({ width: 384, height: 320 })
    expect(traversalViewport(390, 568)).toEqual({ width: 384, height: 288 })
  })
  it('keeps a 12×10-tile view and places the foot at 57.5% when bounds permit', () => {
    expect(ANGKOR_V2_VIEWPORT).toEqual({ width: 12 * 32, height: 10 * 32 })
    const target = cameraTarget({ x: 480, y: 384 }, world)
    expect(target.x).toBe(288); expect((384 - target.y) / 320).toBeCloseTo(.575)
  })
  it('clamps every edge and never exposes the outside world', () => {
    expect(cameraTarget({ x: 0, y: 0 }, world)).toEqual({ x: 0, y: 0 })
    expect(cameraTarget({ x: 960, y: 768 }, world)).toEqual({ x: 576, y: 448 })
    for (const foot of [{ x: -20, y: -20 }, { x: 1200, y: 1200 }, { x: 400, y: 400 }]) {
      const next = followCamera({ x: -100, y: 900 }, foot, world, 16)
      expect(next.x).toBeGreaterThanOrEqual(0); expect(next.x + 384).toBeLessThanOrEqual(960)
      expect(next.y).toBeGreaterThanOrEqual(0); expect(next.y + 320).toBeLessThanOrEqual(768)
    }
  })
  it('smooths time-independently without overshoot or ordinary hard snapping', () => {
    const foot = { x: 500, y: 400 }, initial = { x: 100, y: 100 }
    const once = followCamera(initial, foot, world, 32)
    const twice = followCamera(followCamera(initial, foot, world, 16), foot, world, 16)
    expect(once.x).toBeCloseTo(twice.x); expect(once.y).toBeCloseTo(twice.y)
    expect(once.x).toBeGreaterThan(initial.x); expect(once.x).toBeLessThan(cameraTarget(foot, world).x)
    expect(followCamera(initial, foot, world, 16, true)).toEqual(cameraTarget(foot, world))
  })
  it('rejects invalid dimensions/state and worlds smaller than the view', () => {
    expect(() => cameraTarget({ x: 0, y: 0 }, { width: 100, height: 100 })).toThrow()
    expect(() => followCamera({ x: 0, y: 0 }, { x: 0, y: 0 }, world, -1)).toThrow()
  })
})
