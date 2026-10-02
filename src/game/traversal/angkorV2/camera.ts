import type { GridCoord } from '../../world/grid'

export const ANGKOR_V2_VIEWPORT = { width: 384, height: 320 } as const
/** Choose once on mount; no zoom change or wider desktop reveal while moving. */
export function traversalViewport(screenWidth: number, screenHeight = 900): Dimensions {
  if (!Number.isFinite(screenWidth) || screenWidth <= 0 || !Number.isFinite(screenHeight) || screenHeight <= 0) throw new Error('Invalid traversal screen dimensions')
  return { width: screenWidth < 352 ? 352 : 384, height: screenHeight < 650 ? 288 : 320 }
}
export const ANGKOR_V2_CAMERA = { anchorY: .575, followTimeMs: 38 } as const
export interface CameraScroll { x: number; y: number }
export interface Dimensions { width: number; height: number }
const clamp = (value: number, max: number) => Math.max(0, Math.min(Math.max(0, max), value))
export function cameraTarget(foot: GridCoord, world: Dimensions, viewport: Dimensions = ANGKOR_V2_VIEWPORT): CameraScroll {
  if (![foot.x, foot.y, world.width, world.height, viewport.width, viewport.height].every(Number.isFinite) || world.width < viewport.width || world.height < viewport.height || viewport.width <= 0 || viewport.height <= 0) throw new Error('Camera requires a finite world at least as large as its viewport')
  return { x: clamp(foot.x - viewport.width / 2, world.width - viewport.width), y: clamp(foot.y - viewport.height * ANGKOR_V2_CAMERA.anchorY, world.height - viewport.height) }
}
/** Time-based smoothing is bounded again after interpolation. Zoom is constant. */
export function followCamera(previous: CameraScroll, foot: GridCoord, world: Dimensions, deltaMs: number, reducedMotion = false, viewport: Dimensions = ANGKOR_V2_VIEWPORT): CameraScroll {
  if (!Number.isFinite(deltaMs) || deltaMs < 0 || !Number.isFinite(previous.x) || !Number.isFinite(previous.y)) throw new Error('Invalid camera state or delta')
  const target = cameraTarget(foot, world, viewport)
  const alpha = reducedMotion ? 1 : 1 - Math.exp(-deltaMs / ANGKOR_V2_CAMERA.followTimeMs)
  return { x: clamp(previous.x + (target.x - previous.x) * alpha, world.width - viewport.width), y: clamp(previous.y + (target.y - previous.y) * alpha, world.height - viewport.height) }
}
