import type { PlayerRunState } from '../domain/runState.ts'
import type { MissionType } from '../domain/mission.ts'
import type { Direction, GridCoord, GridRoom } from '../world/grid.ts'
import { calculateMove, type MoveResult } from './movement.ts'
import { resolveTileEntry, type RoomContents } from './tileEntry.ts'

export interface BoulderPosition extends GridCoord { readonly id: string }
export interface PuzzleObjects {
  readonly boulders: readonly BoulderPosition[]
  readonly key: GridCoord
  readonly gate: GridCoord
  readonly shrine: GridCoord
}
export interface PuzzleState {
  readonly hasTempleKey: boolean
  readonly gateState: 'LOCKED' | 'OPEN'
  readonly boulderPositions: readonly BoulderPosition[]
  readonly objectiveReached: boolean
}
export interface PuzzleMove {
  readonly move: MoveResult
  readonly blockedReason?: string
  readonly pushed?: { readonly id: string; readonly to: GridCoord }
  readonly opensGate: boolean
}
export const sameTile = (a: GridCoord, b: GridCoord) => a.x === b.x && a.y === b.y
export function createPuzzleState(objects: PuzzleObjects): PuzzleState {
  return { hasTempleKey: false, gateState: 'LOCKED', boulderPositions: objects.boulders.map(b => ({ ...b })), objectiveReached: false }
}

export function resolvePuzzleMove(
  room: GridRoom,
  contents: RoomContents,
  objects: PuzzleObjects,
  run: PlayerRunState,
  puzzle: PuzzleState,
  from: GridCoord,
  direction: Direction,
  chestTiles: readonly GridCoord[] = [],
  mission: MissionType = 'gem-runner',
  fallenBoulders: readonly GridCoord[] = [],
): PuzzleMove {
  const move = calculateMove(room, from, direction)
  const blocked = (reason: string): PuzzleMove => ({ move: { ...move, success: false, to: from }, blockedReason: reason, opensGate: false })
  if (run.runStatus !== 'PLAYING') return blocked('RUN_ENDED')
  if (!move.success) return blocked(move.reason ?? 'BLOCKED')
  if (fallenBoulders.some(f => sameTile(f, move.to))) return blocked('BOULDER_BLOCKED')
  const atGate = sameTile(move.to, objects.gate)
  if (atGate && puzzle.gateState === 'LOCKED' && !puzzle.hasTempleKey) return blocked('KEY_REQUIRED')
  const boulder = puzzle.boulderPositions.find(b => sameTile(b, move.to))
  if (boulder) {
    const push = calculateMove(room, boulder, direction)
    const occupied = [
      ...puzzle.boulderPositions,
      ...contents.gems.filter(g => !run.collectedGemIds.includes(g.id)),
      ...contents.hazards,
      ...chestTiles,
      ...(!puzzle.hasTempleKey ? [objects.key] : []),
      objects.gate, objects.shrine,
      ...fallenBoulders,
    ].some(item => sameTile(item, push.to))
    if (!push.success || occupied) return blocked('BOULDER_BLOCKED')
    return { move, pushed: { id: boulder.id, to: push.to }, opensGate: false }
  }
  void mission
  return { move, opensGate: atGate && puzzle.gateState === 'LOCKED' }
}

/** Commit once after animation, preserving hazard → gem → mission evaluation. */
export function commitPuzzleMove(run: PlayerRunState, puzzle: PuzzleState, transition: PuzzleMove, contents: RoomContents, objects: PuzzleObjects, mission: MissionType = 'gem-runner'): { run: PlayerRunState; puzzle: PuzzleState } {
  if (run.runStatus !== 'PLAYING' || !transition.move.success || sameTile(transition.move.from, transition.move.to)) return { run, puzzle }
  const nextRun = resolveTileEntry(run, transition.move, contents, mission)
  return {
    run: nextRun,
    puzzle: {
      hasTempleKey: puzzle.hasTempleKey || sameTile(transition.move.to, objects.key),
      gateState: transition.opensGate ? 'OPEN' : puzzle.gateState,
      boulderPositions: transition.pushed ? puzzle.boulderPositions.map(b => b.id === transition.pushed?.id ? { ...b, ...transition.pushed.to } : b) : puzzle.boulderPositions,
      objectiveReached: puzzle.objectiveReached || (nextRun.hp > 0 && sameTile(transition.move.to, objects.shrine)),
    },
  }
}
