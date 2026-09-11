import { describe, expect, it } from 'vitest'
import { hashBlueprint } from '../../src/game/replay/canonical.ts'
import { replayActions } from '../../src/game/replay/engine.ts'
import type { ExpeditionBlueprint, MoveAction } from '../../src/game/replay/types.ts'
import { validateExpeditionBlueprint } from '../../src/game/replay/validator.ts'
import { createMemoryProofService, publicationValidationStats } from './memoryProofStore.ts'
import { createBootstrapBlueprint, createPublishedBootstrapBlueprint } from './blueprintBootstrap.ts'
import {
  decodeRoom01BootstrapWinningSequence,
  hashRoom01BootstrapTemplate,
  isPrevalidatedRoom01Bootstrap,
  PREVALIDATED_ROOM_01_BOOTSTRAP_TEMPLATE_HASHES,
  PREVALIDATED_ROOM_01_BOOTSTRAP_WINNING_SEQUENCES,
  ROOM_01_BOOTSTRAP_MISSIONS,
  ROOM_01_BOOTSTRAP_TEMPLATE_DAY_KEY,
} from './room01BootstrapPrevalidation.ts'

function rehash(blueprint: ExpeditionBlueprint, changes: Partial<ExpeditionBlueprint>): ExpeditionBlueprint {
  const candidate = { ...blueprint, ...changes, blueprintHash: '' }
  return { ...candidate, blueprintHash: hashBlueprint(candidate) }
}

function encodeSequence(actions: readonly MoveAction[]): string {
  return actions.map(action => action.direction[0]!).join('')
}

function isLiveWin(blueprint: ExpeditionBlueprint, actions: readonly MoveAction[]): boolean {
  const final = replayActions({
    mission: blueprint.mission,
    rulesVersion: blueprint.rulesVersion,
    roomVersion: blueprint.roomVersion,
    blueprint,
  }, actions)
  if (final.run.hp <= 0) return false
  if (blueprint.mission === 'gem-runner') return final.run.gemsCollected >= blueprint.missionParameters.gemTarget
  if (blueprint.mission === 'chest-hunter') return final.run.chestsOpened >= blueprint.missionParameters.chestTarget
  return final.puzzle.objectiveReached && final.puzzle.hasTempleKey && final.puzzle.gateState === 'OPEN'
}

