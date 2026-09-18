import { describe, expect, it } from 'vitest'
import { advanceRun, createInitialRun } from '../replay/engine.ts'
import type { ExpeditionBlueprint, MoveAction, ReplayState, TickAction } from '../replay/types.ts'
import { BLUEPRINT_VERSION_V2, ROOM_VERSION, RULES_VERSION } from '../replay/versions.ts'

function createTestBlueprint(overrides: Partial<ExpeditionBlueprint> = {}): ExpeditionBlueprint {
  return {
    rulesVersion: RULES_VERSION,
    roomVersion: ROOM_VERSION,
    blueprintVersion: BLUEPRINT_VERSION_V2,
    dayKey: '2026-09-18',
    mission: 'vault-breaker',
    blueprintId: 'test-collapsing-boulder-bp',
    blueprintHash: 'test-hash',
    status: 'VALIDATED',
    spawn: { x: 3, y: 3 },
    goblins: [],
    gems: [],
    chests: [],
    sword: null,
    potion: null,
    hazards: [],
    boulders: [{ id: 'push-boulder-1', x: 4, y: 6 }],
    key: { x: 1, y: 8 },
    gate: { x: 8, y: 3 },
    objective: { x: 10, y: 3 },
    missionParameters: { gemTarget: 6, chestTarget: 4 },
    timedHazards: [
      {
        id: 'test-cb-1',
        x: 6,
        y: 2,
        type: 'COLLAPSING_BOULDER',
        trigger: 'REAL_TIME',
        delay: 4,
        warningTicks: 4,
        triggerCells: [{ x: 5, y: 1 }, { x: 6, y: 1 }],
      },
    ],
    ...overrides,
  }
}

function initRun(bp: ExpeditionBlueprint): ReplayState {
  return createInitialRun({
    rulesVersion: bp.rulesVersion,
    roomVersion: bp.roomVersion,
    mission: bp.mission,
    blueprint: bp,
  })
}

function move(state: ReplayState, direction: MoveAction['direction']): MoveAction {
  return {
    seq: state.seq + 1,
    type: 'MOVE',
    direction,
  }
}

function tick(state: ReplayState): TickAction {
  return {
    seq: state.seq + 1,
    type: 'TICK',
  }
}

