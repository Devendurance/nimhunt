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

export type AdventurerAvatarRarity = 'COMMON' | 'UNCOMMON' | 'RARE' | 'LEGENDARY' | 'MYTHIC' | 'LEGACY'

export type AdventurerAvatar = {
  readonly avatarId: string
  readonly rarity: AdventurerAvatarRarity
  readonly starter: boolean
  readonly active: boolean
  readonly sortOrder: number
}

// The final catalogue is a stable product contract. Only Common avatars are
// starter-selectable; higher rarities are visible future content for now.
export const ADVENTURER_AVATAR_CATALOGUE: readonly AdventurerAvatar[] = [
  ...createAvatarRange('common', 'COMMON', 5, true, 1),
  ...createAvatarRange('uncommon', 'UNCOMMON', 5, false, 6),
  ...createAvatarRange('rare', 'RARE', 3, false, 11),
  ...createAvatarRange('legendary', 'LEGENDARY', 3, false, 14),
  ...createAvatarRange('mythic', 'MYTHIC', 4, false, 17),
]

// P1 used temporary IDs before the final art pack existed. They remain a
// read/display compatibility surface only; normal creation and edits accept
// starter IDs from ADVENTURER_AVATAR_CATALOGUE.
export const ADVENTURER_LEGACY_AVATAR_COMPATIBILITY: readonly AdventurerAvatar[] = Array.from({ length: 12 }, (_, index) => ({
  avatarId: `adventurer-${String(index + 1).padStart(2, '0')}`,
  rarity: 'LEGACY' as const,
  starter: false,
  active: true,
  sortOrder: 100 + index + 1,
}))

export function isStarterAdventurerAvatar(avatarId: string): boolean {
  return ADVENTURER_AVATAR_CATALOGUE.some(avatar => avatar.avatarId === avatarId && avatar.active && avatar.starter)
}

export function isLegacyAdventurerAvatar(avatarId: string): boolean {
  return ADVENTURER_LEGACY_AVATAR_COMPATIBILITY.some(avatar => avatar.avatarId === avatarId)
}

function createAvatarRange(
  prefix: string,
  rarity: Exclude<AdventurerAvatarRarity, 'LEGACY'>,
  count: number,
  starter: boolean,
  sortStart: number,
): AdventurerAvatar[] {
  return Array.from({ length: count }, (_, index) => ({
    avatarId: `${prefix}-${String(index + 1).padStart(2, '0')}`,
    rarity,
    starter,
    active: true,
    sortOrder: sortStart + index,
  }))
}

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
  /** P4 public social count; absent only for legacy internal leaderboard fixtures. */
  readonly allyCount?: number
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

export function parseAdventurerChallenge(value: unknown): AdventurerChallenge | null {
  if (!isRecord(value) || !hasExactKeys(value, ['purpose', 'challenge', 'issuedAt', 'expiresAt'])) return null
  if (value.purpose !== 'CREATE' && value.purpose !== 'SESSION') return null
  if (!isNonEmptyString(value.challenge) || !isIsoString(value.issuedAt) || !isIsoString(value.expiresAt)) return null
  if (new Date(value.expiresAt).getTime() <= new Date(value.issuedAt).getTime()) return null
  return {
    purpose: value.purpose,
    challenge: value.challenge,
    issuedAt: value.issuedAt,
    expiresAt: value.expiresAt,
  }
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
  if (!isRecord(value)) return null
  const expected = ['playerId', 'displayName', 'avatarId', 'lifetimeGems', 'expeditionsCompleted', 'bestStreak']
  const keys = Object.keys(value)
  const hasAllyCount = keys.includes('allyCount')
  if (keys.length !== expected.length + (hasAllyCount ? 1 : 0) || expected.some(key => !keys.includes(key))) return null
  if (!isNonEmptyString(value.playerId) || !isNonEmptyString(value.displayName) || !isNonEmptyString(value.avatarId)) return null
  if (!isNonNegativeInteger(value.lifetimeGems) || !isNonNegativeInteger(value.expeditionsCompleted) || !isNonNegativeInteger(value.bestStreak)) return null
  if (hasAllyCount && !isNonNegativeInteger(value.allyCount)) return null
  return {
    playerId: value.playerId,
    displayName: value.displayName,
    avatarId: value.avatarId,
    lifetimeGems: value.lifetimeGems,
    expeditionsCompleted: value.expeditionsCompleted,
    bestStreak: value.bestStreak,
    ...(hasAllyCount ? { allyCount: value.allyCount as number } : {}),
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
