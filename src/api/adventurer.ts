import {
  ADVENTURER_CREATE_CHALLENGE_PATH,
  ADVENTURER_CREATE_PATH,
  ADVENTURER_ME_PATH,
  ADVENTURER_NAME_AVAILABILITY_PATH,
  ADVENTURER_PUBLIC_PATH,
  ADVENTURER_RENAME_CHALLENGE_PATH,
  ADVENTURER_RENAME_PATH,
  ADVENTURER_SESSION_CHALLENGE_PATH,
  ADVENTURER_SESSION_PATH,
  parseAdventurerChallenge,
  parseAdventurerProfile,
  parsePublicAdventurerProfile,
  parseAdventurerSession,
  type AdventurerChallenge,
  type AdventurerProfile,
  type PublicAdventurerProfile,
  type AdventurerSession,
} from '../domain/adventurer.ts'
import {
  ADVENTURER_SOCIAL_ACCEPT_PATH,
  ADVENTURER_SOCIAL_BLOCK_PATH,
  ADVENTURER_SOCIAL_BLOCKED_PATH,
  ADVENTURER_SOCIAL_CANCEL_PATH,
  ADVENTURER_SOCIAL_DECLINE_PATH,
  ADVENTURER_SOCIAL_PATH,
  ADVENTURER_SOCIAL_REMOVE_PATH,
  ADVENTURER_SOCIAL_REQUEST_PATH,
  ADVENTURER_SOCIAL_UNBLOCK_PATH,
  parseAdventurerBlockedProfile,
  parseAdventurerRelationship,
  parseAdventurerSocialOverview,
  type AdventurerBlockedProfile,
  type AdventurerRelationship,
  type AdventurerSocialOverview,
} from '../domain/adventurerSocial.ts'

export type AdventurerApiErrorCode =
  | 'PROFILE_NOT_FOUND'
  | 'PROFILE_ALREADY_EXISTS'
  | 'DISPLAY_NAME_INVALID'
  | 'DISPLAY_NAME_TAKEN'
  | 'DISPLAY_NAME_RESERVED'
  | 'DISPLAY_NAME_COOLDOWN'
  | 'AVATAR_UNAVAILABLE'
  | 'ADVENTURER_SESSION_INVALID'
  | 'CHALLENGE_INVALID'
  | 'CHALLENGE_EXPIRED'
  | 'SIGNATURE_INVALID'
  | 'ADVENTURER_UNAVAILABLE'
  | 'MALFORMED_REQUEST'
  | 'MALFORMED_RESPONSE'
  | 'NETWORK_ERROR'
  | 'SOCIAL_OUTGOING_CAP_REACHED'
  | 'SOCIAL_INCOMING_CAP_REACHED'
  | 'SOCIAL_ALLY_CAP_REACHED'
  | 'SOCIAL_ALREADY_ALLY'
  | 'SOCIAL_REQUEST_PENDING'
  | 'SOCIAL_INCOMING_REQUEST_EXISTS'
  | 'SOCIAL_TARGET_UNAVAILABLE'
  | 'SOCIAL_REQUEST_STALE'
  | 'SOCIAL_REQUEST_NOT_FOUND'
  | 'SOCIAL_UNAUTHORIZED_ACTION'
  | 'SOCIAL_SELF_ACTION'
  | 'SOCIAL_NOT_ALLY'
  | 'SOCIAL_NOT_BLOCKER'
  | 'SOCIAL_INVALID_PLAYER'
  | 'SOCIAL_UNAVAILABLE'

export class AdventurerApiError extends Error {
  readonly code: AdventurerApiErrorCode

  constructor(code: AdventurerApiErrorCode) {
    super(code)
    this.name = 'AdventurerApiError'
    this.code = code
  }
}

export type SignedAdventurerRequest = {
  readonly payload: string
  readonly publicKey: string
  readonly signature: string
}

export type PublicAdventurerProfileView = {
  readonly profile: PublicAdventurerProfile
  readonly relationship: AdventurerRelationship | null
}

