import type Phaser from 'phaser'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ANGKOR_V2_BY_KEY, type AngkorV2AssetKey } from '../../assets/angkorV2Manifest'
import { InteractableEmphasis } from './interactableEmphasis'

function setup(key: AngkorV2AssetKey) {
  const graphics: Record<string, ReturnType<typeof vi.fn>> = {}
  for (const method of ['clear', 'setVisible', 'setAlpha', 'setDepth', 'fillStyle', 'lineStyle', 'fillEllipse', 'fillRect', 'strokeRect', 'lineBetween', 'destroy']) {
    graphics[method] = vi.fn(() => graphics)
  }
  const ctx = {
    drawImage: vi.fn(), getImageData: () => ({ data: new Uint8ClampedArray([140, 140, 140, 255]) }),
    putImageData: vi.fn(),
  }
  vi.stubGlobal('document', { createElement: () => ({ width: 1, height: 1, getContext: () => ctx }) })
  const scene = {
    textures: { get: () => ({ getSourceImage: () => ({ width: 1, height: 1 }) }), addCanvas: vi.fn(), remove: vi.fn() },
    add: { graphics: () => graphics }, cameras: { main: { worldView: { x: 0, y: 0, right: 300, bottom: 300 } } },
  }
  const asset = ANGKOR_V2_BY_KEY[key]
  const image = {
    scene, texture: { key: 'angkor-v2/' + key }, x: 50, y: 80, depth: 1234, visible: true, alpha: 1, isTinted: false,
    displayWidth: asset.displayDimensions.width, displayHeight: asset.displayDimensions.height, originX: asset.anchor.x, originY: asset.anchor.y,
    setTexture(key: string) { this.texture.key = key; return this }, setY(y: number) { this.y = y; return this },
  }
  const emphasis = new InteractableEmphasis(scene as unknown as Phaser.Scene)
  emphasis.track(image as unknown as Phaser.GameObjects.Image, key)
  return { scene, image, graphics, ctx, emphasis }
}
afterEach(() => vi.unstubAllGlobals())

describe('cross-mission item emphasis lifecycle', () => {
  it('starts key discovery on viewport entry, rather than consuming it offscreen', () => {
    // Vault Breaker reuses this canonical bronze art, so receives the same discovery treatment.
    const { scene, emphasis, graphics } = setup('bronze-temple-key-v2')
    scene.cameras.main.worldView.x = 1000
    for (let i = 0; i < 20; i++) emphasis.update(50)
    expect(graphics.lineBetween).not.toHaveBeenCalled()
    scene.cameras.main.worldView.x = 0
    emphasis.update(50)
    for (let i = 0; i < 7; i++) emphasis.update(50)
    expect(graphics.lineStyle).toHaveBeenLastCalledWith(1, 0xffdd78, expect.closeTo(.945, 2))
    emphasis.destroy()
  })

  it('restores released plate grading and reuses both variants without changing its foot or depth', () => {
    const { scene, image, emphasis } = setup('pressure-plate-v2')
    image.y += 15 // Caller positions the plate on its floor cell before first update.
    emphasis.update(50)
    const inactive = image.texture.key
    image.isTinted = true; emphasis.update(50)
    const active = image.texture.key
    expect(active).not.toBe(inactive)
    image.isTinted = false; emphasis.update(50)
    expect(image.texture.key).toBe(inactive)
    image.isTinted = true; emphasis.update(50)
    expect(image.texture.key).toBe(active)
    expect(scene.textures.addCanvas).toHaveBeenCalledTimes(2)
    expect(image.y).toBe(95); expect(image.depth).toBe(1234)
    emphasis.destroy(); expect(scene.textures.remove).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['chest-closed-v2', 'chest-open-v2'], ['royal-cache-closed-v2', 'royal-cache-open-v2'],
    ['side-gate-locked-v2', 'side-gate-open-v2'], ['temple-passage-closed-height-v2', 'temple-passage-open-height-v2'],
  ] as const)('keeps %s state swaps aligned and at local faded depth', (closed, open) => {
    const { image, emphasis, graphics } = setup(closed)
    const registration = { x: image.x, y: image.y, w: image.displayWidth, h: image.displayHeight, ox: image.originX, oy: image.originY, depth: image.depth }
    emphasis.update(50)
    image.texture.key = 'angkor-v2/' + open; image.alpha = .45
    emphasis.update(50)
    expect(image.texture.key).toContain(open)
    expect({ x: image.x, y: image.y, w: image.displayWidth, h: image.displayHeight, ox: image.originX, oy: image.originY, depth: image.depth }).toEqual(registration)
    expect(graphics.setAlpha).toHaveBeenLastCalledWith(.45)
    expect(graphics.setDepth).toHaveBeenLastCalledWith(registration.depth + .02)
    image.visible = false; emphasis.update(50)
    expect(graphics.setVisible).toHaveBeenLastCalledWith(false)
    emphasis.destroy()
  })

  it('keeps static key contrast under reduced motion without a bob or glint', () => {
    vi.stubGlobal('window', { matchMedia: () => ({ matches: true }) })
    const { image, emphasis, graphics } = setup('bronze-temple-key-v2')
    for (let i = 0; i < 20; i++) emphasis.update(50)
    expect(image.texture.key).toContain('readability/'); expect(image.y).toBe(80)
    expect(graphics.lineBetween).not.toHaveBeenCalled()
    emphasis.destroy()
  })
})
