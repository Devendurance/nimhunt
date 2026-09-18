import { clampHP, type PlayerRunState } from '../domain/runState.ts'
import { sameTile, type PuzzleState } from './puzzle.ts'
import type { Direction, GridCoord, GridRoom } from '../world/grid.ts'

export type GoblinAIState = 'PATROL' | 'CHASE' | 'STUNNED' | 'DEFEATED'

export interface GoblinState {
  readonly gridX: number
  readonly gridY: number
  readonly facing: Direction
  readonly state: GoblinAIState
  readonly patrolIndex: number
  readonly patrolDirection: 1 | -1
}

export const GOBLIN_DAMAGE = 20
export const GOBLIN_DETECTION_RANGE = 3

export function createGoblinState(spawn: GridCoord): GoblinState {
  return {
    gridX: spawn.x,
    gridY: spawn.y,
    facing: 'DOWN',
    state: 'PATROL',
    patrolIndex: 0,
    patrolDirection: 1,
  }
}

export function calculateManhattanDistance(a: GridCoord, b: GridCoord): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y)
}

export function evaluateGoblinDetection(goblin: GoblinState, playerPos: GridCoord): GoblinAIState {
  if (goblin.state === 'DEFEATED' || goblin.state === 'STUNNED') {
    return goblin.state
  }
  const dist = calculateManhattanDistance({ x: goblin.gridX, y: goblin.gridY }, playerPos)
  return dist <= GOBLIN_DETECTION_RANGE ? 'CHASE' : 'PATROL'
}

export function isWalkableForGoblin(
  room: GridRoom,
  puzzle: PuzzleState,
  coord: GridCoord,
  lockedGateCoord: GridCoord = { x: 8, y: 3 },
  fallenBoulders: readonly GridCoord[] = [],
): boolean {
  // 1. Bounds check
  if (coord.x < 0 || coord.x >= room.width || coord.y < 0 || coord.y >= room.height) {
    return false
  }

  // 2. Wall check
  if (room.layout[coord.y]?.[coord.x] === '#') {
    return false
  }

  // 3. Locked gate check
  if (sameTile(coord, lockedGateCoord) && puzzle.gateState === 'LOCKED') {
    return false
  }

  // 4. Boulder obstruction check
  if (puzzle.boulderPositions.some(b => sameTile(b, coord))) {
    return false
  }

  // 5. Fallen boulder obstruction check
  if (fallenBoulders.some(b => sameTile(b, coord))) {
    return false
  }

  return true
}

export function getValidGoblinStep(
  room: GridRoom,
  puzzle: PuzzleState,
  from: GridCoord,
  target: GridCoord,
  lockedGateCoord: GridCoord = { x: 8, y: 3 },
  fallenBoulders: readonly GridCoord[] = [],
): { step: GridCoord; facing: Direction } | null {
  const dx = target.x - from.x
  const dy = target.y - from.y

  if (dx === 0 && dy === 0) return null

  type Candidate = { step: GridCoord; facing: Direction }
  const candidates: Candidate[] = []

  const horizCandidate: Candidate | null =
    dx > 0
      ? { step: { x: from.x + 1, y: from.y }, facing: 'RIGHT' }
      : dx < 0
      ? { step: { x: from.x - 1, y: from.y }, facing: 'LEFT' }
      : null

  const vertCandidate: Candidate | null =
    dy > 0
      ? { step: { x: from.x, y: from.y + 1 }, facing: 'DOWN' }
      : dy < 0
      ? { step: { x: from.x, y: from.y - 1 }, facing: 'UP' }
      : null

  // Tie-breaking: prioritize larger delta axis; if equal, prioritize horizontal
  if (Math.abs(dx) >= Math.abs(dy)) {
    if (horizCandidate) candidates.push(horizCandidate)
    if (vertCandidate) candidates.push(vertCandidate)
  } else {
    if (vertCandidate) candidates.push(vertCandidate)
    if (horizCandidate) candidates.push(horizCandidate)
  }

  for (const cand of candidates) {
    if (isWalkableForGoblin(room, puzzle, cand.step, lockedGateCoord, fallenBoulders)) {
      return cand
    }
  }

  return null
}

