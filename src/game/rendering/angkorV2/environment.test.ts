import type Phaser from 'phaser'
import { describe, expect, it, vi } from 'vitest'
import { ANGKOR_V2_PRODUCTION_MANIFEST } from '../../assets/angkorV2Manifest'
import { AngkorV2Environment, preloadAngkorV2Environment } from './environment'
import { environmentDepth } from './geometry'

vi.mock('./surfaces', () => ({ FLOOR_MATERIALS: { weathered: 'floor-weathered-height-v2' }, CAP_MATERIALS: { sandstone: 'wall-cap-sandstone-height-v2' }, createFloorSurface: () => ({ width: 32, height: 32 }), createWallSurface: () => ({ width: 36, height: 63 }) }))
const setup = () => {
  const objects: ReturnType<typeof object>[] = [], textures = new Set<string>()
  const object = (x: number, y: number) => ({ x, y, depth: 0, alpha: 1, flipX: false,
    setOrigin: vi.fn().mockReturnThis(), setDisplaySize: vi.fn().mockReturnThis(), setFlipX: vi.fn().mockReturnThis(), destroy: vi.fn(),
    setDepth: vi.fn(function(this: { depth: number }, n: number) { this.depth = n; return this }),
    setAlpha: vi.fn(function(this: { alpha: number }, n: number) { this.alpha = n; return this }),
  })
  const source = { width: 32, height: 32 }
  const scene = {
    textures: { exists: vi.fn((key: string) => textures.has(key) || key.startsWith('angkor-v2/')), get: () => ({ getSourceImage: () => source }),
      addCanvas: vi.fn((key: string) => textures.add(key)), remove: vi.fn((key: string) => textures.delete(key)) },
    load: { image: vi.fn() }, events: { once: vi.fn(), off: vi.fn() },
    add: { image: vi.fn((x: number, y: number) => { const image = object(x, y); objects.push(image); return image }) },
  }
  return { scene: scene as unknown as Phaser.Scene, objects, textures }
}
describe('opt-in Phaser environment lifecycle', () => {
  it('preloads the small production kit with deduplicated requested dependencies', () => {
    const { scene } = setup()
    vi.mocked(scene.textures.exists).mockReturnValue(false)
    preloadAngkorV2Environment(scene, ['fern-a-v2', 'fern-a-v2'])
    expect(scene.load.image).toHaveBeenCalledTimes(ANGKOR_V2_PRODUCTION_MANIFEST.length + 1)
    expect(scene.load.image).toHaveBeenCalledWith('angkor-v2/fern-a-v2', '/assets/game/angkor-v2/nature/foliage/fern-a-v2.png')
  })
  it('updates only moving actor depth and destroys owned objects/textures once', () => {
    const { scene, objects, textures } = setup()
    const environment = new AngkorV2Environment(scene, { cells: [[{ kind: 'floor' }]] })
    const actor = { x: 16, y: 24, setDepth: vi.fn() }, detach = environment.trackActor(actor)
    environment.update(16); environment.update(16)
    expect(actor.setDepth).toHaveBeenCalledTimes(1)
    actor.y = 25; environment.update(16)
    expect(actor.setDepth).toHaveBeenLastCalledWith(environmentDepth('actor', 25))
    detach(); actor.y = 26; environment.update(16)
    expect(actor.setDepth).toHaveBeenCalledTimes(2)
    environment.destroy(); environment.destroy(); environment.update(16)
    expect(objects.every(o => o.destroy.mock.calls.length === 1)).toBe(true)
    expect(textures.size).toBe(0)
    expect(scene.events.off).toHaveBeenCalledTimes(1)
    expect(() => environment.trackActor(actor)).toThrow('destroyed')
    expect(() => environment.addSprite({ key: 'explorer-gameplay-down-v2', x: 0, y: 0 })).toThrow('destroyed')
  })
  it('rejects missing materials before allocating any scene objects', () => {
    const { scene } = setup()
    vi.mocked(scene.textures.exists).mockReturnValue(false)
    expect(() => new AngkorV2Environment(scene, { cells: [[{ kind: 'floor' }]] })).toThrow('not preloaded')
    expect(scene.add.image).not.toHaveBeenCalled()
    expect(scene.textures.addCanvas).not.toHaveBeenCalled()
  })
})
