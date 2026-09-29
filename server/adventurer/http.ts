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
} from '../../src/domain/adventurer.js'
import {
  ADVENTURER_SOCIAL_ACCEPT_PATH,
  ADVENTURER_SOCIAL_BLOCK_PATH,
  ADVENTURER_SOCIAL_BLOCKED_PATH,
  ADVENTURER_SOCIAL_CANCEL_PATH,
  ADVENTURER_SOCIAL_DECLINE_PATH,
  ADVENTURER_SOCIAL_PATH,
  ADVENTURER_SOCIAL_PATHS,
  ADVENTURER_SOCIAL_REMOVE_PATH,
  ADVENTURER_SOCIAL_REQUEST_PATH,
  ADVENTURER_SOCIAL_UNBLOCK_PATH,
} from '../../src/domain/adventurerSocial.js'
import {
  isAuthorizedLocalHttpAlias,
  type ExpeditionHttpRequest,
  type ExpeditionHttpResponse,
  type ExpeditionHttpSecurity,
} from '../expeditions/http.js'
import { isAdventurerError, isAdventurerSocialError, isAdventurerUnavailableError } from './errors.js'
import { parseAdventurerSessionCookie, serializeAdventurerSessionCookie } from './session.js'
import type { AdventurerSocialService } from './socialTypes.js'
import type { AdventurerService } from './types.js'

const BASE_HEADERS = {
  'cache-control': 'no-store',
  'content-type': 'application/json; charset=utf-8',
  'x-content-type-options': 'nosniff',
}

export const ADVENTURER_PATHS = [
  ADVENTURER_CREATE_CHALLENGE_PATH,
  ADVENTURER_CREATE_PATH,
  ADVENTURER_SESSION_CHALLENGE_PATH,
  ADVENTURER_SESSION_PATH,
  ADVENTURER_RENAME_CHALLENGE_PATH,
  ADVENTURER_RENAME_PATH,
  ADVENTURER_ME_PATH,
  ADVENTURER_PUBLIC_PATH,
  ADVENTURER_NAME_AVAILABILITY_PATH,
  ...ADVENTURER_SOCIAL_PATHS,
] as const

export function isOwnedAdventurerPath(path: string): boolean {
  return ADVENTURER_PATHS.includes(path.split('?')[0] as (typeof ADVENTURER_PATHS)[number])
}