export async function requestAdventurerCreationChallenge(
  wallet: string,
  fetcher: typeof fetch = fetch,
): Promise<AdventurerChallenge> {
  const body = await request(fetcher, ADVENTURER_CREATE_CHALLENGE_PATH, {
    method: 'POST',
    body: { wallet },
  })
  const challenge = parseChallengeResponse(body)
  if (!challenge || challenge.purpose !== 'CREATE') throw new AdventurerApiError('MALFORMED_RESPONSE')
  return challenge
}

export async function createAdventurerProfile(
  signed: SignedAdventurerRequest,
  fetcher: typeof fetch = fetch,
): Promise<{ readonly profile: AdventurerProfile; readonly session: AdventurerSession }> {
  const body = await request(fetcher, ADVENTURER_CREATE_PATH, { method: 'POST', body: signed })
  return parseProfileSessionResponse(body)
}

export async function requestAdventurerRenameChallenge(fetcher: typeof fetch = fetch): Promise<AdventurerChallenge> {
  const body = await request(fetcher, ADVENTURER_RENAME_CHALLENGE_PATH, { method: 'POST', body: {} })
  const challenge = parseChallengeResponse(body)
  if (!challenge || challenge.purpose !== 'RENAME') throw new AdventurerApiError('MALFORMED_RESPONSE')
  return challenge
}

export async function renameAdventurer(
  signed: SignedAdventurerRequest,
  fetcher: typeof fetch = fetch,
): Promise<AdventurerProfile> {
  const body = await request(fetcher, ADVENTURER_RENAME_PATH, { method: 'POST', body: signed })
  if (!isRecord(body) || !parseAdventurerProfile(body.profile)) throw new AdventurerApiError('MALFORMED_RESPONSE')
  return parseAdventurerProfile(body.profile)!
}

export async function requestAdventurerSessionChallenge(
  wallet: string,
  fetcher: typeof fetch = fetch,
): Promise<AdventurerChallenge> {
  const body = await request(fetcher, ADVENTURER_SESSION_CHALLENGE_PATH, {
    method: 'POST',
    body: { wallet },
  })
  const challenge = parseChallengeResponse(body)
  if (!challenge || challenge.purpose !== 'SESSION') throw new AdventurerApiError('MALFORMED_RESPONSE')
  return challenge
}

export async function createAdventurerSession(
  signed: SignedAdventurerRequest,
  fetcher: typeof fetch = fetch,
): Promise<{ readonly profile: AdventurerProfile; readonly session: AdventurerSession }> {
  const body = await request(fetcher, ADVENTURER_SESSION_PATH, { method: 'POST', body: signed })
  return parseProfileSessionResponse(body)
}

export async function fetchOwnAdventurerProfile(fetcher: typeof fetch = fetch): Promise<AdventurerProfile> {
  const body = await request(fetcher, ADVENTURER_ME_PATH, { method: 'GET' })
  if (!isRecord(body) || !parseAdventurerProfile(body.profile)) throw new AdventurerApiError('MALFORMED_RESPONSE')
  return parseAdventurerProfile(body.profile)!
}

export async function fetchPublicAdventurerProfile(
  playerId: string,
  fetcher: typeof fetch = fetch,
): Promise<PublicAdventurerProfile> {
  return (await fetchPublicAdventurerProfileView(playerId, fetcher)).profile
}

export async function fetchPublicAdventurerProfileView(
  playerId: string,
  fetcher: typeof fetch = fetch,
): Promise<PublicAdventurerProfileView> {
  const body = await request(fetcher, `${ADVENTURER_PUBLIC_PATH}?playerId=${encodeURIComponent(playerId)}`, { method: 'GET' })
  if (!isRecord(body)) throw new AdventurerApiError('MALFORMED_RESPONSE')
  const profile = parsePublicAdventurerProfile(body.profile)
  if (!profile) throw new AdventurerApiError('MALFORMED_RESPONSE')
  const relationship = body.relationship === undefined ? null : parseAdventurerRelationship(body.relationship)
  if (body.relationship !== undefined && !relationship) throw new AdventurerApiError('MALFORMED_RESPONSE')
  return { profile, relationship }
}

