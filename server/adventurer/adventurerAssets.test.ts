import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  ADVENTURER_APPROVED_ART_ASSETS,
  ADVENTURER_AVATAR_ART_MISSING_IDS,
  ADVENTURER_LEGACY_ART_ASSETS,
  REAL_EXPEDITION_PROFILE_GATE_ENABLED,
} from '../../src/components/play/adventurerAssets.ts'

describe('approved Adventurer avatar art', () => {
  it('maps every final catalogue ID to a checked-in public asset', () => {
    expect(Object.keys(ADVENTURER_APPROVED_ART_ASSETS)).toHaveLength(20)
    expect(ADVENTURER_AVATAR_ART_MISSING_IDS).toEqual([])
    for (const assetPath of Object.values(ADVENTURER_APPROVED_ART_ASSETS)) {
      expect(existsSync(join(process.cwd(), 'public', assetPath.slice(1)))).toBe(true)
    }
  })

  it('keeps legacy P1 IDs renderable without making them selectable', () => {
    expect(Object.keys(ADVENTURER_LEGACY_ART_ASSETS)).toHaveLength(12)
    expect(Object.values(ADVENTURER_LEGACY_ART_ASSETS).every(Boolean)).toBe(true)
    expect(REAL_EXPEDITION_PROFILE_GATE_ENABLED).toBe(true)
  })
})
