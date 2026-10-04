import { ANGKOR_V2_TILE_SIZE } from '../../assets/angkorV2Manifest.js'
/** Pure visual geometry; never supplies or mutates gameplay collision. */
export const ANGKOR_V2_RENDER = {
  tile: ANGKOR_V2_TILE_SIZE, normalHeight: 24, tallHeight: 40, lowHeight: 10, collapsedHeight: 5,
  shadow: 7, sideBevel: 3, floorRepeat: 128, capRepeat: 96, faceRepeatWidth: 96, faceRepeatHeight: 64,
  floorBlendMargin: 6, fadeAlpha: .38, fadeDuration: 100, headHeight: 8,
} as const
export type FloorStyle = 'clean' | 'weathered' | 'cracked' | 'mossy' | 'root-damaged' | 'debris'
export type WallKind = 'wall' | 'tall' | 'low' | 'collapsed' | 'doorway' | 'broken'
export type CellKind = 'floor' | WallKind
export interface EnvironmentCell { readonly kind: CellKind; readonly floor?: FloorStyle; readonly material?: 'sandstone' | 'mossy' | 'damaged' }
export interface EnvironmentMap { readonly cells: readonly (readonly EnvironmentCell[])[] }
export interface VisualBounds { x: number; y: number; width: number; height: number }
export interface WallModule {
  x: number; y: number; kind: WallKind; height: number; baseY: number;
  southDrop: number; north: boolean; west: boolean; east: boolean;
  innerCorners: readonly string[]; outerCorners: readonly string[];
  role: 'horizontal' | 'vertical' | 'junction' | 'end-cap'; material: 'sandstone' | 'mossy' | 'damaged';
  bounds: VisualBounds;
}
export const wallHeight = (kind?: CellKind): number => {
  const r = ANGKOR_V2_RENDER
  return kind === 'tall' ? r.tallHeight : kind === 'low' ? r.lowHeight : kind === 'collapsed' ? r.collapsedHeight : kind === 'wall' || kind === 'doorway' ? r.normalHeight : 0
}
export function validateEnvironmentMap(map: EnvironmentMap): { width: number; height: number } {
  const height = map.cells.length, width = map.cells[0]?.length ?? 0
  if (!height || !width || width > 64 || height > 64 || map.cells.some(row => row.length !== width)) throw new Error('Environment map must be a nonempty rectangular grid, at most 64×64')
  const kinds = new Set(['floor', 'wall', 'tall', 'low', 'collapsed', 'doorway', 'broken'])
  const floors = new Set(['clean', 'weathered', 'cracked', 'mossy', 'root-damaged', 'debris'])
  for (const row of map.cells) for (const cell of row) {
    if (!kinds.has(cell.kind) || (cell.floor && !floors.has(cell.floor)) || (cell.material && !['sandstone', 'mossy', 'damaged'].includes(cell.material))) throw new Error('Unknown Angkor V2 visual cell')
  }
  return { width, height }
}
export function compileWallModules(map: EnvironmentMap): WallModule[] {
  validateEnvironmentMap(map)
  const cell = (x: number, y: number) => map.cells[y]?.[x]
  const height = (x: number, y: number) => wallHeight(cell(x, y)?.kind)
  const connected = (x: number, y: number) => height(x, y) > 0
  return map.cells.flatMap((row, y) => row.flatMap((c, x) => {
    if (c.kind === 'floor') return []
    const h = c.kind === 'broken' ? ANGKOR_V2_RENDER.normalHeight : wallHeight(c.kind)
    const n = connected(x, y - 1), s = connected(x, y + 1), e = connected(x + 1, y), w = connected(x - 1, y)
    const innerCorners: string[] = [], outerCorners: string[] = []
    for (const [name, a, b, dx, dy] of [['NW', n, w, -1, -1], ['NE', n, e, 1, -1], ['SW', s, w, -1, 1], ['SE', s, e, 1, 1]] as const) {
      if (!a && !b) outerCorners.push(name)
      if (a && b && !connected(x + dx, y + dy)) innerCorners.push(name)
    }
    const neighbors = [n, s, e, w].filter(Boolean).length
    const material = c.material ?? ((x * 17 + y * 13) % 11 === 0 ? 'damaged' : (x * 7 + y * 19) % 9 === 0 ? 'mossy' : 'sandstone')
    return [{ x, y, kind: c.kind, height: h, baseY: (y + 1) * ANGKOR_V2_RENDER.tile,
      southDrop: Math.max(0, h - height(x, y + 1)), north: !n, west: !w || height(x - 1, y) < h, east: !e || height(x + 1, y) < h,
      innerCorners, outerCorners, role: neighbors <= 1 ? 'end-cap' : e && w && !n && !s ? 'horizontal' : n && s && !e && !w ? 'vertical' : 'junction', material,
      bounds: { x: x * ANGKOR_V2_RENDER.tile, y: y * ANGKOR_V2_RENDER.tile - h, width: ANGKOR_V2_RENDER.tile, height: ANGKOR_V2_RENDER.tile + h },
    } satisfies WallModule]
  }))
}