export async function fetchAdventurerBlockedProfiles(fetcher: typeof fetch = fetch): Promise<readonly AdventurerBlockedProfile[]> {
  const body = await request(fetcher, ADVENTURER_SOCIAL_BLOCKED_PATH, { method: 'GET' })
  if (!isRecord(body) || !Array.isArray(body.blocked)) throw new AdventurerApiError('MALFORMED_RESPONSE')
  const blocked = body.blocked.map(parseAdventurerBlockedProfile)
  if (blocked.some(profile => profile === null)) throw new AdventurerApiError('MALFORMED_RESPONSE')
  return blocked as AdventurerBlockedProfile[]
}

export async function fetchAdventurerSocialOverview(fetcher: typeof fetch = fetch): Promise<AdventurerSocialOverview> {
  const body = await request(fetcher, ADVENTURER_SOCIAL_PATH, { method: 'GET' })
  if (!isRecord(body)) throw new AdventurerApiError('MALFORMED_RESPONSE')
  const overview = parseAdventurerSocialOverview(body.overview)
  if (!overview) throw new AdventurerApiError('MALFORMED_RESPONSE')
  return overview
}

export async function requestAdventurer(targetPlayerId: string, fetcher: typeof fetch = fetch): Promise<string> {
  const body = await socialMutation(fetcher, ADVENTURER_SOCIAL_REQUEST_PATH, { targetPlayerId })
  if (!isRecord(body) || typeof body.requestId !== 'string') throw new AdventurerApiError('MALFORMED_RESPONSE')
  return body.requestId
}

export async function acceptAdventurerRequest(requestId: string, fetcher: typeof fetch = fetch): Promise<void> {
  await socialMutation(fetcher, ADVENTURER_SOCIAL_ACCEPT_PATH, { requestId })
}

export async function declineAdventurerRequest(requestId: string, fetcher: typeof fetch = fetch): Promise<void> {
  await socialMutation(fetcher, ADVENTURER_SOCIAL_DECLINE_PATH, { requestId })
}

export async function cancelAdventurerRequest(requestId: string, fetcher: typeof fetch = fetch): Promise<void> {
  await socialMutation(fetcher, ADVENTURER_SOCIAL_CANCEL_PATH, { requestId })
}

export async function removeAdventurerAlly(otherPlayerId: string, fetcher: typeof fetch = fetch): Promise<void> {
  await socialMutation(fetcher, ADVENTURER_SOCIAL_REMOVE_PATH, { otherPlayerId })
}

export async function blockAdventurer(otherPlayerId: string, fetcher: typeof fetch = fetch): Promise<void> {
  await socialMutation(fetcher, ADVENTURER_SOCIAL_BLOCK_PATH, { otherPlayerId })
}

export async function unblockAdventurer(otherPlayerId: string, fetcher: typeof fetch = fetch): Promise<void> {
  await socialMutation(fetcher, ADVENTURER_SOCIAL_UNBLOCK_PATH, { otherPlayerId })
}

export async function updateAdventurerAvatar(
  avatarId: string,
  fetcher: typeof fetch = fetch,
): Promise<AdventurerProfile> {
  const body = await request(fetcher, ADVENTURER_ME_PATH, { method: 'PATCH', body: { avatarId } })
  if (!isRecord(body) || !parseAdventurerProfile(body.profile)) throw new AdventurerApiError('MALFORMED_RESPONSE')
  return parseAdventurerProfile(body.profile)!
}

export async function fetchAdventurerNameAvailability(
  name: string,
  fetcher: typeof fetch = fetch,
): Promise<{ readonly available: boolean; readonly normalizedName: string | null }> {
  const body = await request(fetcher, `${ADVENTURER_NAME_AVAILABILITY_PATH}?name=${encodeURIComponent(name)}`, { method: 'GET' })
  if (!isRecord(body) || typeof body.available !== 'boolean' || (body.normalizedName !== null && typeof body.normalizedName !== 'string')) {
    throw new AdventurerApiError('MALFORMED_RESPONSE')
  }
  return { available: body.available, normalizedName: body.normalizedName as string | null }
}