export function stepGoblin(
  room: GridRoom,
  puzzle: PuzzleState,
  goblin: GoblinState,
  playerPos: GridCoord,
  patrolRoute: readonly GridCoord[],
  lockedGateCoord: GridCoord = { x: 8, y: 3 },
  fallenBoulders: readonly GridCoord[] = [],
): GoblinState {
  if (goblin.state === 'DEFEATED' || goblin.state === 'STUNNED') {
    return goblin
  }

  const nextState = evaluateGoblinDetection(goblin, playerPos)

  if (nextState === 'CHASE') {
    const step = getValidGoblinStep(
      room,
      puzzle,
      { x: goblin.gridX, y: goblin.gridY },
      playerPos,
      lockedGateCoord,
      fallenBoulders,
    )
    if (!step) {
      return { ...goblin, state: 'CHASE' }
    }
    return {
      ...goblin,
      gridX: step.step.x,
      gridY: step.step.y,
      facing: step.facing,
      state: 'CHASE',
    }
  }

  // PATROL mode
  if (patrolRoute.length === 0) {
    return { ...goblin, state: 'PATROL' }
  }

  let nextIndex = goblin.patrolIndex
  let nextDir = goblin.patrolDirection

  const currentTarget = patrolRoute[goblin.patrolIndex]
  const atWaypoint = sameTile({ x: goblin.gridX, y: goblin.gridY }, currentTarget)

  if (atWaypoint) {
    nextIndex = goblin.patrolIndex + goblin.patrolDirection
    if (nextIndex >= patrolRoute.length) {
      nextIndex = Math.max(0, patrolRoute.length - 2)
      nextDir = -1
    } else if (nextIndex < 0) {
      nextIndex = Math.min(patrolRoute.length - 1, 1)
      nextDir = 1
    }
  }

  const destination = patrolRoute[nextIndex]
  const step = getValidGoblinStep(
    room,
    puzzle,
    { x: goblin.gridX, y: goblin.gridY },
    destination,
    lockedGateCoord,
    fallenBoulders,
  )

  if (!step) {
    return { ...goblin, state: 'PATROL', patrolIndex: nextIndex, patrolDirection: nextDir }
  }

  return {
    ...goblin,
    gridX: step.step.x,
    gridY: step.step.y,
    facing: step.facing,
    state: 'PATROL',
    patrolIndex: nextIndex,
    patrolDirection: nextDir,
  }
}

export interface CombatResolution {
  readonly nextRun: PlayerRunState
  readonly hasSword: boolean
  readonly nextGoblin: GoblinState
  readonly damageDealt: number
  readonly swordUsed: boolean
  readonly notice: string
}

export function resolveGoblinCombat(
  playerRun: PlayerRunState,
  hasSword: boolean,
  goblin: GoblinState,
  playerPos: GridCoord
): CombatResolution {
  if (
    goblin.state === 'DEFEATED' ||
    !sameTile({ x: goblin.gridX, y: goblin.gridY }, playerPos)
  ) {
    return {
      nextRun: playerRun,
      hasSword,
      nextGoblin: goblin,
      damageDealt: 0,
      swordUsed: false,
      notice: '',
    }
  }

  if (hasSword) {
    return {
      nextRun: playerRun,
      hasSword: false,
      nextGoblin: { ...goblin, state: 'DEFEATED' },
      damageDealt: 0,
      swordUsed: true,
      notice: 'Goblin defeated.',
    }
  }

  const nextHp = clampHP(playerRun.hp - GOBLIN_DAMAGE)
  const failed = nextHp <= 0

  return {
    nextRun: {
      ...playerRun,
      hp: nextHp,
      runStatus: failed ? 'FAILED' : playerRun.runStatus,
      missionStatus: failed ? 'FAILED' : playerRun.missionStatus,
    },
    hasSword: false,
    nextGoblin: goblin,
    damageDealt: GOBLIN_DAMAGE,
    swordUsed: false,
    notice: 'Ambushed! -20 HP',
  }
}
