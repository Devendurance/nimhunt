// P1 Adventurer identity contracts. These types deliberately stay separate from
// wallet-authoritative expedition, claim, and payout contracts.

export const ADVENTURER_CREATE_CHALLENGE_PATH = '/api/adventurer/profile/challenge' as const
export const ADVENTURER_CREATE_PATH = '/api/adventurer/profile' as const
export const ADVENTURER_SESSION_CHALLENGE_PATH = '/api/adventurer/session/challenge' as const
export const ADVENTURER_SESSION_PATH = '/api/adventurer/session' as const
export const ADVENTURER_ME_PATH = '/api/adventurer/me' as const
export const ADVENTURER_PUBLIC_PATH = '/api/adventurer/public' as const
export const ADVENTURER_NAME_AVAILABILITY_PATH = '/api/adventurer/name-availability' as const

export const NIMHUNT_CREATE_ADVENTURER_V1 = 'NIMHUNT_CREATE_ADVENTURER_V1' as const
export const NIMHUNT_ADVENTURER_SESSION_V1 = 'NIMHUNT_ADVENTURER_SESSION_V1' as const
export const NIMHUNT_RENAME_ADVENTURER_V1 = 'NIMHUNT_RENAME_ADVENTURER_V1' as const

export const DISPLAY_NAME_MIN_LENGTH = 3
export const DISPLAY_NAME_MAX_LENGTH = 20
export const ADVENTURER_RENAME_COOLDOWN_SECONDS = 30 * 24 * 60 * 60
export const ADVENTURER_SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60
export const ADVENTURER_SESSION_COOKIE = 'nimhunt_adventurer_session' as const

export const ADVENTURER_ERROR_CODES = [
  'PROFILE_NOT_FOUND',
  'PROFILE_ALREADY_EXISTS',
  'DISPLAY_NAME_INVALID',
  'DISPLAY_NAME_TAKEN',
  'DISPLAY_NAME_RESERVED',
  'DISPLAY_NAME_COOLDOWN',
  'AVATAR_UNAVAILABLE',
  'ADVENTURER_SESSION_INVALID',
  'CHALLENGE_INVALID',
  'CHALLENGE_EXPIRED',
  'SIGNATURE_INVALID',
] as const
export type AdventurerErrorCode = (typeof ADVENTURER_ERROR_CODES)[number]

export type AdventurerAvatar = {
  readonly avatarId: string
  readonly starter: boolean
  readonly active: boolean
  readonly sortOrder: number
}

// Catalogue IDs are durable backend contracts. Artwork is intentionally not
// fabricated here; P2 can bind curated image assets to these IDs.
export const ADVENTURER_AVATAR_CATALOGUE: readonly AdventurerAvatar[] = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
].map(sortOrder => ({
  avatarId: `adventurer-${String(sortOrder).padStart(2, '0')}`,
  starter: true,
  active: true,
  sortOrder,
}))

export type AdventurerStats = {
  readonly lifetimeGems: number
  readonly expeditionsCompleted: number
  readonly bestStreak: number
}

export type AdventurerProfile = {
  readonly playerId: string
  readonly displayName: string
  readonly avatarId: string
  readonly displayNameChangedAt: string
  readonly createdAt: string
  readonly updatedAt: string
  readonly stats: AdventurerStats
}

export type PublicAdventurerProfile = {
  readonly playerId: string
  readonly displayName: string
  readonly avatarId: string
  readonly lifetimeGems: number
  readonly expeditionsCompleted: number
  readonly bestStreak: number
}

export type AdventurerSession = {
  readonly playerId: string
  readonly createdAt: string
  readonly expiresAt: string
}

export type AdventurerChallengePurpose = 'CREATE' | 'SESSION'

export type AdventurerChallenge = {
  readonly purpose: AdventurerChallengePurpose
  readonly challenge: string
  readonly issuedAt: string
  readonly expiresAt: string
}

export type NameAvailability = {
  readonly available: boolean
  readonly normalizedName: string | null
  readonly error: Extract<AdventurerErrorCode, 'DISPLAY_NAME_INVALID' | 'DISPLAY_NAME_TAKEN' | 'DISPLAY_NAME_RESERVED'> | null
}

export type CreateAdventurerPayload = {
  readonly version: typeof NIMHUNT_CREATE_ADVENTURER_V1
  readonly type: 'CREATE_ADVENTURER'
  readonly wallet: string
  readonly displayName: string
  readonly avatarId: string
  readonly challenge: string
  readonly issuedAt: string
  readonly expiresAt: string
}

