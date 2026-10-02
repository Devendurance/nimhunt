import { calculateMove } from '../../systems/movement'
import { DIRECTION_VECTORS, getTileAt, isWalkableTile, tileToPixel, type Direction, type GridCoord, type GridRoom } from '../../world/grid'

export const ANGKOR_V2_MOVE_MS = 145
export interface TraversalMove {
  readonly seq: number
  readonly type: 'MOVE'
  readonly direction: Direction
  readonly from: GridCoord
  readonly to: GridCoord
}
interface ActiveMove { command: TraversalMove; elapsed: number }

/** Opt-in scheduling/presentation around V1's unchanged calculateMove.
 * One accepted tile at a time; no timing/replay/checkpoint authority. */
export class TileTraversal {
  private coord: GridCoord
  private active?: ActiveMove
  private readonly held = new Map<string, Direction>()
  private buffered?: Direction
  private blocked?: Direction
  private sequence = 0
  readonly room: GridRoom
  readonly durationMs: number
  private readonly onMove: (move: TraversalMove) => void
  facing: Direction = 'DOWN'

  constructor(room: GridRoom, onMove: (move: TraversalMove) => void = () => {}, durationMs = ANGKOR_V2_MOVE_MS) {
    if (!Number.isFinite(durationMs) || durationMs <= 0 || !isWalkableTile(getTileAt(room, room.playerStart))) throw new Error('Invalid traversal spawn or timing')
    this.room = room; this.onMove = onMove; this.durationMs = durationMs
    this.coord = { ...room.playerStart }
  }
  get position(): GridCoord { return { ...this.coord } }
  get moving(): boolean { return Boolean(this.active) }
  get seq(): number { return this.sequence }
  get progress(): number { return this.active ? this.active.elapsed / this.durationMs : 0 }
  get bufferedDirection(): Direction | undefined { return this.buffered }
  get activeMove(): TraversalMove | undefined { return this.active?.command }
  get foot(): GridCoord {
    const from = tileToPixel(this.active?.command.from ?? this.coord)
    if (!this.active) return from
    const to = tileToPixel(this.active.command.to), t = this.progress
    return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t }
  }
  press(source: string, direction: Direction): void {
    this.checkDirection(direction)
    if (this.held.get(source) === direction) return
    this.held.delete(source); this.held.set(source, direction)
    this.buffered = direction; this.blocked = undefined
  }
  release(source: string): void { this.held.delete(source); this.blocked = undefined }
  cancel(source: string): void {
    if (this.buffered === this.held.get(source)) this.buffered = undefined
    this.release(source)
  }
  tap(direction: Direction): void { this.checkDirection(direction); this.buffered = direction; this.blocked = undefined }
  clearInput(): void { this.held.clear(); this.buffered = undefined; this.blocked = undefined }
  reset(): void {
    this.clearInput(); this.active = undefined; this.coord = { ...this.room.playerStart }
    this.sequence = 0; this.facing = 'DOWN'
  }
  update(deltaMs: number): void {
    if (!Number.isFinite(deltaMs) || deltaMs < 0) throw new Error('Traversal delta must be finite and nonnegative')
    let carryMs = 0
    if (this.active) {
      carryMs = Math.min(16, Math.max(0, this.active.elapsed + deltaMs - this.durationMs))
      this.active.elapsed = Math.min(this.durationMs, this.active.elapsed + deltaMs)
      if (this.active.elapsed < this.durationMs) return
      this.coord = { ...this.active.command.to }; this.active = undefined; this.blocked = undefined
    }
    // A suspended/slow frame completes at most one tile. It never catches up by
    // emitting a burst of invisible moves or overlapping presentation.
    const held = [...this.held.values()].at(-1)
    const requested = this.buffered ?? held
    this.buffered = undefined
    if (!requested || this.blocked === requested) return
    // Preserve ordinary frame overshoot for smooth holds, bounded to 16ms so a
    // resumed tab cannot fast-forward several unseen cells.
    if (!this.start(requested, carryMs) && held && held !== requested) this.start(held, carryMs)
  }
  private start(direction: Direction, elapsed = 0): boolean {
    this.facing = direction
    const result = calculateMove(this.room, this.coord, direction)
    if (!result.success) { this.blocked = direction; return false }
    this.blocked = undefined
    const command: TraversalMove = { seq: ++this.sequence, type: 'MOVE', direction, from: { ...result.from }, to: { ...result.to } }
    this.active = { command, elapsed }; this.onMove(command)
    return true
  }
  private checkDirection(direction: Direction): void {
    if (!Object.hasOwn(DIRECTION_VECTORS, direction)) throw new Error('Unknown traversal direction')
  }
}