export async function dispatchAdventurerHttp(
  service: AdventurerService | null,
  request: ExpeditionHttpRequest,
  security: ExpeditionHttpSecurity,
  social: AdventurerSocialService | null = null,
): Promise<ExpeditionHttpResponse> {
  const pathHint = request.path.split('?')[0] ?? ''
  if (!security.expectedOrigin || !security.expectedHost) {
    return isOwnedAdventurerPath(pathHint)
      ? response(503, { ok: false, error: 'ADVENTURER_UNAVAILABLE' })
      : response(400, { ok: false, error: 'MALFORMED_REQUEST' })
  }

  const url = parseRequestUrl(request.path, security.expectedOrigin)
  if (!url || !isOwnedAdventurerPath(url.pathname)) return response(404, { ok: false, error: 'MALFORMED_REQUEST' })
  const path = url.pathname
  const method = request.method.toUpperCase()
  if (!service || (isSocialPath(url.pathname) && !social)) return response(503, { ok: false, error: 'ADVENTURER_UNAVAILABLE' })
  if (!isAllowedRequest(request, method, security)) return response(400, { ok: false, error: 'MALFORMED_REQUEST' })
  if (request.rawBody !== undefined && Buffer.byteLength(request.rawBody, 'utf8') > 16 * 1024) {
    return response(413, { ok: false, error: 'MALFORMED_REQUEST' })
  }

  if (method === 'OPTIONS') return { status: 204, body: null, headers: BASE_HEADERS }
  if (!isExpectedMethod(path, method)) return response(405, { ok: false, error: 'MALFORMED_REQUEST' })
  if ((method === 'POST' || method === 'PATCH') && !isJsonRequest(request)) return response(400, { ok: false, error: 'MALFORMED_REQUEST' })

  try {
    if (path === ADVENTURER_CREATE_CHALLENGE_PATH) {
      const body = readWalletBody(readJsonBody(request))
      const challenge = await service.issueCreationChallenge(body.wallet)
      return response(200, { ok: true, ...challenge })
    }

    if (path === ADVENTURER_CREATE_PATH) {
      const signed = readSignedBody(readJsonBody(request))
      const created = await service.createProfile(signed)
      return withSessionCookie(created.sessionCapability, created.session, security, {
        ok: true,
        profile: created.profile,
        session: created.session,
      })
    }

    if (path === ADVENTURER_SESSION_CHALLENGE_PATH) {
      const body = readWalletBody(readJsonBody(request))
      const challenge = await service.issueSessionChallenge(body.wallet)
      return response(200, { ok: true, ...challenge })
    }

    if (path === ADVENTURER_RENAME_CHALLENGE_PATH) {
      if (url.searchParams.size > 0) return response(400, { ok: false, error: 'MALFORMED_REQUEST' })
      requireExactKeys(readJsonBody(request), [])
      const raw = parseAdventurerSessionCookie(getHeader(request, 'cookie'))
      const session = await service.authenticateSession(raw ?? '')
      const challenge = await service.issueRenameChallenge(session)
      return response(200, { ok: true, ...challenge })
    }

    if (path === ADVENTURER_SESSION_PATH) {
      const signed = readSignedBody(readJsonBody(request))
      const created = await service.createSession(signed)
      return withSessionCookie(created.sessionCapability, created.session, security, {
        ok: true,
        profile: created.profile,
        session: created.session,
      })
    }

    if (path === ADVENTURER_RENAME_PATH) {
      if (url.searchParams.size > 0) return response(400, { ok: false, error: 'MALFORMED_REQUEST' })
      const raw = parseAdventurerSessionCookie(getHeader(request, 'cookie'))
      const session = await service.authenticateSession(raw ?? '')
      const signed = readSignedBody(readJsonBody(request))
      const profile = await service.renameProfile(session, signed)
      return response(200, { ok: true, profile })
    }

    if (path === ADVENTURER_ME_PATH) {
      if (url.searchParams.size > 0) return response(400, { ok: false, error: 'MALFORMED_REQUEST' })
      const raw = parseAdventurerSessionCookie(getHeader(request, 'cookie'))
      const session = await service.authenticateSession(raw ?? '')
      if (method === 'PATCH') {
        const body = readAvatarBody(readJsonBody(request))
        const profile = await service.updateAvatar(session, body.avatarId)
        return response(200, { ok: true, profile })
      }
      const profile = await service.getOwnProfile(session)
      return response(200, { ok: true, profile })
    }

    if (path === ADVENTURER_PUBLIC_PATH) {
      const playerId = readSingleQuery(url, 'playerId', 64)
      const profile = await service.getPublicProfile(playerId)
      if (!social) return response(200, { ok: true, profile: { ...profile, allyCount: 0 } })
      const allyCount = await social.getAllyCount(playerId)
      const raw = parseAdventurerSessionCookie(getHeader(request, 'cookie'))
      let relationship: Awaited<ReturnType<AdventurerSocialService['getRelationship']>> | null = null
      if (raw) {
        try {
          const viewer = await service.authenticateSession(raw)
          relationship = viewer.playerId === playerId
            ? { state: 'SELF', requestId: null }
            : await social.getRelationship(viewer, playerId)
        } catch {
          // A public profile remains readable when an expired cookie is present.
        }
      }
      return response(200, {
        ok: true,
        profile: { ...profile, allyCount },
        ...(relationship ? { relationship } : {}),
      })
    }

    if (isSocialPath(path)) {
      const raw = parseAdventurerSessionCookie(getHeader(request, 'cookie'))
      const session = await service.authenticateSession(raw ?? '')
      const socialService = social!
      if (path === ADVENTURER_SOCIAL_PATH) {
        if (method !== 'GET' || url.searchParams.size > 0) return response(400, { ok: false, error: 'MALFORMED_REQUEST' })
        return response(200, { ok: true, overview: await socialService.getOverview(session) })
      }
      if (path === ADVENTURER_SOCIAL_BLOCKED_PATH) {
        if (method !== 'GET' || url.searchParams.size > 0) return response(400, { ok: false, error: 'MALFORMED_REQUEST' })
        return response(200, { ok: true, blocked: await socialService.getBlocked(session) })
      }
      const body = readJsonBody(request)
      if (path === ADVENTURER_SOCIAL_REQUEST_PATH) {
        const targetPlayerId = readSocialPlayerBody(body, 'targetPlayerId')
        return response(200, { ok: true, ...(await socialService.request(session, targetPlayerId)) })
      }
      if (path === ADVENTURER_SOCIAL_ACCEPT_PATH) {
        const requestId = readSocialPlayerBody(body, 'requestId')
        await socialService.accept(session, requestId)
        return response(200, { ok: true })
      }
      if (path === ADVENTURER_SOCIAL_DECLINE_PATH) {
        const requestId = readSocialPlayerBody(body, 'requestId')
        await socialService.decline(session, requestId)
        return response(200, { ok: true })
      }
      if (path === ADVENTURER_SOCIAL_CANCEL_PATH) {
        const requestId = readSocialPlayerBody(body, 'requestId')
        await socialService.cancel(session, requestId)
        return response(200, { ok: true })
      }
      const otherPlayerId = readSocialPlayerBody(body, 'otherPlayerId')
      if (path === ADVENTURER_SOCIAL_REMOVE_PATH) await socialService.remove(session, otherPlayerId)
      else if (path === ADVENTURER_SOCIAL_BLOCK_PATH) await socialService.block(session, otherPlayerId)
      else if (path === ADVENTURER_SOCIAL_UNBLOCK_PATH) await socialService.unblock(session, otherPlayerId)
      else return response(404, { ok: false, error: 'MALFORMED_REQUEST' })
      return response(200, { ok: true })
    }

    if (path === ADVENTURER_NAME_AVAILABILITY_PATH) {
      const name = readSingleQuery(url, 'name', 64)
      const availability = await service.checkNameAvailability(name)
      if (availability.error === 'DISPLAY_NAME_INVALID' || availability.error === 'DISPLAY_NAME_RESERVED') {
        return response(400, { ok: false, error: availability.error, available: false })
      }
      return response(200, { ok: true, ...availability })
    }

    return response(404, { ok: false, error: 'MALFORMED_REQUEST' })
  } catch (error) {
    if (isAdventurerSocialError(error)) return response(statusForSocial(error.code), { ok: false, error: error.code })
    if (isAdventurerError(error)) return response(statusFor(error.code), { ok: false, error: error.code })
    if (isAdventurerUnavailableError(error)) return response(503, { ok: false, error: 'ADVENTURER_UNAVAILABLE' })
    if (error instanceof SyntaxError) return response(400, { ok: false, error: 'MALFORMED_REQUEST' })
    return response(503, { ok: false, error: 'ADVENTURER_UNAVAILABLE' })
  }
}

