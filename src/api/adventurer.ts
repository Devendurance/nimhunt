import {
  ADVENTURER_CREATE_CHALLENGE_PATH,
  ADVENTURER_CREATE_PATH,
  ADVENTURER_ME_PATH,
  ADVENTURER_NAME_AVAILABILITY_PATH,
  ADVENTURER_SESSION_CHALLENGE_PATH,
  ADVENTURER_SESSION_PATH,
  parseAdventurerChallenge,
  parseAdventurerProfile,
  parseAdventurerSession,
  type AdventurerChallenge,
  type AdventurerProfile,
  type AdventurerSession,
} from '../domain/adventurer.ts'

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
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
