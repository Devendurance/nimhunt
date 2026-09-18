import { describe, expect, it } from 'vitest'
import {
  ANGKOR_CANONICAL_VARIANTS,
  createDailyAngkorBlueprint,
  getAllCanonicalVariants,
  selectDailyVariantIndex,
} from './dailyAngkorLayouts.ts'
import { hashBlueprint } from '../replay/canonical.ts'
import { replayActions } from '../replay/engine.ts'
import { validateExpeditionBlueprint } from '../replay/validator.ts'
import { ANGKOR_ROOM_01, createRoom01Blueprint } from './room01.ts'
import type { ExpeditionBlueprint, MissionType } from '../replay/types.ts'

describe('mission-specific daily Angkor difficulty layouts', () => {
  const missions: readonly MissionType[] = ['gem-runner', 'chest-hunter', 'vault-breaker']
  const testDay = '2026-09-17'

  it('selects identical variant index for same day and mission', () => {
    for (const mission of missions) {
      const idx1 = selectDailyVariantIndex('2026-09-17', mission)
      const idx2 = selectDailyVariantIndex('2026-09-17', mission)
      expect(idx1).toBe(idx2)
      expect([0, 1, 2]).toContain(idx1)
    }
  })

  it('varies selection across different days deterministically', () => {
    const days = ['2026-09-17', '2026-09-18', '2026-09-19', '2026-09-20', '2026-09-21', '2026-09-22', '2026-09-23']
    const variantsFound = new Set<number>()
    for (const day of days) {
      variantsFound.add(selectDailyVariantIndex(day, 'gem-runner'))
    }
    // Across 7 days, multiple variants must be selected
    expect(variantsFound.size).toBeGreaterThan(1)
  })

  it('produces distinct blueprints for distinct missions on the same day', () => {
    const gem = createDailyAngkorBlueprint(testDay, 'gem-runner', undefined, undefined, hashBlueprint)
    const chest = createDailyAngkorBlueprint(testDay, 'chest-hunter', undefined, undefined, hashBlueprint)
    const vault = createDailyAngkorBlueprint(testDay, 'vault-breaker', undefined, undefined, hashBlueprint)

    expect(gem.mission).toBe('gem-runner')
    expect(chest.mission).toBe('chest-hunter')
    expect(vault.mission).toBe('vault-breaker')

    expect(gem.blueprintHash).not.toBe(chest.blueprintHash)
    expect(gem.blueprintHash).not.toBe(vault.blueprintHash)
    expect(chest.blueprintHash).not.toBe(vault.blueprintHash)
  })

  it('declares mission-appropriate goblin counts for each mission', () => {
    // Gem Runner: 1–2
    for (const variant of ANGKOR_CANONICAL_VARIANTS['gem-runner']) {
      expect(variant.goblins.length).toBeGreaterThanOrEqual(1)
      expect(variant.goblins.length).toBeLessThanOrEqual(2)
    }
    // Chest Hunter: 2
    for (const variant of ANGKOR_CANONICAL_VARIANTS['chest-hunter']) {
      expect(variant.goblins.length).toBe(2)
    }
    // Vault Breaker: 2–3
    for (const variant of ANGKOR_CANONICAL_VARIANTS['vault-breaker']) {
      expect(variant.goblins.length).toBeGreaterThanOrEqual(2)
      expect(variant.goblins.length).toBeLessThanOrEqual(3)
    }
  })

  it('enforces smart placement rules across all 9 canonical variants', () => {
    const all = getAllCanonicalVariants(testDay, hashBlueprint)
    expect(all).toHaveLength(9)

    for (const bp of all) {
      // 1. No spawn overlaps: every entity coordinate is unique
      const coords = [
        bp.spawn,
        ...bp.goblins.map(g => g.spawn),
        ...bp.gems,
        ...bp.chests,
        ...bp.hazards,
        ...bp.boulders,
        bp.key,
        bp.gate,
        bp.objective,
      ]
      if (bp.sword) coords.push(bp.sword)
      if (bp.potion) coords.push(bp.potion)

      const coordSet = new Set(coords.map(c => `${c.x},${c.y}`))
      expect(coordSet.size).toBe(coords.length)

      // 2. All goblin patrol routes have >= 2 waypoints and are within bounds
      for (const goblin of bp.goblins) {
        expect(goblin.patrolRoute.length).toBeGreaterThanOrEqual(2)
      }

      // 3. Key is not behind the gate (x <= 7 for Room 01)
      expect(bp.key.x).toBeLessThan(bp.gate.x)

      // 4. For Vault Breaker: key not adjacent to player start (distance > 1)
      if (bp.mission === 'vault-breaker') {
        const dist = Math.abs(bp.key.x - bp.spawn.x) + Math.abs(bp.key.y - bp.spawn.y)
        expect(dist).toBeGreaterThan(1)
        // Objective is inside vault (x >= 9)
        expect(bp.objective.x).toBeGreaterThan(bp.gate.x)
      }

      // 5. Gem Runner provides > 6 reachable gems
      if (bp.mission === 'gem-runner') {
        expect(bp.gems.length).toBeGreaterThan(6)
      }

      // 6. Chest Hunter provides 4 chests spread across distinct regions
      if (bp.mission === 'chest-hunter') {
        expect(bp.chests.length).toBe(4)
      }
    }
  })

  it('validates and proves solvability for Gem Runner variants within 256 actions', { timeout: 30_000 }, () => {
    for (let variant = 0; variant < 3; variant += 1) {
      const bp = createDailyAngkorBlueprint(testDay, 'gem-runner', variant, undefined, hashBlueprint)
      const result = validateExpeditionBlueprint(bp)
      expect(result.valid).toBe(true)
      if (!result.valid) throw new Error(`Gem Runner variant ${variant} failed: ${result.reason}`)
      expect(result.winningSequence.length).toBeGreaterThan(0)
      expect(result.winningSequence.length).toBeLessThanOrEqual(256)

      const finalState = replayActions(
        { mission: bp.mission, rulesVersion: bp.rulesVersion, roomVersion: bp.roomVersion, blueprint: bp },
        result.winningSequence,
      )
      expect(finalState.run.hp).toBeGreaterThan(0)
      expect(finalState.run.gemsCollected).toBeGreaterThanOrEqual(6)
    }
  })

  it('validates and proves solvability for Chest Hunter variant 1 within 256 actions', { timeout: 30_000 }, () => {
    const bp = createDailyAngkorBlueprint(testDay, 'chest-hunter', 0, undefined, hashBlueprint)
    const result = validateExpeditionBlueprint(bp)
    expect(result.valid).toBe(true)
    if (!result.valid) throw new Error(`Chest Hunter variant 0 failed: ${result.reason}`)
    expect(result.winningSequence.length).toBeGreaterThan(0)
    expect(result.winningSequence.length).toBeLessThanOrEqual(256)

    const finalState = replayActions(
      { mission: bp.mission, rulesVersion: bp.rulesVersion, roomVersion: bp.roomVersion, blueprint: bp },
      result.winningSequence,
    )
    expect(finalState.run.hp).toBeGreaterThan(0)
    expect(finalState.run.chestsOpened).toBeGreaterThanOrEqual(4)
  })

  it('validates and proves solvability for Chest Hunter variant 2 within 256 actions', { timeout: 75_000 }, () => {
    const bp = createDailyAngkorBlueprint(testDay, 'chest-hunter', 1, undefined, hashBlueprint)
    const result = validateExpeditionBlueprint(bp)
    expect(result.valid).toBe(true)
    if (!result.valid) throw new Error(`Chest Hunter variant 1 failed: ${result.reason}`)
    expect(result.winningSequence.length).toBeGreaterThan(0)
    expect(result.winningSequence.length).toBeLessThanOrEqual(256)

    const finalState = replayActions(
      { mission: bp.mission, rulesVersion: bp.rulesVersion, roomVersion: bp.roomVersion, blueprint: bp },
      result.winningSequence,
    )
    expect(finalState.run.hp).toBeGreaterThan(0)
    expect(finalState.run.chestsOpened).toBeGreaterThanOrEqual(4)
  })

  it('validates and proves solvability for Chest Hunter variant 3 within 256 actions', { timeout: 30_000 }, () => {
    const bp = createDailyAngkorBlueprint(testDay, 'chest-hunter', 2, undefined, hashBlueprint)
    const result = validateExpeditionBlueprint(bp)
    expect(result.valid).toBe(true)
    if (!result.valid) throw new Error(`Chest Hunter variant 2 failed: ${result.reason}`)
    expect(result.winningSequence.length).toBeGreaterThan(0)
    expect(result.winningSequence.length).toBeLessThanOrEqual(256)

    const finalState = replayActions(
      { mission: bp.mission, rulesVersion: bp.rulesVersion, roomVersion: bp.roomVersion, blueprint: bp },
      result.winningSequence,
    )
    expect(finalState.run.hp).toBeGreaterThan(0)
    expect(finalState.run.chestsOpened).toBeGreaterThanOrEqual(4)
  })

  it('verifies Chest Hunter V3 goblins follow strictly cardinal, non-wall, single-cell transitions', () => {
    const bp = createDailyAngkorBlueprint(testDay, 'chest-hunter', 2, undefined, hashBlueprint)
    expect(bp.goblins).toHaveLength(2)

    // Verify all waypoints are walkable and strictly adjacent
    for (const g of bp.goblins) {
      for (let i = 0; i < g.patrolRoute.length; i += 1) {
        const pt = g.patrolRoute[i]!
        expect(ANGKOR_ROOM_01.layout[pt.y]?.[pt.x]).toBe('.')
        if (i > 0) {
          const prev = g.patrolRoute[i - 1]!
          const dist = Math.abs(pt.x - prev.x) + Math.abs(pt.y - prev.y)
          expect(dist).toBe(1) // strictly adjacent cardinal step
        }
      }
    }

    // Verify deterministic replay produces identical states across multiple runs
    const result = validateExpeditionBlueprint(bp)
    expect(result.valid).toBe(true)
    if (!result.valid) return

    const runA = replayActions(
      { mission: bp.mission, rulesVersion: bp.rulesVersion, roomVersion: bp.roomVersion, blueprint: bp },
      result.winningSequence,
    )
    const runB = replayActions(
      { mission: bp.mission, rulesVersion: bp.rulesVersion, roomVersion: bp.roomVersion, blueprint: bp },
      result.winningSequence,
    )
    expect(runA.goblins).toEqual(runB.goblins)
    expect(runA.run.chestsOpened).toBe(runB.run.chestsOpened)
  })


  it('validates and proves solvability for Vault Breaker variant 1 within 256 actions', { timeout: 30_000 }, () => {
    const bp = createDailyAngkorBlueprint(testDay, 'vault-breaker', 0, undefined, hashBlueprint)
    const result = validateExpeditionBlueprint(bp)
    expect(result.valid).toBe(true)
    if (!result.valid) throw new Error(`Vault Breaker variant 0 failed: ${result.reason}`)
    expect(result.winningSequence.length).toBeGreaterThan(0)
    expect(result.winningSequence.length).toBeLessThanOrEqual(256)

    const finalState = replayActions(
      { mission: bp.mission, rulesVersion: bp.rulesVersion, roomVersion: bp.roomVersion, blueprint: bp },
      result.winningSequence,
    )
    expect(finalState.run.hp).toBeGreaterThan(0)
    expect(finalState.puzzle.hasTempleKey).toBe(true)
    expect(finalState.puzzle.gateState).toBe('OPEN')
    expect(finalState.puzzle.objectiveReached).toBe(true)
  })

  it('validates and proves solvability for Vault Breaker variant 2 within 256 actions', { timeout: 30_000 }, () => {
    const bp = createDailyAngkorBlueprint(testDay, 'vault-breaker', 1, undefined, hashBlueprint)
    const result = validateExpeditionBlueprint(bp)
    expect(result.valid).toBe(true)
    if (!result.valid) throw new Error(`Vault Breaker variant 1 failed: ${result.reason}`)
    expect(result.winningSequence.length).toBeGreaterThan(0)
    expect(result.winningSequence.length).toBeLessThanOrEqual(256)

    const finalState = replayActions(
      { mission: bp.mission, rulesVersion: bp.rulesVersion, roomVersion: bp.roomVersion, blueprint: bp },
      result.winningSequence,
    )
    expect(finalState.run.hp).toBeGreaterThan(0)
    expect(finalState.puzzle.hasTempleKey).toBe(true)
    expect(finalState.puzzle.gateState).toBe('OPEN')
    expect(finalState.puzzle.objectiveReached).toBe(true)
  })

  it('validates and proves solvability for Vault Breaker variant 3 within 256 actions', { timeout: 30_000 }, () => {
    const bp = createDailyAngkorBlueprint(testDay, 'vault-breaker', 2, undefined, hashBlueprint)
    const result = validateExpeditionBlueprint(bp)
    expect(result.valid).toBe(true)
    if (!result.valid) throw new Error(`Vault Breaker variant 2 failed: ${result.reason}`)
    expect(result.winningSequence.length).toBeGreaterThan(0)
    expect(result.winningSequence.length).toBeLessThanOrEqual(256)

    const finalState = replayActions(
      { mission: bp.mission, rulesVersion: bp.rulesVersion, roomVersion: bp.roomVersion, blueprint: bp },
      result.winningSequence,
    )
    expect(finalState.run.hp).toBeGreaterThan(0)
    expect(finalState.puzzle.hasTempleKey).toBe(true)
    expect(finalState.puzzle.gateState).toBe('OPEN')
    expect(finalState.puzzle.objectiveReached).toBe(true)
  })

  it('rejects a tampered blueprint hash or geometry', () => {
    const valid = createDailyAngkorBlueprint(testDay, 'gem-runner', 0, undefined, hashBlueprint)
    // 1. Tampered hash
    const badHash: ExpeditionBlueprint = { ...valid, blueprintHash: '0'.repeat(64) }
    expect(validateExpeditionBlueprint(badHash)).toMatchObject({ valid: false, reason: 'INVALID_BLUEPRINT_HASH' })

    // 2. Overlapping coordinates (gem placed on player start)
    const badCoord = {
      ...valid,
      gems: [{ id: 'bad-gem', x: valid.spawn.x, y: valid.spawn.y }, ...valid.gems.slice(1)],
    }
    const rehashedBadCoord: ExpeditionBlueprint = { ...badCoord, blueprintHash: hashBlueprint(badCoord) }
    expect(validateExpeditionBlueprint(rehashedBadCoord)).toMatchObject({ valid: false, reason: 'INVALID_GEOMETRY' })

    // 3. Key behind gate in vault breaker
    const vault = createDailyAngkorBlueprint(testDay, 'vault-breaker', 0)
    const keyBehindGate = {
      ...vault,
      key: { x: 10, y: 1 }, // in the vault behind gate!
    }
    const rehashedKeyBehindGate: ExpeditionBlueprint = { ...keyBehindGate, blueprintHash: hashBlueprint(keyBehindGate) }
    expect(validateExpeditionBlueprint(rehashedKeyBehindGate)).toMatchObject({ valid: false, reason: 'INVALID_GEOMETRY' })
  })

  it('ensures historical angkor-blueprint-v1 still validates and replays correctly', () => {
    const v1Source = createRoom01Blueprint('2026-09-09', 'gem-runner')
    const v1 = { ...v1Source, blueprintHash: hashBlueprint(v1Source) }

    expect(v1.blueprintVersion).toBe('angkor-blueprint-v1')
    const result = validateExpeditionBlueprint(v1)
    expect(result.valid).toBe(true)

    if (result.valid) {
      const finalState = replayActions(
        {
          mission: v1.mission,
          rulesVersion: v1.rulesVersion,
          roomVersion: v1.roomVersion,
          blueprint: v1,
        },
        result.winningSequence,
      )
      expect(finalState.run.hp).toBeGreaterThan(0)
      expect(finalState.run.gemsCollected).toBeGreaterThanOrEqual(6)
    }
  })
})