export type AdventurerSessionPayload = {
  readonly version: typeof NIMHUNT_ADVENTURER_SESSION_V1
  readonly type: 'ADVENTURER_SESSION'
  readonly wallet: string
  readonly challenge: string
  readonly issuedAt: string
  readonly expiresAt: string
}

export type RenameAdventurerPayload = {
  readonly version: typeof NIMHUNT_RENAME_ADVENTURER_V1
  readonly type: 'RENAME_ADVENTURER'
  readonly playerId: string
  readonly currentName: string
  readonly newName: string
  readonly challenge: string
  readonly issuedAt: string
  readonly expiresAt: string
}

export function serializeCreateAdventurerPayload(payload: CreateAdventurerPayload): string {
  return JSON.stringify({
    version: payload.version,
    type: payload.type,
    wallet: payload.wallet,
    displayName: payload.displayName,
    avatarId: payload.avatarId,
    challenge: payload.challenge,
    issuedAt: payload.issuedAt,
    expiresAt: payload.expiresAt,
  }, null, 2)
}

export function serializeAdventurerSessionPayload(payload: AdventurerSessionPayload): string {
  return JSON.stringify({
    version: payload.version,
    type: payload.type,
    wallet: payload.wallet,
    challenge: payload.challenge,
    issuedAt: payload.issuedAt,
    expiresAt: payload.expiresAt,
  }, null, 2)
}

export function serializeRenameAdventurerPayload(payload: RenameAdventurerPayload): string {
  return JSON.stringify({
    version: payload.version,
    type: payload.type,
    playerId: payload.playerId,
    currentName: payload.currentName,
    newName: payload.newName,
    challenge: payload.challenge,
    issuedAt: payload.issuedAt,
    expiresAt: payload.expiresAt,
  }, null, 2)
}

export function normalizeAdventurerDisplayName(value: string): string {
  return value.trim().toLocaleLowerCase('en-US')
}

export function parseAdventurerStats(value: unknown): AdventurerStats | null {
  if (!isRecord(value) || !hasExactKeys(value, ['lifetimeGems', 'expeditionsCompleted', 'bestStreak'])) return null
  if (!isNonNegativeInteger(value.lifetimeGems) || !isNonNegativeInteger(value.expeditionsCompleted) || !isNonNegativeInteger(value.bestStreak)) return null
  return {
    lifetimeGems: value.lifetimeGems,
    expeditionsCompleted: value.expeditionsCompleted,
    bestStreak: value.bestStreak,
  }
}

export function parseAdventurerProfile(value: unknown): AdventurerProfile | null {
  if (!isRecord(value) || !hasExactKeys(value, ['playerId', 'displayName', 'avatarId', 'displayNameChangedAt', 'createdAt', 'updatedAt', 'stats'])) return null
  if (!isNonEmptyString(value.playerId) || !isNonEmptyString(value.displayName) || !isNonEmptyString(value.avatarId)) return null
  if (!isIsoString(value.displayNameChangedAt) || !isIsoString(value.createdAt) || !isIsoString(value.updatedAt)) return null
  const stats = parseAdventurerStats(value.stats)
  if (!stats) return null
  return {
    playerId: value.playerId,
    displayName: value.displayName,
    avatarId: value.avatarId,
    displayNameChangedAt: value.displayNameChangedAt,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    stats,
  }
}

export function parsePublicAdventurerProfile(value: unknown): PublicAdventurerProfile | null {
  if (!isRecord(value) || !hasExactKeys(value, ['playerId', 'displayName', 'avatarId', 'lifetimeGems', 'expeditionsCompleted', 'bestStreak'])) return null
  if (!isNonEmptyString(value.playerId) || !isNonEmptyString(value.displayName) || !isNonEmptyString(value.avatarId)) return null
  if (!isNonNegativeInteger(value.lifetimeGems) || !isNonNegativeInteger(value.expeditionsCompleted) || !isNonNegativeInteger(value.bestStreak)) return null
  return {
    playerId: value.playerId,
    displayName: value.displayName,
    avatarId: value.avatarId,
    lifetimeGems: value.lifetimeGems,
    expeditionsCompleted: value.expeditionsCompleted,
    bestStreak: value.bestStreak,
  }
}

export function parseAdventurerSession(value: unknown): AdventurerSession | null {
  if (!isRecord(value) || !hasExactKeys(value, ['playerId', 'createdAt', 'expiresAt'])) return null
  if (!isNonEmptyString(value.playerId) || !isIsoString(value.createdAt) || !isIsoString(value.expiresAt)) return null
  return { playerId: value.playerId, createdAt: value.createdAt, expiresAt: value.expiresAt }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value)
  return keys.length === expected.length && expected.every(key => keys.includes(key))
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function isIsoString(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value
}
