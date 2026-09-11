import { describe, expect, it } from 'vitest'
import { createInitialRun } from './replay/engine.ts'
import { createRoom01Blueprint } from './world/room01.ts'
import { mapProductBlueprint, mapProductInitialState } from './productBlueprint.ts'

function blueprint() {
  const source = createRoom01Blueprint('2026-09-09', 'gem-runner', 'product-blueprint')
  return { ...source, status: 'PUBLISHED' as const, blueprintHash: 'a'.repeat(64) }
}

describe('product blueprint handoff', () => {
  it('maps every product-owned placement without falling back to local constants', () => {
    const source = blueprint()
    const changed = {
      ...source,
      spawn: { x: 2, y: 3 },
      gems: [{ id: 'server-gem', x: 2, y: 2 }],
      chests: [{ id: 'server-chest', x: 6, y: 3, loot: 'EMPTY' as const }],
      sword: null,
      potion: { x: 1, y: 1 },
      key: { x: 2, y: 6 },
      gate: { x: 7, y: 3 },
      objective: { x: 10, y: 3 },
      missionParameters: { gemTarget: 1, chestTarget: 1 },
      goblins: [{ id: 'server-goblin', spawn: { x: 6, y: 4 }, patrolRoute: [{ x: 6, y: 4 }, { x: 6, y: 5 }] }],
      hazards: [{ x: 4, y: 4, type: 'POISON' as const }],
      boulders: [{ id: 'server-boulder', x: 4, y: 5 }],
    }

    const runtime = mapProductBlueprint(changed)

    expect(runtime.spawn).toEqual({ x: 2, y: 3 })
    expect(runtime.contents).toMatchObject({
      gems: [{ id: 'server-gem', x: 2, y: 2 }],
      hazards: [{ x: 4, y: 4, type: 'POISON' }],
    })
    expect(runtime.chests).toEqual([{ id: 'server-chest', x: 6, y: 3, loot: 'EMPTY' }])
    expect(runtime.sword).toBeNull()
    expect(runtime.potion).toEqual({ x: 1, y: 1 })
    expect(runtime.puzzle).toMatchObject({
      boulders: [{ id: 'server-boulder', x: 4, y: 5 }],
      key: { x: 2, y: 6 },
      gate: { x: 7, y: 3 },
      shrine: { x: 10, y: 3 },
    })
    expect(runtime.goblin).toMatchObject({ spawn: { x: 6, y: 4 }, patrolRoute: [{ x: 6, y: 4 }, { x: 6, y: 5 }] })
    expect(runtime.gemTarget).toBe(1)
    expect(runtime.chestTarget).toBe(1)
  })

  it('maps the trusted initial replay state without reconstructing it', () => {
    const source = blueprint()
    const replay = createInitialRun({
      mission: source.mission,
      rulesVersion: source.rulesVersion,
      roomVersion: source.roomVersion,
      blueprint: source,
    })
    const changed = {
      ...replay,
      player: { x: 2, y: 3 },
      run: { ...replay.run, hp: 75 },
      items: { ...replay.items, swordPickedUp: true },
      puzzle: { ...replay.puzzle, hasTempleKey: true },
    }

    expect(mapProductInitialState(changed)).toMatchObject({
      player: { x: 2, y: 3 },
      run: { hp: 75 },
      items: { swordPickedUp: true },
      puzzle: { hasTempleKey: true },
    })
  })
})