describe('Collapsing Boulder Hazard', () => {
  it('initializes in ARMED state with impact cell walkable', () => {
    const bp = createTestBlueprint()
    const run = initRun(bp)

    expect(run.collapsingBoulders).toBeDefined()
    expect(run.collapsingBoulders).toHaveLength(1)
    expect(run.collapsingBoulders![0]).toEqual({
      id: 'test-cb-1',
      state: 'ARMED',
      triggeredAtTick: null,
      elapsedTicks: 0,
      targetTicks: 4,
      collapseAtTick: 4,
    })
  })

  it('rejects a TICK action when no hazard is in WARNING state', () => {
    const bp = createTestBlueprint()
    const state = initRun(bp)
    const result = advanceRun(state, tick(state))
    expect(result.accepted).toBe(false)
    expect(result.reason).toBe('UNEXPECTED_TICK')
  })

  it('transitions from ARMED to WARNING when player steps into a trigger cell', () => {
    const bp = createTestBlueprint()
    let state = initRun(bp)

    // Player moves: (3,3) -> (4,3) -> (5,3) -> (5,2) -> (5,1) [trigger cell!]
    state = advanceRun(state, move(state, 'RIGHT')).state // (4,3)
    expect(state.collapsingBoulders![0]!.state).toBe('ARMED')

    state = advanceRun(state, move(state, 'RIGHT')).state // (5,3)
    expect(state.collapsingBoulders![0]!.state).toBe('ARMED')

    state = advanceRun(state, move(state, 'UP')).state // (5,2)
    expect(state.collapsingBoulders![0]!.state).toBe('ARMED')

    state = advanceRun(state, move(state, 'UP')).state // (5,1) - trigger!
    expect(state.player).toEqual({ x: 5, y: 1 })
    expect(state.collapsingBoulders![0]!.state).toBe('WARNING')
    expect(state.collapsingBoulders![0]!.triggeredAtTick).toBe(4)
    expect(state.collapsingBoulders![0]!.elapsedTicks).toBe(0)
    expect(state.collapsingBoulders![0]!.targetTicks).toBe(4)
  })

  it('collapses after targetTicks even if player stands still (zero moves)', () => {
    const bp = createTestBlueprint()
    let state = initRun(bp)

    // Step to trigger cell (5,1) at seq 4
    state = advanceRun(state, move(state, 'RIGHT')).state
    state = advanceRun(state, move(state, 'RIGHT')).state
    state = advanceRun(state, move(state, 'UP')).state
    state = advanceRun(state, move(state, 'UP')).state
    expect(state.collapsingBoulders![0]!.state).toBe('WARNING')

    // Player stands still at (5,1) while 4 simulation ticks fire
    state = advanceRun(state, tick(state)).state // tick 1
    expect(state.collapsingBoulders![0]!.state).toBe('WARNING')
    expect(state.collapsingBoulders![0]!.elapsedTicks).toBe(1)

    state = advanceRun(state, tick(state)).state // tick 2
    expect(state.collapsingBoulders![0]!.state).toBe('WARNING')
    expect(state.collapsingBoulders![0]!.elapsedTicks).toBe(2)

    state = advanceRun(state, tick(state)).state // tick 3
    expect(state.collapsingBoulders![0]!.state).toBe('WARNING')
    expect(state.collapsingBoulders![0]!.elapsedTicks).toBe(3)

    state = advanceRun(state, tick(state)).state // tick 4 -> COLLAPSE!
    expect(state.collapsingBoulders![0]!.state).toBe('FALLEN')
    expect(state.collapsingBoulders![0]!.elapsedTicks).toBe(4)
    expect(state.player).toEqual({ x: 5, y: 1 })
    expect(state.run.hp).toBe(100) // alive, was not on impact cell (6,2)

    // Once FALLEN, further TICK actions are rejected
    const extraTick = advanceRun(state, tick(state))
    expect(extraTick.accepted).toBe(false)
    expect(extraTick.reason).toBe('UNEXPECTED_TICK')
  })

  it('allows safe passage through impact cell while in WARNING before collapse', () => {
    const bp = createTestBlueprint()
    let state = initRun(bp)

    // Move to (5,1) to trigger at seq 4
    state = advanceRun(state, move(state, 'RIGHT')).state
    state = advanceRun(state, move(state, 'RIGHT')).state
    state = advanceRun(state, move(state, 'UP')).state
    state = advanceRun(state, move(state, 'UP')).state
    expect(state.collapsingBoulders![0]!.state).toBe('WARNING')

    // 1 tick fires
    state = advanceRun(state, tick(state)).state
    expect(state.collapsingBoulders![0]!.elapsedTicks).toBe(1)

    // Step to (6,1)
    state = advanceRun(state, move(state, 'RIGHT')).state
    expect(state.player).toEqual({ x: 6, y: 1 })

    // Step down to impact tile (6,2). Safe passage before collapse!
    state = advanceRun(state, move(state, 'DOWN')).state
    expect(state.player).toEqual({ x: 6, y: 2 })
    expect(state.run.hp).toBe(100)
    expect(state.collapsingBoulders![0]!.state).toBe('WARNING')

    // Step out of danger to (6,3)
    state = advanceRun(state, move(state, 'DOWN')).state
    expect(state.player).toEqual({ x: 6, y: 3 })
    expect(state.run.hp).toBe(100)

    // Remaining ticks fire: tick 2, 3, 4 -> collapse!
    state = advanceRun(state, tick(state)).state
    state = advanceRun(state, tick(state)).state
    state = advanceRun(state, tick(state)).state
    expect(state.collapsingBoulders![0]!.state).toBe('FALLEN')
    expect(state.player).toEqual({ x: 6, y: 3 })
    expect(state.run.hp).toBe(100)
  })

  it('kills the player instantly if player is on the impact cell at collapse tick', () => {
    const bp = createTestBlueprint()
    let state = initRun(bp)

    // Move to (5,1) to trigger at seq 4
    state = advanceRun(state, move(state, 'RIGHT')).state
    state = advanceRun(state, move(state, 'RIGHT')).state
    state = advanceRun(state, move(state, 'UP')).state
    state = advanceRun(state, move(state, 'UP')).state

    // Player moves to (6,1) then onto impact cell (6,2)
    state = advanceRun(state, move(state, 'RIGHT')).state
    state = advanceRun(state, move(state, 'DOWN')).state
    expect(state.player).toEqual({ x: 6, y: 2 })

    // Ticks 1, 2, 3 fire: player still on (6,2), still alive
    state = advanceRun(state, tick(state)).state
    state = advanceRun(state, tick(state)).state
    state = advanceRun(state, tick(state)).state
    expect(state.run.hp).toBe(100)
    expect(state.collapsingBoulders![0]!.state).toBe('WARNING')

    // Tick 4 fires (collapse tick!) while player is on (6,2) -> INSTANT CRUSH DEATH
    const crushResult = advanceRun(state, tick(state))
    expect(crushResult.accepted).toBe(true)
    state = crushResult.state
    expect(state.collapsingBoulders![0]!.state).toBe('FALLEN')
    expect(state.run.hp).toBe(0)
    expect(state.run.runStatus).toBe('FAILED')
    expect(state.run.missionStatus).toBe('FAILED')
  })

  it('permanently blocks player movement into the cell once FALLEN', () => {
    const bp = createTestBlueprint()
    let state = initRun(bp)

    // Escape past (6,2) into (6,3)
    state = advanceRun(state, move(state, 'RIGHT')).state // (4,3)
    state = advanceRun(state, move(state, 'RIGHT')).state // (5,3)
    state = advanceRun(state, move(state, 'UP')).state // (5,2)
    state = advanceRun(state, move(state, 'UP')).state // (5,1) trigger!
    state = advanceRun(state, move(state, 'RIGHT')).state // (6,1)
    state = advanceRun(state, move(state, 'DOWN')).state // (6,2)
    state = advanceRun(state, move(state, 'DOWN')).state // (6,3)

    // Advance 4 ticks to collapse
    state = advanceRun(state, tick(state)).state
    state = advanceRun(state, tick(state)).state
    state = advanceRun(state, tick(state)).state
    state = advanceRun(state, tick(state)).state
    expect(state.collapsingBoulders![0]!.state).toBe('FALLEN')

    // Now attempt to move UP into (6,2) which is now FALLEN
    const blockedResult = advanceRun(state, move(state, 'UP'))
    expect(blockedResult.accepted).toBe(false)
    expect(blockedResult.reason).toBe('BOULDER_BLOCKED')
    expect(blockedResult.state.player).toEqual({ x: 6, y: 3 })
  })

  it('blocks pushable boulder when target destination is a FALLEN boulder', () => {
    const bp = createTestBlueprint({
      spawn: { x: 6, y: 4 },
      boulders: [{ id: 'push-boulder-1', x: 6, y: 3 }],
      timedHazards: [
        {
          id: 'test-cb-1',
          x: 6,
          y: 2,
          type: 'COLLAPSING_BOULDER',
          trigger: 'REAL_TIME',
          delay: 1,
          warningTicks: 1,
          triggerCells: [{ x: 5, y: 4 }],
        },
      ],
    })
    let state = initRun(bp)

    // Step to trigger cell (5,4)
    state = advanceRun(state, move(state, 'LEFT')).state
    expect(state.collapsingBoulders![0]!.state).toBe('WARNING')

    // 1 tick collapses the boulder at (6,2)
    state = advanceRun(state, tick(state)).state
    expect(state.collapsingBoulders![0]!.state).toBe('FALLEN')

    // Move back to (6,4)
    state = advanceRun(state, move(state, 'RIGHT')).state
    expect(state.player).toEqual({ x: 6, y: 4 })
    expect(state.puzzle.boulderPositions[0]).toEqual({ id: 'push-boulder-1', x: 6, y: 3 })

    // Now try to push boulder at (6,3) UP into (6,2) (which is FALLEN!)
    const pushResult = advanceRun(state, move(state, 'UP'))
    expect(pushResult.accepted).toBe(false)
    expect(pushResult.reason).toBe('BOULDER_BLOCKED')
    expect(pushResult.state.puzzle.boulderPositions[0]).toEqual({ id: 'push-boulder-1', x: 6, y: 3 })
    expect(pushResult.state.player).toEqual({ x: 6, y: 4 })
  })

  it('prevents goblins from pathing into a FALLEN boulder cell', () => {
    const bp = createTestBlueprint({
      goblins: [
        {
          id: 'test-goblin',
          spawn: { x: 7, y: 2 },
          patrolRoute: [{ x: 7, y: 2 }, { x: 6, y: 2 }, { x: 5, y: 2 }],
        },
      ],
      timedHazards: [
        {
          id: 'test-cb-1',
          x: 6,
          y: 2,
          type: 'COLLAPSING_BOULDER',
          trigger: 'REAL_TIME',
          delay: 1,
          warningTicks: 1,
          triggerCells: [{ x: 4, y: 3 }],
        },
      ],
    })
    let state = initRun(bp)

    // Trigger hazard: move RIGHT to (4,3)
    state = advanceRun(state, move(state, 'RIGHT')).state
    expect(state.collapsingBoulders![0]!.state).toBe('WARNING')

    // 1 tick collapses the boulder at (6,2)
    state = advanceRun(state, tick(state)).state
    expect(state.collapsingBoulders![0]!.state).toBe('FALLEN')

    // Next player move triggers goblin step
    state = advanceRun(state, move(state, 'LEFT')).state // (3,3)

    // Goblin at (7,2) wants to step along patrol towards (6,2).
    // Because (6,2) is FALLEN, goblin cannot step into (6,2).
    expect(state.goblins[0]!.gridX).not.toBe(6)
  })

  it('remains FALLEN permanently and does not re-trigger', () => {
    const bp = createTestBlueprint()
    let state = initRun(bp)

    // Trigger and collapse
    state = advanceRun(state, move(state, 'RIGHT')).state // (4,3)
    state = advanceRun(state, move(state, 'RIGHT')).state // (5,3)
    state = advanceRun(state, move(state, 'UP')).state // (5,2)
    state = advanceRun(state, move(state, 'UP')).state // (5,1) trigger!
    state = advanceRun(state, move(state, 'RIGHT')).state // (6,1)
    state = advanceRun(state, move(state, 'DOWN')).state // (6,2)
    state = advanceRun(state, move(state, 'DOWN')).state // (6,3)

    // 4 ticks to collapse
    state = advanceRun(state, tick(state)).state
    state = advanceRun(state, tick(state)).state
    state = advanceRun(state, tick(state)).state
    state = advanceRun(state, tick(state)).state
    expect(state.collapsingBoulders![0]!.state).toBe('FALLEN')

    // Walk over trigger cell (5,1) again
    state = advanceRun(state, move(state, 'LEFT')).state // (5,3)
    state = advanceRun(state, move(state, 'UP')).state // (5,2)
    state = advanceRun(state, move(state, 'UP')).state // (5,1) [trigger cell!]

    // Must remain FALLEN!
    expect(state.collapsingBoulders![0]!.state).toBe('FALLEN')
  })

  it('guarantees deterministic replay idempotency with interleaved moves and ticks', () => {
    const bp = createTestBlueprint()

    const executeRun = () => {
      let state = initRun(bp)
      state = advanceRun(state, move(state, 'RIGHT')).state // (4,3)
      state = advanceRun(state, move(state, 'RIGHT')).state // (5,3)
      state = advanceRun(state, move(state, 'UP')).state // (5,2)
      state = advanceRun(state, move(state, 'UP')).state // (5,1) trigger!
      state = advanceRun(state, tick(state)).state // tick 1
      state = advanceRun(state, move(state, 'RIGHT')).state // (6,1)
      state = advanceRun(state, tick(state)).state // tick 2
      state = advanceRun(state, move(state, 'DOWN')).state // (6,2)
      state = advanceRun(state, move(state, 'DOWN')).state // (6,3)
      state = advanceRun(state, tick(state)).state // tick 3
      state = advanceRun(state, tick(state)).state // tick 4 -> FALLEN
      return state
    }

    const state1 = executeRun()
    const state2 = executeRun()

    expect(state1).toEqual(state2)
    expect(state1.collapsingBoulders![0]!.state).toBe('FALLEN')
    expect(state1.run.hp).toBe(100)
    expect(state1.player).toEqual({ x: 6, y: 3 })
  })
})
