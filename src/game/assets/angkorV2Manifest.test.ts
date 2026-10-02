/// <reference types="node" />
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { inflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { ANGKOR_V2_MANIFEST, ANGKOR_V2_BY_KEY, ANGKOR_V2_EXPLORER_WALK, ANGKOR_V2_EXPLORER_GAMEPLAY, ANGKOR_V2_PRODUCTION_MANIFEST, ANGKOR_V2_TILE_SIZE } from './angkorV2Manifest'

const root = resolve(import.meta.dirname, '../../..')
const assetRoot = resolve(root, 'public/assets/game/angkor-v2')
const png = (path: string) => {
  const data = readFileSync(path)
  expect(data.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  return { data, width: data.readUInt32BE(16), height: data.readUInt32BE(20), color: data[25] }
}

// Decode our non-interlaced 8-bit RGBA delivery PNGs to check actual alpha,
// rather than accepting an alpha-capable file that still contains a background.
const rgba = (path: string) => {
  const { data, width, height, color } = png(path)
  expect([data[24], color, data[28]]).toEqual([8, 6, 0])
  const parts: Buffer[] = []
  for (let offset = 8; offset < data.length;) {
    const size = data.readUInt32BE(offset)
    if (data.toString('ascii', offset + 4, offset + 8) === 'IDAT') parts.push(data.subarray(offset + 8, offset + 8 + size))
    offset += size + 12
  }
  const raw = inflateSync(Buffer.concat(parts)), stride = width * 4
  const pixels = Buffer.alloc(stride * height)
  const paeth = (a: number, b: number, c: number) => {
    const p = a + b - c, da = Math.abs(p - a), db = Math.abs(p - b), dc = Math.abs(p - c)
    return da <= db && da <= dc ? a : db <= dc ? b : c
  }
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    expect(filter).toBeLessThanOrEqual(4)
    for (let x = 0; x < stride; x++) {
      const index = y * stride + x
      const a = x >= 4 ? pixels[index - 4] : 0, b = y ? pixels[index - stride] : 0
      const c = y && x >= 4 ? pixels[index - stride - 4] : 0
      const predictor = [0, a, b, Math.floor((a + b) / 2), paeth(a, b, c)][filter]
      pixels[index] = (raw[y * (stride + 1) + x + 1] + predictor) & 255
    }
  }
  return { pixels, width, height }
}

describe('Angkor V2 standalone delivery', () => {
  it('covers every shipped PNG exactly once with matching dimensions', () => {
    // The isolated projection experiment does not extend the provisional kit.
    const files = readdirSync(assetRoot, { recursive: true, encoding: 'utf8' }).map(x => x.replaceAll('\\', '/')).filter(x => x.endsWith('.png') && !x.startsWith('projection-test/')).sort()
    const paths = ANGKOR_V2_MANIFEST.map(x => x.path.replace('/assets/game/angkor-v2/', '')).sort()
    expect(paths).toEqual(files)
    expect(files).toHaveLength(81)
    expect(new Set(ANGKOR_V2_MANIFEST.map(x => x.key)).size).toBe(files.length)
    for (const asset of ANGKOR_V2_MANIFEST) {
      const meta = png(resolve(root, 'public', asset.path.slice(1)))
      expect({ width: meta.width, height: meta.height }, asset.key).toEqual(asset.sourceDimensions)
      expect(ANGKOR_V2_BY_KEY[asset.key as keyof typeof ANGKOR_V2_BY_KEY]).toBe(asset)
    }
  })

  it('retains the 32px grid and valid authoring anchors and footprints', () => {
    expect(ANGKOR_V2_TILE_SIZE).toBe(32)
    for (const asset of ANGKOR_V2_MANIFEST) {
      expect(asset.displayDimensions.width).toBeGreaterThan(0)
      expect(asset.displayDimensions.height).toBeGreaterThan(0)
      for (const coordinate of Object.values(asset.anchor)) { expect(coordinate).toBeGreaterThanOrEqual(0); expect(coordinate).toBeLessThanOrEqual(1) }
      for (const dimension of Object.values(asset.logicalFootprint)) expect(Number.isInteger(dimension) && dimension >= 0).toBe(true)
      if (asset.depthClass === 'floor') expect(asset.displayDimensions).toEqual({ width: 32, height: 32 })
    }
  })

  it('has real transparent surroundings on every modular asset and opaque floors', () => {
    for (const asset of ANGKOR_V2_MANIFEST) {
      const path = resolve(root, 'public', asset.path.slice(1))
      if (asset.renderMode === 'surface') { expect(png(path).color, asset.key).toBe(2); continue }
      const { pixels, width, height } = rgba(path)
      let clear = 0, visible = 0
      for (let i = 3; i < pixels.length; i += 4) { if (pixels[i] === 0) clear++; if (pixels[i] > 32) visible++ }
      expect(clear / (width * height), asset.key).toBeGreaterThan(0.05)
      expect(visible, asset.key).toBeGreaterThan(100)
      // A pasted rectangular background fails this even when the PNG has alpha.
      const corners = [0, width - 1, (height - 1) * width, height * width - 1]
      expect(corners.filter(i => pixels[i * 4 + 3] === 0).length, asset.key).toBeGreaterThanOrEqual(asset.status === 'production' ? 4 : 3)
    }
  })

  it('contains sixteen nonempty isolated frames on the same ground line', () => {
    const sheet = ANGKOR_V2_EXPLORER_WALK
    expect(sheet.directions).toEqual(['DOWN', 'LEFT', 'RIGHT', 'UP'])
    const { pixels, width, height } = rgba(resolve(assetRoot, 'player/explorer/explorer-walk-v2.png'))
    expect([width, height]).toEqual([sheet.columns * sheet.frameWidth, sheet.rows * sheet.frameHeight])
    for (let row = 0; row < 4; row++) for (let col = 0; col < 4; col++) {
      let bottom = -1, top: number = sheet.frameHeight, left: number = sheet.frameWidth, right = -1
      for (let y = 0; y < sheet.frameHeight; y++) for (let x = 0; x < sheet.frameWidth; x++) {
        if (pixels[((row * sheet.frameHeight + y) * width + col * sheet.frameWidth + x) * 4 + 3] > 32) {
          bottom = Math.max(bottom, y); top = Math.min(top, y); left = Math.min(left, x); right = Math.max(right, x)
        }
      }
      expect(bottom).toBeGreaterThanOrEqual(sheet.footAnchor.y - 2)
      expect(bottom).toBeLessThan(sheet.footAnchor.y)
      expect(top).toBeGreaterThanOrEqual(4)
      expect(top).toBeLessThanOrEqual(8)
      expect(left).toBeGreaterThan(0); expect(right).toBeLessThan(sheet.frameWidth - 1)
    }
  })

  it('promotes the approved overhead pose with a measured gameplay silhouette and foot anchor', () => {
    expect(ANGKOR_V2_PRODUCTION_MANIFEST).toHaveLength(19)
    expect(ANGKOR_V2_PRODUCTION_MANIFEST.every(asset => asset.status === 'production')).toBe(true)
    const asset = ANGKOR_V2_BY_KEY[ANGKOR_V2_EXPLORER_GAMEPLAY.key]
    const path = resolve(root, 'public', asset.path.slice(1))
    expect(readFileSync(path)).toEqual(readFileSync(resolve(assetRoot, 'projection-test/explorer-camera-test.png')))
    const { pixels, width, height } = rgba(path)
    let top = height, bottom = -1
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (pixels[(y * width + x) * 4 + 3] > 32) {
      top = Math.min(top, y); bottom = Math.max(bottom, y)
    }
    expect(bottom + 1).toBe(asset.anchor.y * height)
    expect(bottom - top + 1).toBe(ANGKOR_V2_EXPLORER_GAMEPLAY.visibleSourceHeight)
    expect(ANGKOR_V2_EXPLORER_GAMEPLAY.visibleDisplayHeight).toBeGreaterThanOrEqual(24)
    expect(ANGKOR_V2_EXPLORER_GAMEPLAY.visibleDisplayHeight).toBeLessThanOrEqual(28)
  })

  it('keeps the manifest and showcase outside the production import graph', () => {
    const visited = new Set<string>()
    const visit = (file: string) => {
      if (visited.has(file)) return
      visited.add(file)
      const source = readFileSync(file, 'utf8')
      for (const match of source.matchAll(/(?:from\s*|import\s*\(\s*|import\s*)['"](\.[^'"]+)['"]/g)) {
        const base = resolve(dirname(file), match[1])
        const next = [base, base + '.ts', base + '.tsx', resolve(base, 'index.ts'), resolve(base, 'index.tsx')].find(x => /\.tsx?$/.test(x) && existsSync(x))
        if (next) visit(next)
      }
    }
    visit(resolve(root, 'src/main.tsx'))
    expect(visited.has(resolve(root, 'src/game/assets/angkorV2Manifest.ts'))).toBe(false)
    expect(visited.has(resolve(root, 'src/dev/angkorV2Showcase.ts'))).toBe(false)
    expect(visited.has(resolve(root, 'src/dev/angkorV2Projection.ts'))).toBe(false)
    expect(visited.has(resolve(root, 'src/dev/angkorV2ProjectionModel.ts'))).toBe(false)
    expect(visited.has(resolve(root, 'src/dev/angkorV2EnvironmentQA.ts'))).toBe(false)
    expect(visited.has(resolve(root, 'src/game/rendering/angkorV2/environment.ts'))).toBe(false)
    expect(readFileSync(resolve(root, 'src/dev/angkorV2Showcase.ts'), 'utf8')).toContain('if (import.meta.env.DEV)')
  })
})
