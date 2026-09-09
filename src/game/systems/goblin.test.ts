import { describe, expect, it } from 'vitest'
import {
  calculateManhattanDistance,
  createGoblinState,
  evaluateGoblinDetection,
  getValidGoblinStep,
  GOBLIN_DAMAGE,
  GOBLIN_DETECTION_RANGE,
  isWalkableForGoblin,
  resolveGoblinCombat,
  stepGoblin,
} from './goblin'
import { createRunState } from '../domain/runState'
import { ANGKOR_ROOM_01, ROOM_01_PUZZLE } from '../world/room01'
import { createPuzzleState } from './puzzle'

const PATROL_ROUTE = [
  { x: 7, y: 4 },
  { x: 7, y: 5 },
  { x: 7, y: 6 },
  { x: 7, y: 7 },
]

describe('Goblin AI & Combat System', () => {
  const puzzle = createPuzzleState(ROOM_01_PUZZLE)

  it('spawns deterministically at given spawn point in PATROL mode', () => {
    const goblin = createGoblinState({ x: 7, y: 4 })
    expect(goblin).toMatchObject({
      gridX: 7,
      gridY: 4,
      facing: 'DOWN',
      state: 'PATROL',
      patrolIndex: 0,
      patrolDirection: 1,
    })
  })

  it('calculates Manhattan distance correctly', () => {
    expect(calculateManhattanDistance({ x: 3, y: 3 }, { x: 7, y: 4 })).toBe(5)
    expect(calculateManhattanDistance({ x: 5, y: 3 }, { x: 7, y: 4 })).toBe(3)
    expect(calculateManhattanDistance({ x: 7, y: 4 }, { x: 7, y: 4 })).toBe(0)
  })

  it('switches PATROL -> CHASE when player enters detection range (<= 3)', () => {
    expect(GOBLIN_DETECTION_RANGE).toBe(3)
    const goblin = createGoblinState({ x: 7, y: 4 })
    // Player at (3, 3) -> distance 5 -> PATROL
    expect(evaluateGoblinDetection(goblin, { x: 3, y: 3 })).toBe('PATROL')
    // Player at (5, 3) -> distance 3 -> CHASE
    expect(evaluateGoblinDetection(goblin, { x: 5, y: 3 })).toBe('CHASE')
    // Player at (6, 4) -> distance 1 -> CHASE
    expect(evaluateGoblinDetection(goblin, { x: 6, y: 4 })).toBe('CHASE')
  })

  it('switches CHASE -> PATROL when player leaves detection range (> 3)', () => {
    const chasing = { ...createGoblinState({ x: 7, y: 4 }), state: 'CHASE' as const }
    // Player retreats to (3, 3) -> distance 5 -> PATROL
    expect(evaluateGoblinDetection(chasing, { x: 3, y: 3 })).toBe('PATROL')
  })

  it('advances along patrol route one step at a time and ping-pongs', () => {
    let goblin = createGoblinState({ x: 7, y: 4 })
    // Step 1: from (7, 4), moves toward (7, 5)
    goblin = stepGoblin(ANGKOR_ROOM_01, puzzle, goblin, { x: 1, y: 1 }, PATROL_ROUTE)
    expect(goblin.gridX).toBe(7)
    expect(goblin.gridY).toBe(5)
    expect(goblin.facing).toBe('DOWN')
    expect(goblin.state).toBe('PATROL')

    // Step 2: moves to (7, 6)
    goblin = stepGoblin(ANGKOR_ROOM_01, puzzle, goblin, { x: 1, y: 1 }, PATROL_ROUTE)
    expect(goblin.gridX).toBe(7)
    expect(goblin.gridY).toBe(6)

    // Step 3: moves to (7, 7)
    goblin = stepGoblin(ANGKOR_ROOM_01, puzzle, goblin, { x: 1, y: 1 }, PATROL_ROUTE)
    expect(goblin.gridX).toBe(7)
    expect(goblin.gridY).toBe(7)

    // Step 4: reaches end of route, reverses direction towards (7, 6)
    goblin = stepGoblin(ANGKOR_ROOM_01, puzzle, goblin, { x: 1, y: 1 }, PATROL_ROUTE)
    expect(goblin.gridX).toBe(7)
    expect(goblin.gridY).toBe(6)
    expect(goblin.facing).toBe('UP')
    expect(goblin.patrolDirection).toBe(-1)
  })

  it('cannot enter walls or leave bounds', () => {
    // Room bounds: 12x10. (12, 5) is out of bounds
    expect(isWalkableForGoblin(ANGKOR_ROOM_01, puzzle, { x: 12, y: 5 })).toBe(false)
    expect(isWalkableForGoblin(ANGKOR_ROOM_01, puzzle, { x: -1, y: 5 })).toBe(false)
    // Wall: (0, 0) is #
    expect(isWalkableForGoblin(ANGKOR_ROOM_01, puzzle, { x: 0, y: 0 })).toBe(false)
    expect(isWalkableForGoblin(ANGKOR_ROOM_01, puzzle, { x: 8, y: 4 })).toBe(false)
    // Locked gate: (8, 3)
    expect(isWalkableForGoblin(ANGKOR_ROOM_01, puzzle, { x: 8, y: 3 })).toBe(false)
    // Boulder: (4, 6)
    expect(isWalkableForGoblin(ANGKOR_ROOM_01, puzzle, { x: 4, y: 6 })).toBe(false)
    // Walkable floor: (7, 4)
    expect(isWalkableForGoblin(ANGKOR_ROOM_01, puzzle, { x: 7, y: 4 })).toBe(true)
  })

  it('determines chase direction with deterministic tie-breaking', () => {
    // Goblin at (7, 5), Player at (5, 4): dx = -2, dy = -1. |dx| > |dy|, prioritizes horizontal (LEFT)
    const step1 = getValidGoblinStep(ANGKOR_ROOM_01, puzzle, { x: 7, y: 5 }, { x: 5, y: 4 })
    expect(step1).toEqual({ step: { x: 6, y: 5 }, facing: 'LEFT' })

    // Goblin at (7, 5), Player at (6, 3): dx = -1, dy = -2. |dy| > |dx|, prioritizes vertical (UP)
    const step2 = getValidGoblinStep(ANGKOR_ROOM_01, puzzle, { x: 7, y: 5 }, { x: 6, y: 3 })
    expect(step2).toEqual({ step: { x: 7, y: 4 }, facing: 'UP' })

    // Goblin at (7, 5), Player at (6, 4): dx = -1, dy = -1. |dx| === |dy|, horizontal tie-break (LEFT)
    const step3 = getValidGoblinStep(ANGKOR_ROOM_01, puzzle, { x: 7, y: 5 }, { x: 6, y: 4 })
    expect(step3).toEqual({ step: { x: 6, y: 5 }, facing: 'LEFT' })
  })

  it('takes alternate step when primary chase direction is blocked by wall', () => {
    // Goblin at (7, 4), Target at (9, 4). (8, 4) is a wall.
    // Horizontal step to (8, 4) is blocked. Secondary vertical step should be taken.
    const step = getValidGoblinStep(ANGKOR_ROOM_01, puzzle, { x: 7, y: 4 }, { x: 9, y: 5 })
    // dx = 2, dy = 1. Primary is (8, 4) which is a wall! Secondary is (7, 5) which is walkable.
    expect(step).toEqual({ step: { x: 7, y: 5 }, facing: 'DOWN' })
  })

  it('chases player when in detection range', () => {
    const goblin = createGoblinState({ x: 7, y: 4 })
    // Player at (6, 4) is adjacent (dist 1 <= 3)
    const next = stepGoblin(ANGKOR_ROOM_01, puzzle, goblin, { x: 6, y: 4 }, PATROL_ROUTE)
    expect(next.state).toBe('CHASE')
    expect(next.gridX).toBe(6)
    expect(next.gridY).toBe(4)
    expect(next.facing).toBe('LEFT')
  })

  describe('Combat & Sword Resolution', () => {
    it('damages player by 20 HP when colliding without sword', () => {
      const run = createRunState() // 100 HP
      const goblin = createGoblinState({ x: 6, y: 4 })
      const result = resolveGoblinCombat(run, false, goblin, { x: 6, y: 4 })

      expect(result.damageDealt).toBe(GOBLIN_DAMAGE)
      expect(result.nextRun.hp).toBe(80)
      expect(result.swordUsed).toBe(false)
      expect(result.nextGoblin.state).toBe('PATROL')
      expect(result.notice).toContain('-20 HP')
    })

    it('fails the run if HP reaches 0 from goblin collision', () => {
      const lowRun = { ...createRunState(), hp: 15 }
      const goblin = createGoblinState({ x: 6, y: 4 })
      const result = resolveGoblinCombat(lowRun, false, goblin, { x: 6, y: 4 })

      expect(result.nextRun.hp).toBe(0)
      expect(result.nextRun.runStatus).toBe('FAILED')
      expect(result.nextRun.missionStatus).toBe('FAILED')
    })

    it('protects player with sword, consuming sword and defeating Goblin with 0 damage', () => {
      const run = createRunState() // 100 HP
      const goblin = createGoblinState({ x: 6, y: 4 })
      const result = resolveGoblinCombat(run, true, goblin, { x: 6, y: 4 })

      expect(result.damageDealt).toBe(0)
      expect(result.nextRun.hp).toBe(100) // No damage!
      expect(result.hasSword).toBe(false) // Sword consumed!
      expect(result.swordUsed).toBe(true)
      expect(result.nextGoblin.state).toBe('DEFEATED')
      expect(result.notice).toBe('Goblin defeated.')
    })

    it('defeated Goblin cannot damage player or move', () => {
      const run = createRunState()
      const defeatedGoblin = { ...createGoblinState({ x: 6, y: 4 }), state: 'DEFEATED' as const }
      // Collision test
      const combat = resolveGoblinCombat(run, false, defeatedGoblin, { x: 6, y: 4 })
      expect(combat.damageDealt).toBe(0)
      expect(combat.nextRun.hp).toBe(100)

      // Step test
      const stepped = stepGoblin(ANGKOR_ROOM_01, puzzle, defeatedGoblin, { x: 6, y: 4 }, PATROL_ROUTE)
      expect(stepped).toEqual(defeatedGoblin)
    })
  })
})
