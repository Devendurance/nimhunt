// P4 social contract. Relationships are keyed only by immutable player_id.

export const ADVENTURER_SOCIAL_PATH = '/api/adventurer/social' as const
export const ADVENTURER_SOCIAL_REQUEST_PATH = '/api/adventurer/social/request' as const
export const ADVENTURER_SOCIAL_ACCEPT_PATH = '/api/adventurer/social/request/accept' as const
export const ADVENTURER_SOCIAL_DECLINE_PATH = '/api/adventurer/social/request/decline' as const
export const ADVENTURER_SOCIAL_CANCEL_PATH = '/api/adventurer/social/request/cancel' as const
export const ADVENTURER_SOCIAL_REMOVE_PATH = '/api/adventurer/social/ally/remove' as const
export const ADVENTURER_SOCIAL_BLOCK_PATH = '/api/adventurer/social/block' as const
export const ADVENTURER_SOCIAL_UNBLOCK_PATH = '/api/adventurer/social/unblock' as const

export const ADVENTURER_SOCIAL_PATHS = [
  ADVENTURER_SOCIAL_PATH,
  ADVENTURER_SOCIAL_REQUEST_PATH,
  ADVENTURER_SOCIAL_ACCEPT_PATH,
  ADVENTURER_SOCIAL_DECLINE_PATH,
  ADVENTURER_SOCIAL_CANCEL_PATH,
  ADVENTURER_SOCIAL_REMOVE_PATH,
  ADVENTURER_SOCIAL_BLOCK_PATH,
  ADVENTURER_SOCIAL_UNBLOCK_PATH,
] as const

export const ADVENTURER_SOCIAL_ERROR_CODES = [
  'SOCIAL_OUTGOING_CAP_REACHED',
  'SOCIAL_INCOMING_CAP_REACHED',
  'SOCIAL_ALLY_CAP_REACHED',
  'SOCIAL_ALREADY_ALLY',
  'SOCIAL_REQUEST_PENDING',
  'SOCIAL_INCOMING_REQUEST_EXISTS',
  'SOCIAL_TARGET_UNAVAILABLE',
  'SOCIAL_REQUEST_STALE',
  'SOCIAL_REQUEST_NOT_FOUND',
  'SOCIAL_UNAUTHORIZED_ACTION',
  'SOCIAL_SELF_ACTION',
  'SOCIAL_NOT_ALLY',
  'SOCIAL_NOT_BLOCKER',
  'SOCIAL_INVALID_PLAYER',
  'SOCIAL_UNAVAILABLE',
] as const
export type AdventurerSocialErrorCode = (typeof ADVENTURER_SOCIAL_ERROR_CODES)[number]

export type AdventurerRelationshipState =
  | 'SELF'
  | 'NONE'
  | 'OUTGOING_PENDING'
  | 'INCOMING_PENDING'
  | 'ALLY'
  | 'BLOCKED_BY_ME'
  | 'UNAVAILABLE'

export type AdventurerSocialProfile = {
  readonly playerId: string
  readonly displayName: string
  readonly avatarId: string
}

export type AdventurerAllyRequest = {
  readonly requestId: string
  readonly playerId: string
  readonly displayName: string
  readonly avatarId: string
  readonly createdAt: string
}

export type AdventurerSocialOverview = {
  readonly allyCount: number
  readonly incomingPendingCount: number
  readonly outgoingPendingCount: number
  readonly incomingRequests: readonly AdventurerAllyRequest[]
  readonly allies: readonly AdventurerSocialProfile[]
}

export type AdventurerRelationship = {
  readonly state: AdventurerRelationshipState
  readonly requestId: string | null
}

export function parseAdventurerSocialProfile(value: unknown): AdventurerSocialProfile | null {
  if (!isRecord(value) || !hasExactKeys(value, ['playerId', 'displayName', 'avatarId'])) return null
  if (!isNonEmptyString(value.playerId) || !isNonEmptyString(value.displayName) || !isNonEmptyString(value.avatarId)) return null
  return { playerId: value.playerId, displayName: value.displayName, avatarId: value.avatarId }
}

export function parseAdventurerAllyRequest(value: unknown): AdventurerAllyRequest | null {
  if (!isRecord(value) || !hasExactKeys(value, ['requestId', 'playerId', 'displayName', 'avatarId', 'createdAt'])) return null
  if (!isNonEmptyString(value.requestId) || !isNonEmptyString(value.playerId) || !isNonEmptyString(value.displayName) || !isNonEmptyString(value.avatarId) || !isIsoString(value.createdAt)) return null
  return {
    requestId: value.requestId,
    playerId: value.playerId,
    displayName: value.displayName,
    avatarId: value.avatarId,
    createdAt: value.createdAt,
  }
}

export function parseAdventurerSocialOverview(value: unknown): AdventurerSocialOverview | null {
  if (!isRecord(value) || !hasExactKeys(value, ['allyCount', 'incomingPendingCount', 'outgoingPendingCount', 'incomingRequests', 'allies'])) return null
  if (!isCount(value.allyCount) || !isCount(value.incomingPendingCount) || !isCount(value.outgoingPendingCount)) return null
  if (!Array.isArray(value.incomingRequests) || !Array.isArray(value.allies)) return null
  const incomingRequests = value.incomingRequests.map(parseAdventurerAllyRequest)
  const allies = value.allies.map(parseAdventurerSocialProfile)
  if (incomingRequests.some(request => request === null) || allies.some(profile => profile === null)) return null
  return {
    allyCount: value.allyCount,
    incomingPendingCount: value.incomingPendingCount,
    outgoingPendingCount: value.outgoingPendingCount,
    incomingRequests: incomingRequests as AdventurerAllyRequest[],
    allies: allies as AdventurerSocialProfile[],
  }
}

export function parseAdventurerRelationship(value: unknown): AdventurerRelationship | null {
  if (!isRecord(value) || !hasExactKeys(value, ['state', 'requestId'])) return null
  if (!isRelationshipState(value.state) || (value.requestId !== null && !isNonEmptyString(value.requestId))) return null
  return { state: value.state, requestId: value.requestId }
}

function isRelationshipState(value: unknown): value is AdventurerRelationshipState {
  return value === 'SELF'
    || value === 'NONE'
    || value === 'OUTGOING_PENDING'
    || value === 'INCOMING_PENDING'
    || value === 'ALLY'
    || value === 'BLOCKED_BY_ME'
    || value === 'UNAVAILABLE'
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

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function isIsoString(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value
}