function withSessionCookie(
  raw: string,
  session: { readonly expiresAt: string; readonly createdAt: string },
  security: ExpeditionHttpSecurity,
  body: unknown,
): ExpeditionHttpResponse {
  return {
    ...response(200, body),
    headers: {
      ...BASE_HEADERS,
      'set-cookie': serializeAdventurerSessionCookie(
        raw,
        new Date(session.expiresAt),
        new Date(session.createdAt),
        security.secureCookie,
      ),
    },
  }
}

function statusFor(code: import('../../src/domain/adventurer.js').AdventurerErrorCode): number {
  if (code === 'PROFILE_NOT_FOUND') return 404
  if (code === 'PROFILE_ALREADY_EXISTS' || code === 'DISPLAY_NAME_TAKEN' || code === 'DISPLAY_NAME_COOLDOWN') return 409
  if (code === 'ADVENTURER_SESSION_INVALID') return 401
  return 400
}

function statusForSocial(code: import('../../src/domain/adventurerSocial.js').AdventurerSocialErrorCode): number {
  if (code === 'SOCIAL_UNAUTHORIZED_ACTION' || code === 'SOCIAL_NOT_BLOCKER') return 403
  if (code === 'SOCIAL_INVALID_PLAYER' || code === 'SOCIAL_SELF_ACTION') return 400
  return 409
}

function parseRequestUrl(path: string, expectedOrigin: string): URL | null {
  if (!path.startsWith('/')) return null
  try {
    return new URL(path, expectedOrigin)
  } catch {
    return null
  }
}

function isSocialPath(path: string): boolean {
  return (ADVENTURER_SOCIAL_PATHS as readonly string[]).includes(path)
}

