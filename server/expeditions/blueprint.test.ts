import { KeyPair } from '@nimiq/core'
import { describe, expect, it } from 'vitest'
import { hashBlueprint } from '../../src/game/replay/canonical.ts'
import { createRoom01Blueprint } from '../../src/game/world/room01.ts'
import { createMemoryProofService } from './memoryProofStore.ts'

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
})
