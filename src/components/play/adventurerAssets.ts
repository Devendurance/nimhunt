import { ADVENTURER_AVATAR_CATALOGUE } from '../../domain/adventurer.ts'

/**
 * P2 deliberately does not invent portrait art. Add approved local imports here
 * when the curated NimHunt avatar pack is delivered, keeping IDs stable.
 */
export const ADVENTURER_APPROVED_ART_ASSETS: Readonly<Partial<Record<string, string>>> = {}

export const ADVENTURER_AVATAR_ART_MISSING_IDS = ADVENTURER_AVATAR_CATALOGUE
  .filter(avatar => !ADVENTURER_APPROVED_ART_ASSETS[avatar.avatarId])
  .map(avatar => avatar.avatarId)

// The real-expedition gate stays disabled until every starter ID has approved art.
export const REAL_EXPEDITION_PROFILE_GATE_ENABLED = ADVENTURER_AVATAR_ART_MISSING_IDS.length === 0
