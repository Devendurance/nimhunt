// Public usage-proof HTTP boundary.
//
// PUBLIC GET /api/public-stats (no auth, no query params).
//
// Response is always { ok: true, gamers: number } — a count only. Wallet
// rows/addresses never leave the server. Read-only over existing durable
// expedition_runs; no gameplay, payout, or scheduler mutation is reachable.
import { PUBLIC_STATS_PATH } from '../../src/domain/publicStats.js'
import {
  type ExpeditionHttpRequest,
  type ExpeditionHttpResponse,
  type ExpeditionHttpSecurity,
  isAuthorizedLocalHttpAlias,
} from '../expeditions/http.js'
import { PublicStatsError } from './http-shared.js'
import type { PublicStatsSource } from './store.js'

const BASE_HEADERS = {
  'cache-control': 'no-store',
  'content-type': 'application/json; charset=utf-8',
  'x-content-type-options': 'nosniff',
}

export function isOwnedPublicStatsPath(path: string): boolean {
  const pathname = path.split('?')[0] ?? path
  return pathname === PUBLIC_STATS_PATH
}

export async function dispatchPublicStatsHttp(
  source: PublicStatsSource | null,
  request: ExpeditionHttpRequest,
  security: ExpeditionHttpSecurity,
): Promise<ExpeditionHttpResponse> {
  const url = parseRequestUrl(request.path, security.expectedOrigin)
  if (!url || url.pathname !== PUBLIC_STATS_PATH) {
    return response(404, { ok: false, error: 'MALFORMED_REQUEST' })
  }
  // Count only: no filters, no wallet parameter, no month override.
  if ([...url.searchParams.keys()].length > 0) {
    return response(400, { ok: false, error: 'MALFORMED_REQUEST' })
  }
  if (!security.expectedOrigin || !security.expectedHost) {
    return response(503, { ok: false, error: 'STATS_UNAVAILABLE' })
  }
  if (!isAllowedRequest(request, security)) return response(400, { ok: false, error: 'MALFORMED_REQUEST' })
  const method = request.method.toUpperCase()
  if (method === 'OPTIONS') return { status: 204, body: null, headers: BASE_HEADERS }
  if (method !== 'GET') return response(405, { ok: false, error: 'MALFORMED_REQUEST' })
  if (!source) return response(503, { ok: false, error: 'STATS_UNAVAILABLE' })

  try {
    const gamers = await source.countGamers()
    if (!Number.isFinite(gamers) || gamers < 0) {
      return response(503, { ok: false, error: 'STATS_UNAVAILABLE' })
    }
    return response(200, { ok: true, gamers: Math.floor(gamers) })
  } catch (error) {
    if (error instanceof PublicStatsError) {
      return response(error.code === 'STATS_UNAVAILABLE' ? 503 : 400, { ok: false, error: error.code })
    }
    return response(503, { ok: false, error: 'STATS_UNAVAILABLE' })
  }
}

function response(status: number, body: unknown): ExpeditionHttpResponse {
  return { status, body, headers: BASE_HEADERS }
}

function parseRequestUrl(path: string, expectedOrigin: string): URL | null {
  if (!path.startsWith('/')) return null
  try {
    return new URL(path, expectedOrigin || 'https://hunt.example')
  } catch {
    return null
  }
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
