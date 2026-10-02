import type { AngkorV2AssetKey } from '../../assets/angkorV2Manifest'
import { ANGKOR_V2_RENDER as R, validateEnvironmentMap, type EnvironmentMap, type FloorStyle, type WallModule } from './geometry'

export type SurfaceSource = (key: AngkorV2AssetKey) => CanvasImageSource
export const FLOOR_MATERIALS: Record<FloorStyle, AngkorV2AssetKey> = {
  clean: 'floor-clean-height-v2', weathered: 'floor-weathered-height-v2', cracked: 'floor-cracked-height-v2',
  mossy: 'floor-mossy-height-v2', 'root-damaged': 'floor-root-damaged-height-v2', debris: 'floor-debris-height-v2',
}
export const CAP_MATERIALS = { sandstone: 'wall-cap-sandstone-height-v2', mossy: 'wall-cap-moss-height-v2', damaged: 'wall-cap-damaged-height-v2' } as const
const canvas = (width: number, height: number) => {
  const c = document.createElement('canvas'); c.width = width; c.height = height
  return c
}
/** Mirrored repeat meets exactly at its edges, without assuming GPT pixels wrap. */
const materialCache = new WeakMap<object, Map<string, HTMLCanvasElement>>()
export function reflectedMaterial(image: CanvasImageSource, width: number, height: number): HTMLCanvasElement {
  const cache = materialCache.get(image) ?? new Map<string, HTMLCanvasElement>(), key = `${width}×${height}`
  if (cache.has(key)) return cache.get(key)!
  const c = canvas(width * 2, height * 2), ctx = c.getContext('2d')!
  for (const [flipX, flipY] of [[false, false], [true, false], [false, true], [true, true]]) {
    ctx.save(); ctx.translate(flipX ? width * 2 : 0, flipY ? height * 2 : 0)
    ctx.scale(flipX ? -1 : 1, flipY ? -1 : 1); ctx.drawImage(image, 0, 0, width, height); ctx.restore()
  }
  cache.set(key, c); materialCache.set(image, cache); return c
}
export function createFloorSurface(map: EnvironmentMap, source: SurfaceSource): HTMLCanvasElement {
  const { width, height } = validateEnvironmentMap(map), c = canvas(width * R.tile, height * R.tile), ctx = c.getContext('2d')!
  const patterns = Object.fromEntries(Object.entries(FLOOR_MATERIALS).map(([style, key]) => [style, ctx.createPattern(reflectedMaterial(source(key), R.floorRepeat, R.floorRepeat), 'repeat')!])) as Record<FloorStyle, CanvasPattern>
  ctx.fillStyle = patterns.weathered; ctx.fillRect(0, 0, c.width, c.height)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const style = map.cells[y][x].floor ?? 'weathered'
    if (style === 'weathered') continue
    const tile = canvas(R.tile, R.tile), t = tile.getContext('2d')!
    t.translate(-x * R.tile, -y * R.tile); t.fillStyle = patterns[style]
    t.fillRect(x * R.tile, y * R.tile, R.tile, R.tile); t.resetTransform()
    t.globalCompositeOperation = 'destination-in'
    for (const horizontal of [true, false]) {
      const g = t.createLinearGradient(0, 0, horizontal ? R.tile : 0, horizontal ? 0 : R.tile)
      g.addColorStop(0, '#0000'); g.addColorStop(R.floorBlendMargin / R.tile, '#000'); g.addColorStop(1 - R.floorBlendMargin / R.tile, '#000'); g.addColorStop(1, '#0000')
      t.fillStyle = g; t.fillRect(0, 0, R.tile, R.tile)
    }
    ctx.globalAlpha = .8; ctx.drawImage(tile, x * R.tile, y * R.tile); ctx.globalAlpha = 1
  }
  return c
}