describe('Room 01 bootstrap template prevalidation', () => {
  it('pins each built-in template canonical hash to the checked-in expected hash', () => {
    for (const mission of ROOM_01_BOOTSTRAP_MISSIONS) {
      const template = createBootstrapBlueprint(ROOM_01_BOOTSTRAP_TEMPLATE_DAY_KEY, mission)
      const daily = createBootstrapBlueprint('2026-09-11', mission)

      expect(template.blueprintHash).toBe(PREVALIDATED_ROOM_01_BOOTSTRAP_TEMPLATE_HASHES[mission])
      expect(hashRoom01BootstrapTemplate(template)).toBe(PREVALIDATED_ROOM_01_BOOTSTRAP_TEMPLATE_HASHES[mission])
      expect(hashRoom01BootstrapTemplate(daily)).toBe(PREVALIDATED_ROOM_01_BOOTSTRAP_TEMPLATE_HASHES[mission])
      expect(daily.blueprintHash).not.toBe(PREVALIDATED_ROOM_01_BOOTSTRAP_TEMPLATE_HASHES[mission])
      expect(isPrevalidatedRoom01Bootstrap(template)).toBe(true)
      expect(isPrevalidatedRoom01Bootstrap(daily)).toBe(true)
    }
  })

  it('proves each static template is solvable and replays the stored winning sequence', { timeout: 90_000 }, () => {
    for (const mission of ROOM_01_BOOTSTRAP_MISSIONS) {
      const blueprint = createBootstrapBlueprint(ROOM_01_BOOTSTRAP_TEMPLATE_DAY_KEY, mission)
      const result = validateExpeditionBlueprint(blueprint)
      const stored = decodeRoom01BootstrapWinningSequence(PREVALIDATED_ROOM_01_BOOTSTRAP_WINNING_SEQUENCES[mission])

      expect(result.valid).toBe(true)
      if (!result.valid) continue
      expect(encodeSequence(result.winningSequence)).toBe(PREVALIDATED_ROOM_01_BOOTSTRAP_WINNING_SEQUENCES[mission])
      expect(isLiveWin(blueprint, result.winningSequence)).toBe(true)
      expect(isLiveWin(blueprint, stored)).toBe(true)
    }
  })

  it('disables the prevalidated fast path when any blueprint-owned field changes', () => {
    const source = createBootstrapBlueprint('2026-09-11', 'gem-runner')
    const mutations: Array<Partial<ExpeditionBlueprint>> = [
      { spawn: { x: source.spawn.x + 1, y: source.spawn.y } },
      { gems: source.gems.map((gem, index) => index === 0 ? { ...gem, id: `${gem.id}-changed` } : gem) },
      { chests: source.chests.map((chest, index) => index === 0 ? { ...chest, loot: 'EMPTY' } : chest) },
      { sword: source.sword ? { x: source.sword.x, y: source.sword.y + 1 } : source.sword },
      { potion: source.potion ? { x: source.potion.x + 1, y: source.potion.y } : source.potion },
      { hazards: source.hazards.map((hazard, index) => index === 0 ? { ...hazard, type: 'POISON' } : hazard) },
      { boulders: source.boulders.map((boulder, index) => index === 0 ? { ...boulder, x: boulder.x + 1 } : boulder) },
      { key: { x: source.key.x + 1, y: source.key.y } },
      { gate: { x: source.gate.x, y: source.gate.y + 1 } },
      { objective: { x: source.objective.x, y: source.objective.y + 1 } },
      { missionParameters: { ...source.missionParameters, gemTarget: source.missionParameters.gemTarget + 1 } },
      { goblins: source.goblins.map(goblin => ({ ...goblin, patrolRoute: goblin.patrolRoute.slice(0, 1) })) },
      { timedHazards: [{ id: 'future-1', x: 4, y: 3, type: 'COLLAPSING_BOULDER', trigger: 'TURN', delay: 2 }] },
      { rulesVersion: 'nimhunt-rules-v1-changed' as ExpeditionBlueprint['rulesVersion'] },
    ]

    for (const changes of mutations) {
      const mutated = rehash(source, changes)
      expect(hashRoom01BootstrapTemplate(mutated)).not.toBe(PREVALIDATED_ROOM_01_BOOTSTRAP_TEMPLATE_HASHES['gem-runner'])
      expect(isPrevalidatedRoom01Bootstrap(mutated)).toBe(false)
    }

    const identityOnly = rehash(source, {
      dayKey: '2099-12-31',
      blueprintId: 'not-bootstrap',
      status: 'DRAFT',
    })
    expect(hashRoom01BootstrapTemplate(identityOnly)).toBe(PREVALIDATED_ROOM_01_BOOTSTRAP_TEMPLATE_HASHES['gem-runner'])
    expect(isPrevalidatedRoom01Bootstrap(identityOnly)).toBe(true)
  })

  it('does not treat mission name alone as prevalidated', () => {
    const source = createBootstrapBlueprint('2026-09-11', 'chest-hunter')
    const mutated = rehash(source, {
      gems: source.gems.map((gem, index) => index === 0 ? { ...gem, id: `${gem.id}-not-template` } : gem),
    })

    expect(mutated.mission).toBe('chest-hunter')
    expect(isPrevalidatedRoom01Bootstrap(source)).toBe(true)
    expect(isPrevalidatedRoom01Bootstrap(mutated)).toBe(false)
  })

  it('publishes a modified static-looking blueprint only after full validation', () => {
    const source = rehash(createPublishedBootstrapBlueprint('2099-04-01', 'gem-runner'), {
      gems: createBootstrapBlueprint('2099-04-01', 'gem-runner').gems.map((gem, index) => (
        index === 0 ? { ...gem, id: `${gem.id}-modified` } : gem
      )),
    })
    const published = { ...source, status: 'PUBLISHED' as const }
    expect(isPrevalidatedRoom01Bootstrap(published)).toBe(false)

    const before = publicationValidationStats()
    const service = createMemoryProofService({ blueprints: [published] })
    const after = publicationValidationStats()

    expect(after.runs - before.runs).toBe(1)
    expect(after.prevalidatedHits - before.prevalidatedHits).toBe(0)
    expect(service.getPublishedBlueprint('2099-04-01', 'gem-runner')?.blueprintHash).toBe(published.blueprintHash)
  })

  it('rejects an invalid dynamic blueprint and does not use the prevalidated path', () => {
    const source = createBootstrapBlueprint('2099-04-02', 'gem-runner')
    const unsolvable = rehash(source, { gems: [], chests: [] })
    const published = { ...unsolvable, status: 'PUBLISHED' as const }
    expect(isPrevalidatedRoom01Bootstrap(published)).toBe(false)

    const before = publicationValidationStats()
    expect(() => createMemoryProofService({ blueprints: [published] })).toThrow('BLUEPRINT_INVALID')
    const after = publicationValidationStats()

    expect(after.runs - before.runs).toBe(1)
    expect(after.prevalidatedHits - before.prevalidatedHits).toBe(0)
  })
})