function isExpectedMethod(path: string, method: string): boolean {
  if (path === ADVENTURER_ME_PATH) return method === 'GET' || method === 'PATCH'
  if (path === ADVENTURER_PUBLIC_PATH || path === ADVENTURER_NAME_AVAILABILITY_PATH || path === ADVENTURER_SOCIAL_PATH || path === ADVENTURER_SOCIAL_BLOCKED_PATH) return method === 'GET'
  return method === 'POST'
}

function isAllowedRequest(request: ExpeditionHttpRequest, method: string, security: ExpeditionHttpSecurity): boolean {
  const host = request.host ?? getHeader(request, 'host')
  const protocol = request.protocol ?? getProtocolHeader(request)
  const origin = getHeader(request, 'origin')
  const isRead = method === 'GET'
  if (!host || !protocol) return false
  if (host === security.expectedHost && protocol === security.expectedProtocol) {
    return isRead ? origin === undefined || origin === security.expectedOrigin : origin === security.expectedOrigin
  }
  return isAuthorizedLocalHttpAlias(host, protocol, origin, isRead, security)
}

function readJsonBody(request: ExpeditionHttpRequest): Record<string, unknown> {
  if (request.rawBody !== undefined) {
    if (request.rawBody.length === 0) throw new SyntaxError('EMPTY_BODY')
    const parsed: unknown = JSON.parse(request.rawBody)
    if (!isRecord(parsed)) throw new SyntaxError('OBJECT_REQUIRED')
    return parsed
  }
  if (!isRecord(request.body)) throw new SyntaxError('OBJECT_REQUIRED')
  return request.body
}

function readWalletBody(body: Record<string, unknown>): { readonly wallet: string } {
  requireExactKeys(body, ['wallet'])
  if (typeof body.wallet !== 'string' || body.wallet.length === 0 || body.wallet.length > 80) throw new SyntaxError('INVALID_WALLET')
  return { wallet: body.wallet }
}

function readAvatarBody(body: Record<string, unknown>): { readonly avatarId: string } {
  requireExactKeys(body, ['avatarId'])
  if (!isBoundedString(body.avatarId, 64)) throw new SyntaxError('INVALID_AVATAR')
  return { avatarId: body.avatarId }
}

function readSocialPlayerBody(body: Record<string, unknown>, key: 'targetPlayerId' | 'requestId' | 'otherPlayerId'): string {
  requireExactKeys(body, [key])
  if (!isBoundedString(body[key], 64)) throw new SyntaxError('INVALID_SOCIAL_TARGET')
  return body[key] as string
}

function readSignedBody(body: Record<string, unknown>): { readonly payload: string; readonly publicKey: string; readonly signature: string } {
  requireExactKeys(body, ['payload', 'publicKey', 'signature'])
  if (!isBoundedString(body.payload, 4_096) || !isBoundedString(body.publicKey, 130) || !isBoundedString(body.signature, 258)) {
    throw new SyntaxError('INVALID_SIGNATURE')
  }
  return { payload: body.payload, publicKey: body.publicKey, signature: body.signature }
}

function readSingleQuery(url: URL, key: string, maxLength: number): string {
  const keys = [...url.searchParams.keys()]
  if (keys.length !== 1 || keys[0] !== key) throw new SyntaxError('INVALID_QUERY')
  const value = url.searchParams.get(key)
  if (!value || value.length > maxLength) throw new SyntaxError('INVALID_QUERY')
  return value
}

function requireExactKeys(body: Record<string, unknown>, expected: readonly string[]): void {
  const keys = Object.keys(body)
  if (keys.length !== expected.length || expected.some(key => !keys.includes(key))) throw new SyntaxError('INVALID_BODY')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isBoundedString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength
}

function isJsonRequest(request: ExpeditionHttpRequest): boolean {
  return getHeader(request, 'content-type')?.split(';', 1)[0]?.trim().toLowerCase() === 'application/json'
}

function getProtocolHeader(request: ExpeditionHttpRequest): 'http' | 'https' | undefined {
  const protocol = getHeader(request, 'protocol')
  return protocol === 'http' || protocol === 'https' ? protocol : undefined
}

function getHeader(request: ExpeditionHttpRequest, name: string): string | undefined {
  const expected = name.toLowerCase()
  for (const [key, value] of Object.entries(request.headers ?? {})) {
    if (key.toLowerCase() === expected) return value
  }
  return undefined
}

function response(status: number, body: unknown): ExpeditionHttpResponse {
  return { status, body, headers: BASE_HEADERS }
}
