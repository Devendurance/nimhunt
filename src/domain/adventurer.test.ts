import { describe, expect, it } from 'vitest'
import {
  ADVENTURER_AVATAR_CATALOGUE,
  ADVENTURER_LEGACY_AVATAR_COMPATIBILITY,
  isLegacyAdventurerAvatar,
  isStarterAdventurerAvatar,
} from './adventurer.ts'

describe('final Adventurer avatar catalogue', () => {
  it('contains the 20 approved IDs with the required rarity counts', () => {
    expect(ADVENTURER_AVATAR_CATALOGUE).toHaveLength(20)
    expect(ADVENTURER_AVATAR_CATALOGUE.map(avatar => avatar.avatarId)).toEqual([
      'common-01', 'common-02', 'common-03', 'common-04', 'common-05',
      'uncommon-01', 'uncommon-02', 'uncommon-03', 'uncommon-04', 'uncommon-05',
      'rare-01', 'rare-02', 'rare-03',
      'legendary-01', 'legendary-02', 'legendary-03',
      'mythic-01', 'mythic-02', 'mythic-03', 'mythic-04',
    ])
    expect(ADVENTURER_AVATAR_CATALOGUE.filter(avatar => avatar.rarity === 'COMMON')).toHaveLength(5)
    expect(ADVENTURER_AVATAR_CATALOGUE.filter(avatar => avatar.rarity === 'UNCOMMON')).toHaveLength(5)
    expect(ADVENTURER_AVATAR_CATALOGUE.filter(avatar => avatar.rarity === 'RARE')).toHaveLength(3)
    expect(ADVENTURER_AVATAR_CATALOGUE.filter(avatar => avatar.rarity === 'LEGENDARY')).toHaveLength(3)
    expect(ADVENTURER_AVATAR_CATALOGUE.filter(avatar => avatar.rarity === 'MYTHIC')).toHaveLength(4)
  })

  it('makes only Common avatars starter-selectable and retains P1 IDs as compatibility data', () => {
    expect(ADVENTURER_AVATAR_CATALOGUE.filter(avatar => avatar.starter).map(avatar => avatar.avatarId)).toEqual([
      'common-01', 'common-02', 'common-03', 'common-04', 'common-05',
    ])
    expect(ADVENTURER_AVATAR_CATALOGUE.filter(avatar => !avatar.starter)).toHaveLength(15)
    expect(ADVENTURER_AVATAR_CATALOGUE.every(avatar => avatar.active)).toBe(true)
    expect(ADVENTURER_LEGACY_AVATAR_COMPATIBILITY).toHaveLength(12)
    expect(isStarterAdventurerAvatar('common-01')).toBe(true)
    expect(isStarterAdventurerAvatar('uncommon-01')).toBe(false)
    expect(isLegacyAdventurerAvatar('adventurer-01')).toBe(true)
  })
})