export type EnvironmentDepthClass = 'floor' | 'floor-overlay' | 'ground-item' | 'low-prop' | 'actor' | 'architecture' | 'wall' | 'foreground' | 'effect'
const ties: Record<EnvironmentDepthClass, number> = { floor: 0, 'floor-overlay': 1, 'ground-item': 2, 'low-prop': 3, actor: 5, architecture: 8, wall: 10, foreground: 12, effect: 14 }
/** World objects interleave by foot/base Y. No permanent global foreground band. */
export function environmentDepth(kind: EnvironmentDepthClass, baseY: number): number {
  if (!Number.isFinite(baseY)) throw new Error('Environment depth requires a finite base Y')
  return kind === 'floor' ? 0 : kind === 'floor-overlay' ? 1 : 1000 + baseY * 16 + ties[kind]
}
export function overlapArea(a: VisualBounds, b: VisualBounds): number {
  return Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))
}
export function shouldFadeOccluder(bounds: VisualBounds, depth: number, actor: { x: number; y: number; width: number; visibleHeight: number }): boolean {
  if (depth <= environmentDepth('actor', actor.y)) return false
  const head = { x: actor.x - actor.width * .3, y: actor.y - actor.visibleHeight, width: actor.width * .6, height: ANGKOR_V2_RENDER.headHeight }
  return overlapArea(bounds, head) / (head.width * head.height) > .55
}
export interface ReadableActor { x: number; y: number; width: number; visibleHeight: number }
export interface ReadabilityOccluder { bounds: VisualBounds; depth: number; opaqueAt?: (x: number, y: number) => boolean }
/** Union coverage handles a player straddling two foreground wall modules. */
export function readabilityOccluders(actor: ReadableActor, candidates: readonly ReadabilityOccluder[]): number[] {
  const head = { x: actor.x - actor.width * .3, y: actor.y - actor.visibleHeight, width: actor.width * .6, height: ANGKOR_V2_RENDER.headHeight }
  const eligible = candidates.map((c, index) => ({ ...c, index })).filter(c => c.depth > environmentDepth('actor', actor.y) && overlapArea(c.bounds, head) > 0)
  const contributors = new Set<number>(); let covered = 0
  for (let row = 0; row < 3; row++) for (let col = 0; col < 5; col++) {
    const x = head.x + head.width * (col + .5) / 5, y = head.y + head.height * (row + .5) / 3
    const hits = eligible.filter(c => x >= c.bounds.x && x < c.bounds.x + c.bounds.width && y >= c.bounds.y && y < c.bounds.y + c.bounds.height && (!c.opaqueAt || c.opaqueAt(x, y)))
    if (hits.length) { covered++; hits.forEach(c => contributors.add(c.index)) }
  }
  return covered / 15 > .55 ? [...contributors] : []
}
export const readabilityAlpha = (contributors: number) => contributors > 0 ? 1 - (1 - ANGKOR_V2_RENDER.fadeAlpha) ** (1 / contributors) : 1
