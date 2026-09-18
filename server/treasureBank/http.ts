import { TREASURE_BANK_PATH } from '../../src/domain/treasureBank.js'
import { isAuthorizedLocalHttpAlias, type ExpeditionHttpRequest, type ExpeditionHttpResponse, type ExpeditionHttpSecurity } from '../expeditions/http.js'
import { parseRunSessionCookie, parseWalletRecoverySessionCookie } from '../expeditions/session.js'
import type { ExpeditionProofService } from '../expeditions/types.js'
import { buildTreasureBank, resolveRewardFallbackAmountLuna, TreasureBankError } from './service.js'
import type { TreasureBankSource } from './store.js'

const BASE_HEADERS = {
  'cache-control': 'no-store',
  'content-type': 'application/json; charset=utf-8',
  'x-content-type-options': 'nosniff',
}

export function isOwnedTreasureBankPath(path: string): boolean {
  return (path.split('?')[0] ?? path) === TREASURE_BANK_PATH
}

export async function dispatchTreasureBankHttp(
  proof: ExpeditionProofService | null,
  source: TreasureBankSource | null,
  request: ExpeditionHttpRequest,
  security: ExpeditionHttpSecurity,
  env: Record<string, string | undefined> = process.env,
): Promise<ExpeditionHttpResponse> {
  const url = parseRequestUrl(request.path, security.expectedOrigin)
  if (!url || url.pathname !== TREASURE_BANK_PATH) {
    return response(404, { ok: false, error: 'MALFORMED_REQUEST' })
  }
  if ([...url.searchParams.keys()].length > 0) {
    return response(400, { ok: false, error: 'MALFORMED_REQUEST' })
  }
  if (!security.expectedOrigin || !security.expectedHost) {
    return response(503, { ok: false, error: 'TREASURE_UNAVAILABLE' })
  }
  if (!isAllowedRequest(request, security)) return response(400, { ok: false, error: 'MALFORMED_REQUEST' })
  const method = request.method.toUpperCase()
  if (method === 'OPTIONS') return { status: 204, body: null, headers: BASE_HEADERS }
  if (method !== 'GET') return response(405, { ok: false, error: 'MALFORMED_REQUEST' })
  if (!proof || !source) return response(503, { ok: false, error: 'TREASURE_UNAVAILABLE' })

  try {
    const wallet = await readAuthorizedWallet(proof, request)
    const rows = await source.loadWalletTreasure(wallet)
    const bank = buildTreasureBank({ ...rows, fallbackAmountLuna: resolveRewardFallbackAmountLuna(env) })
    return response(200, bank)
  } catch (error) {
    if (error instanceof TreasureBankError) {
      return response(error.code === 'RUN_SESSION_INVALID' ? 401 : error.code === 'TREASURE_UNAVAILABLE' ? 503 : 400, {
        ok: false,
        error: error.code,
      })
    }
    if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') {
      if (error.code === 'RUN_SESSION_INVALID' || error.code === 'INVALID_SESSION' || error.code === 'SESSION_EXPIRED' || error.code === 'SESSION_REVOKED') {
        return response(401, { ok: false, error: 'RUN_SESSION_INVALID' })
      }
    }
    return response(400, { ok: false, error: 'MALFORMED_REQUEST' })
  }
}

async function readAuthorizedWallet(proof: ExpeditionProofService, request: ExpeditionHttpRequest): Promise<string> {
  const cookie = getHeader(request, 'cookie')
  const recoveryRaw = parseWalletRecoverySessionCookie(cookie)
  if (recoveryRaw) {
    try {
      const recovery = await proof.authenticateWalletRecoverySession(recoveryRaw)
      if (recovery.wallet) return recovery.wallet
    } catch (error) {
      if (!parseRunSessionCookie(cookie)) throw error
    }
  }
  const raw = parseRunSessionCookie(cookie)
  if (!raw) throw new TreasureBankError('RUN_SESSION_INVALID')
  const session = await proof.authenticateSession(raw)
  if (!session.wallet) throw new TreasureBankError('RUN_SESSION_INVALID')
  return session.wallet
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

function response(status: number, body: unknown): ExpeditionHttpResponse {
  return { status, body, headers: BASE_HEADERS }
}
