import {
  ADVENTURER_AVATAR_CATALOGUE,
  ADVENTURER_LEGACY_AVATAR_COMPATIBILITY,
} from '../../domain/adventurer.ts'

export const ADVENTURER_APPROVED_ART_ASSETS = {
  'common-01': '/assets/adventurers/common/common-01.png',
  'common-02': '/assets/adventurers/common/common-02.png',
  'common-03': '/assets/adventurers/common/common-03.png',
  'common-04': '/assets/adventurers/common/common-04.png',
  'common-05': '/assets/adventurers/common/common-05.png',
  'uncommon-01': '/assets/adventurers/uncommon/uncommon-01.png',
  'uncommon-02': '/assets/adventurers/uncommon/uncommon-02.png',
  'uncommon-03': '/assets/adventurers/uncommon/uncommon-03.png',
  'uncommon-04': '/assets/adventurers/uncommon/uncommon-04.png',
  'uncommon-05': '/assets/adventurers/uncommon/uncommon-05.png',
  'rare-01': '/assets/adventurers/rare/rare-01.png',
  'rare-02': '/assets/adventurers/rare/rare-02.png',
  'rare-03': '/assets/adventurers/rare/rare-03.png',
  'legendary-01': '/assets/adventurers/legendary/legendary-01.png',
  'legendary-02': '/assets/adventurers/legendary/legendary-02.png',
  'legendary-03': '/assets/adventurers/legendary/legendary-03.png',
  'mythic-01': '/assets/adventurers/mythic/mythic-01.png',
  'mythic-02': '/assets/adventurers/mythic/mythic-02.png',
  'mythic-03': '/assets/adventurers/mythic/mythic-03.png',
  'mythic-04': '/assets/adventurers/mythic/mythic-04.png',
} as const

// Profiles created during P1 can still contain temporary IDs. They render
// against approved final art until the owner chooses a current starter avatar.
export const ADVENTURER_LEGACY_ART_ASSETS: Readonly<Record<string, string>> = Object.fromEntries(
  ADVENTURER_LEGACY_AVATAR_COMPATIBILITY.map((avatar, index) => {
    const finalAvatar = ADVENTURER_AVATAR_CATALOGUE[index % 5]
    return [avatar.avatarId, ADVENTURER_APPROVED_ART_ASSETS[finalAvatar.avatarId as keyof typeof ADVENTURER_APPROVED_ART_ASSETS]]
  }),
)

export function getAdventurerAvatarArt(avatarId: string): string | null {
  return ADVENTURER_APPROVED_ART_ASSETS[avatarId as keyof typeof ADVENTURER_APPROVED_ART_ASSETS]
    ?? ADVENTURER_LEGACY_ART_ASSETS[avatarId]
    ?? null
}

export const ADVENTURER_AVATAR_ART_MISSING_IDS = ADVENTURER_AVATAR_CATALOGUE
  .filter(avatar => !getAdventurerAvatarArt(avatar.avatarId))
  .map(avatar => avatar.avatarId)

export const REAL_EXPEDITION_PROFILE_GATE_ENABLED = ADVENTURER_AVATAR_ART_MISSING_IDS.length === 0