async function socialMutation(fetcher: typeof fetch, path: string, body: Record<string, string>): Promise<unknown> {
  return request(fetcher, path, { method: 'POST', body })
}

async function request(
  fetcher: typeof fetch,
  path: string,
  options: { readonly method: 'GET' | 'POST' | 'PATCH'; readonly body?: unknown },
): Promise<unknown> {
  let response: Response
  try {
    response = await fetcher(path, {
      method: options.method,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: options.body === undefined
        ? { accept: 'application/json' }
        : { accept: 'application/json', 'content-type': 'application/json' },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    })
  } catch {
    throw new AdventurerApiError('NETWORK_ERROR')
  }

  let data: unknown
  try {
    data = await response.json()
  } catch {
    throw new AdventurerApiError('MALFORMED_RESPONSE')
  }
  if (!response.ok) throw new AdventurerApiError(readErrorCode(data))
  return data
}

function parseChallengeResponse(value: unknown): AdventurerChallenge | null {
  if (!isRecord(value) || value.ok !== true) return null
  const challenge = { ...value }
  delete challenge.ok
  return parseAdventurerChallenge(challenge)
}

function parseProfileSessionResponse(value: unknown): { readonly profile: AdventurerProfile; readonly session: AdventurerSession } {
  if (!isRecord(value)) throw new AdventurerApiError('MALFORMED_RESPONSE')
  const profile = parseAdventurerProfile(value.profile)
  const session = parseAdventurerSession(value.session)
  if (!profile || !session) throw new AdventurerApiError('MALFORMED_RESPONSE')
  return { profile, session }
}

function readErrorCode(value: unknown): AdventurerApiErrorCode {
  if (isRecord(value) && typeof value.error === 'string' && isAdventurerApiErrorCode(value.error)) return value.error
  return 'MALFORMED_RESPONSE'
}

function isAdventurerApiErrorCode(value: string): value is AdventurerApiErrorCode {
  return value === 'PROFILE_NOT_FOUND'
    || value === 'PROFILE_ALREADY_EXISTS'
    || value === 'DISPLAY_NAME_INVALID'
    || value === 'DISPLAY_NAME_TAKEN'
    || value === 'DISPLAY_NAME_RESERVED'
    || value === 'DISPLAY_NAME_COOLDOWN'
    || value === 'AVATAR_UNAVAILABLE'
    || value === 'ADVENTURER_SESSION_INVALID'
    || value === 'CHALLENGE_INVALID'
    || value === 'CHALLENGE_EXPIRED'
    || value === 'SIGNATURE_INVALID'
    || value === 'ADVENTURER_UNAVAILABLE'
    || value === 'MALFORMED_REQUEST'
    || value === 'SOCIAL_OUTGOING_CAP_REACHED'
    || value === 'SOCIAL_INCOMING_CAP_REACHED'
    || value === 'SOCIAL_ALLY_CAP_REACHED'
    || value === 'SOCIAL_ALREADY_ALLY'
    || value === 'SOCIAL_REQUEST_PENDING'
    || value === 'SOCIAL_INCOMING_REQUEST_EXISTS'
    || value === 'SOCIAL_TARGET_UNAVAILABLE'
    || value === 'SOCIAL_REQUEST_STALE'
    || value === 'SOCIAL_REQUEST_NOT_FOUND'
    || value === 'SOCIAL_UNAUTHORIZED_ACTION'
    || value === 'SOCIAL_SELF_ACTION'
    || value === 'SOCIAL_NOT_ALLY'
    || value === 'SOCIAL_NOT_BLOCKER'
    || value === 'SOCIAL_INVALID_PLAYER'
    || value === 'SOCIAL_UNAVAILABLE'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
