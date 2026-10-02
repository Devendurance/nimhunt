import { describe, expect, it } from 'vitest'
import { compileWallModules, environmentDepth, readabilityOccluders, readabilityAlpha, shouldFadeOccluder, validateEnvironmentMap, type EnvironmentMap } from './geometry'

const map = (...rows: string[]): EnvironmentMap => ({ cells: rows.map(row => [...row].map(c => ({ kind: c === '#' ? 'wall' : c === 'T' ? 'tall' : c === 'L' ? 'low' : c === 'D' ? 'doorway' : c === 'B' ? 'broken' : c === 'C' ? 'collapsed' : 'floor' }))) })
describe('Angkor V2 visual geometry', () => {
  it('compiles arbitrary room boundaries without changing the caller geometry', () => {
    const source = map('#######', '#.....#', '###D#B#', '#.....#', '#######'), before = structuredClone(source)
    const modules = compileWallModules(source)
    expect(source).toEqual(before)
    expect(modules.find(w => w.x === 1 && w.y === 0)).toMatchObject({ role: 'horizontal', southDrop: 24 })
    expect(modules.find(w => w.x === 0 && w.y === 1)).toMatchObject({ role: 'vertical', east: true, southDrop: 0 })
    expect(modules.find(w => w.x === 3 && w.y === 2)?.kind).toBe('doorway')
    expect(modules.find(w => w.x === 5 && w.y === 2)?.kind).toBe('broken')
    expect(modules.some(w => w.innerCorners.length)).toBe(true)
    expect(modules.some(w => w.outerCorners.length)).toBe(true)
    const ends = compileWallModules(map('.##.'))
    expect(ends.map(w => w.role)).toEqual(['end-cap', 'end-cap'])
    expect(ends[0].west).toBe(true); expect(ends[1].east).toBe(true)
  })
  it('closes faces between different heights, low walls and collapsed masonry', () => {
    const modules = compileWallModules(map('T', 'L', 'C', '.'))
    expect(modules.map(w => w.height)).toEqual([40, 10, 5])
    expect(modules.map(w => w.southDrop)).toEqual([30, 5, 5])
    expect(modules[0].bounds).toEqual({ x: 0, y: -40, width: 32, height: 72 })
    expect(modules[0].baseY).toBe(32)
  })
  it('rejects malformed maps and unsupported material/cell data', () => {
    for (const source of [{ cells: [] }, map('##', '#'), { cells: [[{ kind: 'unknown' }]] }]) expect(() => validateEnvironmentMap(source as EnvironmentMap)).toThrow()
    expect(() => validateEnvironmentMap(map('.'.repeat(65)))).toThrow()
  })
  it('interleaves all world classes by Y, with stable local ties and floor planes', () => {
    expect(environmentDepth('floor', 999)).toBe(0)
    expect(environmentDepth('floor-overlay', 999)).toBe(1)
    expect(environmentDepth('ground-item', 100)).toBeLessThan(environmentDepth('actor', 100))
    expect(environmentDepth('actor', 100)).toBeLessThan(environmentDepth('wall', 100))
    expect(environmentDepth('wall', 100)).toBeLessThan(environmentDepth('actor', 101))
    expect(environmentDepth('foreground', 100)).toBeLessThan(environmentDepth('actor', 101))
    expect(environmentDepth('effect', 100)).toBeLessThan(environmentDepth('actor', 101))
    expect(() => environmentDepth('actor', Number.NaN)).toThrow()
  })
  it('fades only foreground coverage of the head, including a union across seams', () => {
    const actor = { x: 32, y: 90, width: 25, visibleHeight: 26 }
    const left = { bounds: { x: 20, y: 62, width: 12, height: 30 }, depth: environmentDepth('wall', 96) }
    const right = { bounds: { x: 32, y: 62, width: 12, height: 30 }, depth: environmentDepth('wall', 96) }
    expect(shouldFadeOccluder(left.bounds, left.depth, actor)).toBe(false)
    expect(readabilityOccluders(actor, [left])).toEqual([])
    expect(readabilityOccluders(actor, [left, right])).toEqual([0, 1])
    expect(readabilityOccluders(actor, [{ ...left, opaqueAt: () => false }, { ...right, opaqueAt: () => false }])).toEqual([])
    expect(readabilityOccluders(actor, [{ bounds: { x: 0, y: 0, width: 100, height: 100 }, depth: environmentDepth('wall', 80) }])).toEqual([])
    expect(readabilityOccluders(actor, [{ bounds: { x: 20, y: 78, width: 24, height: 30 }, depth: left.depth }])).toEqual([])
  })
  it('keeps stacked cutaways from hiding the actor again', () => {
    for (const count of [1, 2, 3, 5]) expect(1 - (1 - readabilityAlpha(count)) ** count).toBeCloseTo(.38)
    expect(readabilityAlpha(0)).toBe(1)
  })
})
