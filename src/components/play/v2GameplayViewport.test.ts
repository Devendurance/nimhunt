import { afterEach, describe, expect, it, vi } from 'vitest'
import { fitV2Playfield, observeV2Playfield } from './v2GameplayViewport'

afterEach(() => vi.unstubAllGlobals())
describe('V2 flexible gameplay viewport', () => {
  it('keeps logical width/zoom bounded while adapting to the actual remaining height', () => {
    for (const screen of [320, 360, 390, 430]) {
      const fit = fitV2Playfield(screen, screen - 26, 180)
      expect(fit.displayWidth).toBeLessThanOrEqual(screen - 26)
      expect(fit.displayHeight).toBeLessThanOrEqual(180)
      expect(fit.width).toBe(screen < 352 ? 352 : 384)
      expect(fit.height).toBeGreaterThanOrEqual(96)
    }
    expect(fitV2Playfield(390, 364, 900).height).toBe(320)
    expect(fitV2Playfield(390, 364, 100).height).toBeLessThan(288)
  })
  it('coalesces visual viewport changes, mutates one shared camera viewport and cleans up', () => {
    const visual = Object.assign(new EventTarget(), { height: 844, offsetTop: 0 })
    const browser = Object.assign(new EventTarget(), { visualViewport: visual, innerHeight: 844, innerWidth: 390 })
    vi.stubGlobal('window', browser)
    const callbacks: FrameRequestCallback[] = []
    const request = vi.fn((fn: FrameRequestCallback) => { callbacks.push(fn); return callbacks.length })
    vi.stubGlobal('requestAnimationFrame', request)
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    const disconnect = vi.fn()
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect = disconnect })
    const properties = new Map<string, string>()
    const shell = { style: { setProperty: (key: string, value: string) => { properties.set(key, value) } } } as unknown as HTMLElement
    const room = { clientWidth: 364, clientHeight: 300 } as HTMLElement
    const host = { style: {} } as HTMLElement
    const viewport = { width: 384, height: 320 }, resize = vi.fn()
    const stop = observeV2Playfield(shell, room, host, viewport, resize)
    const original = viewport
    expect(properties.get('--v2-viewport-height')).toBe('844px')
    visual.height = 700
    Object.assign(room, { clientHeight: 170 })
    for (let i = 0; i < 10; i++) visual.dispatchEvent(new Event('resize'))
    expect(request).toHaveBeenCalledTimes(1)
    callbacks[0](0)
    expect(viewport).toBe(original)
    expect(viewport.height).toBe(179)
    expect(properties.get('--v2-viewport-height')).toBe('700px')
    expect(resize).toHaveBeenCalledTimes(2)
    stop(); expect(disconnect).toHaveBeenCalledOnce()
    visual.dispatchEvent(new Event('resize'))
    expect(request).toHaveBeenCalledTimes(1)
  })
})
