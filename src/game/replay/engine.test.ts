import { describe, expect, it } from 'vitest'
import { createInitialRun, advanceRun, replayActions } from './engine'
import type { ExpeditionBlueprint, MoveAction } from './types'

const blueprint: ExpeditionBlueprint = {
  rulesVersion: 'nimhunt-rules-v1',
  roomVersion: 'angkor-room-01-v1',
  blueprintVersion: 'angkor-blueprint-v1',
  dayKey: '2026-09-09',
  mission: 'gem-runner',
  blueprintId: 'engine-blueprint',
  blueprintHash: 'a'.repeat(64),
  status: 'PUBLISHED',
  spawn: { x: 3, y: 3 },
  goblins: [{ id: 'goblin-1', spawn: { x: 7, y: 4 }, patrolRoute: [{ x: 7, y: 4 }, { x: 7, y: 5 }, { x: 7, y: 6 }, { x: 7, y: 7 }] }],
  gems: [
    { id: 'gem-1', x: 2, y: 3 },
    { id: 'gem-2', x: 1, y: 1 },
    { id: 'gem-3', x: 5, y: 1 },
    { id: 'gem-4', x: 9, y: 1 },
    { id: 'gem-5', x: 10, y: 4 },
    { id: 'gem-6', x: 10, y: 8 },
    { id: 'gem-7', x: 5, y: 8 },
    { id: 'gem-8', x: 1, y: 8 },
  ],
  chests: [
    { id: 'chest-1', x: 1, y: 2, loot: 'GEMS' },
    { id: 'chest-2', x: 6, y: 3, loot: 'POTION' },
    { id: 'chest-3', x: 5, y: 5, loot: 'TRAP' },
    { id: 'chest-4', x: 10, y: 3, loot: 'SWORD' },
  ],
  sword: { x: 1, y: 6 },
  potion: { x: 2, y: 1 },
  hazards: [{ x: 5, y: 3, type: 'SPIKES' }, { x: 6, y: 6, type: 'POISON' }],
  boulders: [{ id: 'boulder-1', x: 4, y: 6 }],
  key: { x: 3, y: 6 },
  gate: { x: 8, y: 3 },
  objective: { x: 9, y: 3 },
  missionParameters: { gemTarget: 6, chestTarget: 4 },
  timedHazards: [],
}

function runInput(overrides: Partial<ExpeditionBlueprint> = {}) {
  const mission = overrides.mission ?? 'gem-runner'
  return {
    mission,
    rulesVersion: 'nimhunt-rules-v1' as const,
    roomVersion: 'angkor-room-01-v1' as const,
    blueprint: { ...blueprint, ...overrides },
  }
}

function moves(...directions: MoveAction['direction'][]): MoveAction[] {
  return directions.map((direction, index) => ({ seq: index + 1, type: 'MOVE', direction }))
}

describe('pure expedition replay engine', () => {
  it('creates the exact immutable initial state from the bound blueprint', () => {
    const state = createInitialRun(runInput())

    expect(state.seq).toBe(0)
    expect(state.player).toEqual({ x: 3, y: 3 })
    expect(state.run.hp).toBe(100)
    expect(state.run.gemsCollected).toBe(0)
    expect(state.chests.every(chest => chest.state === 'CLOSED')).toBe(true)
    expect(state.goblins[0]).toMatchObject({ gridX: 7, gridY: 4, state: 'PATROL', patrolIndex: 0 })
  })

  it('rejects blocked input without changing state or sequence', () => {
    const state = createInitialRun(runInput())
    const result = advanceRun(state, { seq: 1, type: 'MOVE', direction: 'UP' })

    expect(result.accepted).toBe(false)
    expect(result.reason).toBe('BLOCKED_BY_WALL')
    expect(result.state).toEqual(state)
  })

  it('applies a valid move, collects a gem, and advances one accepted sequence', () => {
    const state = createInitialRun(runInput())
    const result = advanceRun(state, { seq: 1, type: 'MOVE', direction: 'LEFT' })

    expect(result.accepted).toBe(true)
    expect(result.state.seq).toBe(1)
    expect(result.state.player).toEqual({ x: 2, y: 3 })
    expect(result.state.run.gemsCollected).toBe(1)
    expect(result.state.run.collectedGemIds).toEqual(['gem-1'])
  })

  it('uses the verified hazard, chest, and item values in visible turn order', () => {
    const hazardStart = createInitialRun(runInput())
    const afterSpike = advanceRun(advanceRun(hazardStart, { seq: 1, type: 'MOVE', direction: 'RIGHT' }).state, {
      seq: 2,
      type: 'MOVE',
      direction: 'RIGHT',
    }).state
    expect(afterSpike.run.hp).toBe(75)

    const chestState = replayActions(runInput(), moves('LEFT', 'LEFT', 'UP'))
    expect(chestState.run.chestsOpened).toBe(1)
    expect(chestState.run.gemsCollected).toBe(3)
    expect(chestState.chests[0]).toMatchObject({ state: 'OPEN', resolved: true })
  })

  it('requires contiguous accepted action sequence numbers', () => {
    const state = createInitialRun(runInput())
    const result = advanceRun(state, { seq: 2, type: 'MOVE', direction: 'LEFT' })

    expect(result.accepted).toBe(false)
    expect(result.reason).toBe('INVALID_SEQUENCE')
    expect(result.state).toEqual(state)
  })

  it('replays a Vault reach as alive objective progress without auto-completing it', () => {
    const state = createInitialRun(runInput({
      mission: 'vault-breaker',
      objective: { x: 4, y: 3 },
      gems: [],
      chests: [],
      hazards: [],
      boulders: [],
      goblins: [{ id: 'goblin-1', spawn: { x: 10, y: 8 }, patrolRoute: [{ x: 10, y: 8 }] }],
    }))
    const result = advanceRun(state, { seq: 1, type: 'MOVE', direction: 'RIGHT' })

    expect(result.accepted).toBe(true)
    expect(result.state.puzzle.objectiveReached).toBe(true)
    expect(result.state.run.hp).toBeGreaterThan(0)
    expect(result.state.run.runStatus).toBe('PLAYING')
    expect(result.state.run.missionStatus).toBe('IN_PROGRESS')
  })

  it('produces the same server state when the same accepted transcript is replayed', () => {
    const actions = moves('LEFT', 'LEFT', 'UP', 'UP', 'RIGHT')
    const first = replayActions(runInput(), actions)
    const second = replayActions(runInput(), actions)

    expect(second).toEqual(first)
    expect(second.seq).toBe(actions.length)
  })
})