/** A reusable tile module sampled in world coordinates, not an entire room PNG. */
export function createWallSurface(w: WallModule, source: SurfaceSource): HTMLCanvasElement {
  const c = canvas(R.tile + 4, R.tile + w.height + R.shadow), ctx = c.getContext('2d')!
  const x = w.x * R.tile, y = w.y * R.tile, topY = y - w.height
  ctx.translate(-x + 2, -topY)
  const top = ctx.createPattern(reflectedMaterial(source(CAP_MATERIALS.sandstone), R.capRepeat, R.capRepeat), 'repeat')!
  const variant = ctx.createPattern(reflectedMaterial(source(CAP_MATERIALS[w.material]), R.capRepeat, R.capRepeat), 'repeat')!
  const face = ctx.createPattern(reflectedMaterial(source('wall-face-sandstone-height-v2'), R.faceRepeatWidth, R.faceRepeatHeight), 'repeat')!
  const fill = (px: number, py: number, width: number, height: number, style: string | CanvasPattern | CanvasGradient) => { ctx.fillStyle = style; ctx.fillRect(px, py, width, height) }
  const shadow = (px: number, py: number, width: number, height: number, a: string, b: string) => {
    const g = ctx.createLinearGradient(px, py, px, py + height); g.addColorStop(0, a); g.addColorStop(1, b); fill(px, py, width, height, g)
  }
  const faceRect = (px: number, py: number, width: number, height: number) => {
    if (height <= 0) return
    fill(px, py, width, height, face); shadow(px, py, width, height, '#50402544', '#25251aca')
    fill(px, py, width, 2, '#d4ae6b'); fill(px, py + height - 2, width, 2, '#312e1c')
  }
  if (w.kind === 'doorway') {
    for (const jamb of [x, x + 28]) { fill(jamb, topY, 4, R.tile, top); faceRect(jamb, w.baseY - w.height, 4, w.height) }
    fill(x + 4, topY, 24, 14, top); faceRect(x + 4, topY + 14, 24, 8)
    shadow(x + 4, w.baseY - 7, 24, 7, '#28261955', '#28261900')
  } else if (w.kind === 'broken') {
    for (const [dx, dy, width, height] of [[0, 9, 5, 20], [4, 17, 3, 13], [26, 6, 6, 25], [23, 20, 4, 12]]) {
      fill(x + dx, topY + dy, width, height, top); faceRect(x + dx, topY + dy + height, width, 10)
    }
  } else if (w.kind === 'collapsed') {
    // Fallen capstones have separate low faces and open gaps, not a short fence.
    for (const [dx, dy, width, height] of [[1, 10, 16, 12], [18, 4, 12, 13], [12, 23, 15, 8]]) {
      shadow(x + dx - 1, topY + dy + height + w.height, width + 2, 3, '#201e1677', '#201e1600')
      fill(x + dx, topY + dy, width, height, variant); faceRect(x + dx, topY + dy + height, width, w.height)
    }
  } else {
    fill(x, topY, R.tile, R.tile, top)
    if (w.material !== 'sandstone') {
      // Keep base material at shared edges; variation cannot break a join.
      ctx.globalAlpha = .6; fill(x + 3, topY + 3, R.tile - 6, R.tile - 6, variant); ctx.globalAlpha = 1
    }
    if (w.north) { fill(x, topY, R.tile, 2, '#4c4227'); fill(x + 1, topY + 2, R.tile - 2, 1, '#e6c886') }
    if (w.southDrop) {
      const faceY = w.baseY - w.height
      shadow(x - 2, faceY + w.southDrop, R.tile + 4, R.shadow, '#201e16b8', '#201e1600')
      faceRect(x, faceY, R.tile, w.southDrop)
    }
    if (w.east) { fill(x + R.tile - R.sideBevel, topY + 2, R.sideBevel, R.tile + w.height - 2, face); fill(x + R.tile - 2, topY + 2, 2, R.tile + w.height - 2, '#342e2088') }
    if (w.west) { fill(x, topY + 2, R.sideBevel, R.tile + w.height - 2, face); fill(x, topY + 2, 1, R.tile + w.height - 2, '#e5c78699') }
    if (w.kind === 'low') {
      // Low ruined cap has shallow missing chips along its exposed rim.
      ctx.globalCompositeOperation = 'destination-out'
      for (const [dx, dy, size] of [[0, 0, 6], [13, 0, 4], [27, 0, 5]]) fill(x + dx, topY + dy, size, 3, '#000')
      ctx.globalCompositeOperation = 'source-over'
    }
  }
  return c
}
