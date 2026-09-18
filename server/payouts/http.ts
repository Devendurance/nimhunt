import {
  isAuthorizedLocalHttpAlias,
  type ExpeditionHttpRequest,
  type ExpeditionHttpResponse,
  type ExpeditionHttpSecurity,
} from '../expeditions/http.js'
import { parseRunSessionCookie, parseWalletRecoverySessionCookie } from '../expeditions/session.js'
import type { DurableRewardClaim, ExpeditionProofService } from '../expeditions/types.js'
import { GET_REWARD_PAYOUT_PATH } from '../../src/domain/expeditionProof.js'
import { isPayoutError, PayoutError } from './errors.js'
import { toPublicPayout } from './store.js'
import type { PayoutStore } from './types.js'

const BASE_HEADERS = {
  'cache-control': 'no-store',
  'content-type': 'application/json; charset=utf-8',
  'x-content-type-options': 'nosniff',
}

export function isOwnedPayoutPath(path: string): boolean {
  return path === GET_REWARD_PAYOUT_PATH
}

export async function dispatchPayoutHttp(
  proof: ExpeditionProofService | null,
  store: PayoutStore | null,
  request: ExpeditionHttpRequest,
  security: ExpeditionHttpSecurity,
): Promise<ExpeditionHttpResponse> {
  const url = parseRequestUrl(request.path, security.expectedOrigin)
  if (!url || url.pathname !== GET_REWARD_PAYOUT_PATH) {
    return response(404, { ok: false, error: 'MALFORMED_REQUEST' })
  }
  if (!security.expectedOrigin || !security.expectedHost) {
    return response(503, { ok: false, error: 'PROOF_UNAVAILABLE' })
  }
  if (!isAllowedRequest(request, security)) return response(400, { ok: false, error: 'MALFORMED_REQUEST' })
  const method = request.method.toUpperCase()
  if (method === 'OPTIONS') return { status: 204, body: null, headers: BASE_HEADERS }
  if (method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE') {
    return response(405, { ok: false, error: 'MALFORMED_REQUEST' })
  }
  if (method !== 'GET') return response(405, { ok: false, error: 'MALFORMED_REQUEST' })
  if (!proof || !store) return response(503, { ok: false, error: 'PROOF_UNAVAILABLE' })

  try {
    const claimId = readClaimId(url)
    const claim = await readAuthorizedClaim(proof, request, claimId)
    if (!claim) return response(404, { ok: false, error: 'CLAIM_NOT_FOUND' })
    if (claim.status !== 'RESERVED') return response(400, { ok: false, error: 'CLAIM_NOT_ELIGIBLE' })
    const payout = await store.getByClaim(claim.claimId)
    return response(200, {
      ok: true,
      claimId: claim.claimId,
      payout: toPublicBody(payout),
    })
  } catch (error) {
    if (isPayoutError(error)) return response(statusFor(error), { ok: false, error: publicError(error) })
    if (isSessionInvalidLike(error)) {
      return response(401, { ok: false, error: 'RUN_SESSION_INVALID' })
    }
    if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') {
      if (error.code === 'CLAIM_NOT_FOUND') {
        return response(404, { ok: false, error: error.code })
      }
      if (error.code === 'CLAIM_NOT_ELIGIBLE' || error.code === 'MALFORMED_REQUEST') {
        return response(400, { ok: false, error: error.code })
      }
    }
    return response(503, { ok: false, error: 'PAYOUT_UNAVAILABLE' })
  }
}

function isSessionInvalidLike(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const code = (error as { code?: unknown }).code
  if (code === 'RUN_SESSION_INVALID' || code === 'INVALID_SESSION' || code === 'SESSION_EXPIRED' || code === 'SESSION_REVOKED') return true
  const message = (error as { message?: unknown }).message
  return message === 'INVALID_SESSION' || message === 'SESSION_EXPIRED' || message === 'SESSION_REVOKED'
}

async function readAuthorizedClaim(
  proof: ExpeditionProofService,
  request: ExpeditionHttpRequest,
  claimId: string | null,
): Promise<DurableRewardClaim | null> {
  const cookie = getHeader(request, 'cookie')
  const recoveryRaw = parseWalletRecoverySessionCookie(cookie)
  if (recoveryRaw) {
    try {
      const recovery = await proof.authenticateWalletRecoverySession(recoveryRaw)
      return claimId
        ? await proof.getRewardClaimForWallet(claimId, recovery)
        : await proof.getReservedRewardClaimForWallet(recovery)
    } catch (error) {
      if (!parseRunSessionCookie(cookie)) throw error
    }
  }

  const raw = parseRunSessionCookie(cookie)
  if (!raw) throw new PayoutError('RUN_SESSION_INVALID')
  const session = await proof.authenticateSession(raw)
  return claimId
    ? await proof.getRewardClaim(claimId, session)
    : await proof.getReservedRewardClaim(session)
}

function toPublicBody(payout: Awaited<ReturnType<PayoutStore['getByClaim']>>) {
  return payout ? toPublicPayout(payout) : null
}

function parseRequestUrl(path: string, expectedOrigin: string): URL | null {
  if (!path.startsWith('/')) return null
  try {
    return new URL(path, expectedOrigin || 'https://hunt.example')
  } catch {
    return null
  }
}

function readClaimId(url: URL): string | null {
  const entries = [...url.searchParams.entries()]
  if (entries.length === 0) return null
  if (entries.length !== 1 || entries[0]?.[0] !== 'claimId' || !isBoundedString(entries[0][1], 128)) {
    throw new PayoutError('MALFORMED_REQUEST')
  }
  return entries[0][1]
}

function isAllowedRequest(request: ExpeditionHttpRequest, security: ExpeditionHttpSecurity): boolean {
  const host = request.host ?? getHeader(request, 'host')
  const protocol = request.protocol ?? (getHeader(request, 'protocol') === 'http' ? 'http' : getHeader(request, 'protocol') === 'https' ? 'https' : undefined)
  const origin = getHeader(request, 'origin')
  if (!host || !protocol) return false
  if (host === security.expectedHost && protocol === security.expectedProtocol) {
    return origin === undefined || origin === security.expectedOrigin
  }
  return isAuthorizedLocalHttpAlias(host, protocol, origin, true, security)
}

function getHeader(request: ExpeditionHttpRequest, name: string): string | undefined {
  const expected = name.toLowerCase()
  for (const [key, value] of Object.entries(request.headers ?? {})) {
    if (key.toLowerCase() === expected) return value
  }
  return undefined
}

function isBoundedString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength
}

function statusFor(error: PayoutError): number {
  if (error.code === 'RUN_SESSION_INVALID') return 401
  if (error.code === 'CLAIM_NOT_FOUND') return 404
  if (error.code === 'PAYOUT_UNAVAILABLE') return 503
  return 400
}

function publicError(error: PayoutError): string {
  if (error.code === 'RUN_SESSION_INVALID' || error.code === 'CLAIM_NOT_FOUND' || error.code === 'CLAIM_NOT_ELIGIBLE' || error.code === 'MALFORMED_REQUEST') {
    return error.code
  }
  return 'MALFORMED_REQUEST'
}

function response(status: number, body: unknown): ExpeditionHttpResponse {
  return { status, body, headers: BASE_HEADERS }
}
