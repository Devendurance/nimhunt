import {
  DISPLAY_NAME_MAX_LENGTH,
  DISPLAY_NAME_MIN_LENGTH,
  normalizeAdventurerDisplayName,
  type AdventurerErrorCode,
} from '../../src/domain/adventurer.js'

const RESERVED_NAMES = new Set([
  'nimhunt',
  'nimiq',
  'admin',
  'administrator',
  'moderator',
  'treasury',
  'support',
  'official',
  'system',
])

// Deliberately small and server-owned. This is an abuse floor, not a promise
// of complete moderation coverage.
const ABUSE_FRAGMENTS = [
  'fuck',
  'shit',
  'bitch',
  'cunt',
  'asshole',
  'nigger',
  'faggot',
] as const

export type ValidatedDisplayName = {
  readonly displayName: string
  readonly normalizedName: string
}

export function validateDisplayName(value: unknown):
  | { readonly ok: true; readonly value: ValidatedDisplayName }
  | { readonly ok: false; readonly error: Extract<AdventurerErrorCode, 'DISPLAY_NAME_INVALID' | 'DISPLAY_NAME_RESERVED'> } {
  if (typeof value !== 'string') return invalidName()
  const trimmed = value.trim()
  // Input is trimmed before validation, but silently changing the signed name
  // would make the user sign a different identity than the server stores.
  if (trimmed !== value) return invalidName()
  if (trimmed.length < DISPLAY_NAME_MIN_LENGTH || trimmed.length > DISPLAY_NAME_MAX_LENGTH) return invalidName()
  if (!/^[A-Za-z0-9_]+(?: [A-Za-z0-9_]+)*$/.test(trimmed)) return invalidName()

  const normalizedName = normalizeAdventurerDisplayName(trimmed)
  if (RESERVED_NAMES.has(normalizedName)) return { ok: false, error: 'DISPLAY_NAME_RESERVED' }
  const compact = normalizedName.replace(/ /g, '')
  if (ABUSE_FRAGMENTS.some(fragment => compact.includes(fragment))) return invalidName()
  return { ok: true, value: { displayName: trimmed, normalizedName } }
}

export function isReservedDisplayName(value: string): boolean {
  return RESERVED_NAMES.has(normalizeAdventurerDisplayName(value))
}

function invalidName(): { readonly ok: false; readonly error: 'DISPLAY_NAME_INVALID' } {
  return { ok: false, error: 'DISPLAY_NAME_INVALID' }
}
