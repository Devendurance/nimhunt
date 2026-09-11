import { KeyPair } from '@nimiq/core'
import { describe, expect, it } from 'vitest'
import { hashBlueprint } from '../../src/game/replay/canonical.ts'
import { createRoom01Blueprint } from '../../src/game/world/room01.ts'
import { createPublishedBootstrapBlueprints } from './blueprintBootstrap.ts'
import { createMemoryProofService, publicationValidationStats } from './memoryProofStore.ts'
import { isPrevalidatedRoom01Bootstrap } from './room01BootstrapPrevalidation.ts'

function clock(start = '2026-09-09T12:00:00.000Z') {
  let current = new Date(start)
  return {
    now: () => current,
    set(value: string) {
      current = new Date(value)
    },
  }
}

function blueprint(dayKey: string, mission: 'gem-runner' | 'chest-hunter' | 'vault-breaker' = 'gem-runner', id = `blueprint-${mission}`) {
  const source = createRoom01Blueprint(dayKey, mission, id)
  return { ...source, blueprintHash: hashBlueprint(source) }
}

function publishedDynamicGemRunner(dayKey: string, id: string) {
  const source = createRoom01Blueprint(dayKey, 'gem-runner', id)
  const firstGem = source.gems[0]
  const mutatedSource = {
    ...source,
    gems: firstGem
      ? [{ ...firstGem, id: `${firstGem.id}-dynamic` }, ...source.gems.slice(1)]
      : source.gems,
  }
  return { ...mutatedSource, blueprintHash: hashBlueprint(mutatedSource), status: 'PUBLISHED' as const }
}

describe('durable blueprint publication', () => {
  it('keeps published authoritative content immutable', () => {
    const source = blueprint('2026-09-09')
    const service = createMemoryProofService({ clock: clock(), blueprints: [{ ...source, status: 'PUBLISHED' }] })
    const stored = service.getPublishedBlueprint('2026-09-09', 'gem-runner')
    expect(stored?.status).toBe('PUBLISHED')

    expect(() => service.registerBlueprint({ ...stored!, blueprintHash: 'b'.repeat(64) })).toThrow('BLUEPRINT_IMMUTABLE')
    expect(service.getPublishedBlueprint('2026-09-09', 'gem-runner')?.blueprintHash).toBe(stored?.blueprintHash)
  })

  it('allows only one active published blueprint per day and mission', () => {
    const firstClock = clock()
    const first = blueprint('2026-09-09', 'gem-runner', 'blueprint-first')
    const secondSource = createRoom01Blueprint('2026-09-09', 'gem-runner', 'blueprint-second')
    const second = { ...secondSource, blueprintHash: hashBlueprint(secondSource) }
    const service = createMemoryProofService({ clock: firstClock })

    service.registerBlueprint(first)
    service.registerBlueprint(second)
    service.publishBlueprint(first.blueprintId)
    expect(() => service.publishBlueprint(second.blueprintId)).toThrow('BLUEPRINT_ALREADY_PUBLISHED')
    service.retireBlueprint(first.blueprintId)
    service.publishBlueprint(second.blueprintId)

    expect(service.getPublishedBlueprint('2026-09-09', 'gem-runner')?.blueprintId).toBe(second.blueprintId)
  })

  it('fails closed when the requested daily mission blueprint is missing', async () => {
    const service = createMemoryProofService({ clock: clock() })
    const wallet = KeyPair.generate().toAddress().toUserFriendlyAddress()

    await expect(service.issueStartChallenge(wallet, 'gem-runner')).rejects.toMatchObject({
      code: 'DAILY_BLUEPRINT_UNAVAILABLE',
    })
  })

  it('skips solvability search for exact prevalidated Room 01 bootstrap templates', () => {
    const before = publicationValidationStats()
    createMemoryProofService({
      clock: clock(),
      blueprints: createPublishedBootstrapBlueprints('2099-01-02'),
    })
    const after = publicationValidationStats()

    expect(after.runs - before.runs).toBe(0)
    expect(after.prevalidatedHits - before.prevalidatedHits).toBe(3)
  })

  it('reuses solvability validation for an identical non-template blueprint hash', () => {
    const source = publishedDynamicGemRunner('2099-03-05', 'cache-a')
    expect(isPrevalidatedRoom01Bootstrap(source)).toBe(false)
    const before = publicationValidationStats()
    createMemoryProofService({ clock: clock(), blueprints: [source] })
    const mid = publicationValidationStats()
    createMemoryProofService({ clock: clock(), blueprints: [source] })
    const after = publicationValidationStats()

    expect(mid.runs - before.runs).toBe(1)
    expect(mid.prevalidatedHits - before.prevalidatedHits).toBe(0)
    expect(after.runs - mid.runs).toBe(0)
    expect(after.cacheHits - mid.cacheHits).toBe(1)
  })

  it('runs full validation when a Room 01-looking blueprint hash does not match', () => {
    const source = publishedDynamicGemRunner('2099-01-03', 'lookalike')
    expect(isPrevalidatedRoom01Bootstrap(source)).toBe(false)
    const before = publicationValidationStats()
    createMemoryProofService({ clock: clock(), blueprints: [source] })
    const after = publicationValidationStats()

    expect(after.runs - before.runs).toBe(1)
    expect(after.prevalidatedHits - before.prevalidatedHits).toBe(0)
    expect(createMemoryProofService({ clock: clock(), blueprints: [source] }).getPublishedBlueprint('2099-01-03', 'gem-runner')?.blueprintId).toBe('lookalike')
  })

  it('rejects unvalidated or invalid dynamic blueprints at publication', () => {
    const hashedWrong = { ...blueprint('2099-03-06'), status: 'PUBLISHED' as const, blueprintHash: 'aa'.repeat(32) }
    expect(() => createMemoryProofService({ clock: clock(), blueprints: [hashedWrong] })).toThrow('BLUEPRINT_INVALID')

    const emptySource = createRoom01Blueprint('2099-03-07', 'gem-runner', 'unsolvable')
    const unsolvableSource = { ...emptySource, gems: [], chests: [] }
    const unsolvable = {
      ...unsolvableSource,
      blueprintHash: hashBlueprint(unsolvableSource),
      status: 'PUBLISHED' as const,
    }
    expect(() => createMemoryProofService({ clock: clock(), blueprints: [unsolvable] })).toThrow('BLUEPRINT_INVALID')

    const extraGoblinSource = blueprint('2099-03-08')
    const goblin = extraGoblinSource.goblins[0]
    expect(goblin).toBeDefined()
    const mutatedSource = { ...extraGoblinSource, goblins: [...extraGoblinSource.goblins, goblin!] }
    const mutated = { ...mutatedSource, blueprintHash: hashBlueprint(mutatedSource), status: 'PUBLISHED' as const }
    expect(() => createMemoryProofService({ clock: clock(), blueprints: [mutated] })).toThrow('BLUEPRINT_INVALID')
  })
})
