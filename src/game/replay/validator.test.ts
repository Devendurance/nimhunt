import { describe, expect, it } from 'vitest'
import { createRoom01Blueprint } from '../world/room01'
import { hashBlueprint } from './canonical'
import { replayActions } from './engine'
import { validateExpeditionBlueprint } from './validator'
import type { ExpeditionBlueprint } from './types'

const blueprintSource = createRoom01Blueprint('2026-09-09', 'gem-runner')
const validBlueprint = { ...blueprintSource, blueprintHash: hashBlueprint(blueprintSource) }

function rehash(changes: Partial<ExpeditionBlueprint>): ExpeditionBlueprint {
  const candidate = { ...validBlueprint, ...changes, blueprintHash: '' }
  return { ...candidate, blueprintHash: hashBlueprint(candidate) }
}

function reasonOf(result: ReturnType<typeof validateExpeditionBlueprint>): string | undefined {
  return result.valid ? undefined : result.reason
}

describe('expedition blueprint validation', () => {
  it('proves a winning action sequence rather than only geometric reachability', () => {
    const result = validateExpeditionBlueprint(validBlueprint)

    expect(result.valid).toBe(true)
    if (!result.valid) return
    expect(result.winningSequence.length).toBeGreaterThan(0)
    const final = replayActions({
      mission: validBlueprint.mission,
      rulesVersion: validBlueprint.rulesVersion,
      roomVersion: validBlueprint.roomVersion,
      blueprint: validBlueprint,
    }, result.winningSequence)
    expect(final.run.hp).toBeGreaterThan(0)
    expect(final.run.gemsCollected).toBeGreaterThanOrEqual(validBlueprint.missionParameters.gemTarget)
  })

  it('rejects a blueprint with no surviving mission solution', () => {
    const lethalHazards = Array.from({ length: 8 }, (_, index) => ({
      x: index % 7 + 1,
      y: Math.floor(index / 7) + 1,
      type: 'SPIKES' as const,
    }))
    const lethal = rehash({ hazards: lethalHazards, potion: null, chests: [], gems: [] })

    expect(validateExpeditionBlueprint(lethal)).toMatchObject({ valid: false, reason: 'NO_WINNING_SEQUENCE' })
  })

  it('rejects cardinality-valid gems that are unreachable behind the locked gate', () => {
    const unreachable = rehash({
      gems: [
        { id: 'inner-gem-1', x: 9, y: 1 },
        { id: 'inner-gem-2', x: 10, y: 1 },
        { id: 'inner-gem-3', x: 9, y: 2 },
        { id: 'inner-gem-4', x: 10, y: 2 },
        { id: 'inner-gem-5', x: 10, y: 3 },
        { id: 'inner-gem-6', x: 10, y: 4 },
      ],
      chests: [],
      hazards: [],
      key: { x: 9, y: 8 },
    })

    expect(unreachable.gems.length).toBeGreaterThanOrEqual(unreachable.missionParameters.gemTarget)
    expect(validateExpeditionBlueprint(unreachable)).toMatchObject({ valid: false, reason: 'NO_WINNING_SEQUENCE' })
  })

  it('rejects Rules v1 multiple Goblins and timed hazards', () => {
    const goblin = validBlueprint.goblins[0]
    expect(goblin).toBeDefined()
    expect(reasonOf(validateExpeditionBlueprint({ ...validBlueprint, goblins: [...validBlueprint.goblins, goblin!] })))
      .toBe('UNSUPPORTED_RULES_VERSION')
    expect(reasonOf(validateExpeditionBlueprint({
      ...validBlueprint,
      timedHazards: [{ id: 'future-1', x: 4, y: 3, type: 'COLLAPSING_BOULDER', trigger: 'TURN', delay: 2 }],
    }))).toBe('UNSUPPORTED_RULES_VERSION')
  })

  it('requires a winning path within the accepted-action limit', () => {
    expect(validateExpeditionBlueprint(validBlueprint, { maxActions: 0 })).toMatchObject({
      valid: false,
      reason: 'ACTION_LIMIT_EXCEEDED',
    })
  })
})
