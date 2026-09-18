import {
  ABANDON_EXPEDITION_PATH,
  COMPLETE_EXPEDITION_PATH,
  DAILY_HUNT_STATUS_PATH,
  FAIL_EXPEDITION_PATH,
  RESERVE_REWARD_PATH,
} from '../../src/domain/dailyLedger.js'
import {
  ACTIVE_EXPEDITION_PATH,
  CHECKPOINT_PATH,
  FINALIZE_REWARD_CLAIM_PATH,
  GAMEPLAY_START_PATH,
  GET_REWARD_PAYOUT_PATH,
  PREPARE_REWARD_CLAIM_PATH,
  PRODUCT_VAULT_SEAL_PREPARE_PATH,
  PRODUCT_VAULT_SEAL_VERIFY_PATH,
  RECOVER_RUN_SESSION_PATH,
  START_CHALLENGE_PATH,
  START_EXPEDITION_PATH,
  VERIFY_EXPEDITION_PATH,
} from '../../src/domain/expeditionProof.js'
import {
  RECOVER_SESSION_CHALLENGE_PATH,
  RECOVER_SESSION_PATH,
} from '../../src/domain/walletRecovery.js'
import { TREASURE_BANK_PATH } from '../../src/domain/treasureBank.js'
import { MONTHLY_HEROES_PATH, WALLET_MONTHLY_STATS_PATH } from '../../src/domain/monthlyHeroes.js'
import { WALLET_DAILY_STATUS_PATH } from '../../src/domain/dailyLedger.js'
import { dispatchLedgerHttp } from '../ledger/http.js'
import { dispatchExpeditionHttp, type ExpeditionHttpSecurity } from '../expeditions/http.js'
import { dispatchPayoutHttp } from '../payouts/http.js'
import { PAYOUT_CYCLE_PATH } from '../payouts/scheduler.js'
import {
  createDefaultDailyLedger,
  createDefaultPayoutStore,
  createDefaultProofService,
  isOwnedExpeditionPath,
  resolveProductionExpeditionRuntime,
  type ExpeditionRuntime,
} from '../expeditions/proofRuntime.js'

export const PRODUCT_OWNED_PATHS: readonly string[] = [
  DAILY_HUNT_STATUS_PATH,
  WALLET_DAILY_STATUS_PATH,
  START_CHALLENGE_PATH,
  START_EXPEDITION_PATH,
  ACTIVE_EXPEDITION_PATH,
  RECOVER_RUN_SESSION_PATH,
  GAMEPLAY_START_PATH,
  CHECKPOINT_PATH,
  VERIFY_EXPEDITION_PATH,
  ABANDON_EXPEDITION_PATH,
  PRODUCT_VAULT_SEAL_PREPARE_PATH,
  PRODUCT_VAULT_SEAL_VERIFY_PATH,
  PREPARE_REWARD_CLAIM_PATH,
  FINALIZE_REWARD_CLAIM_PATH,
  GET_REWARD_PAYOUT_PATH,
  RECOVER_SESSION_CHALLENGE_PATH,
  RECOVER_SESSION_PATH,
  TREASURE_BANK_PATH,
  MONTHLY_HEROES_PATH,
  WALLET_MONTHLY_STATS_PATH,
]

const PRODUCT_OWNED_SET = new Set(PRODUCT_OWNED_PATHS)

const LEGACY_LEDGER_PATHS: readonly string[] = [
  COMPLETE_EXPEDITION_PATH,
  FAIL_EXPEDITION_PATH,
  RESERVE_REWARD_PATH,
]

const LEGACY_LEDGER_SET = new Set(LEGACY_LEDGER_PATHS)

export function isOwnedProductPath(pathname: string): boolean {
  const path = pathname.split('?')[0] ?? pathname
  return PRODUCT_OWNED_SET.has(path) || LEGACY_LEDGER_SET.has(path)
}

export function isPayoutCyclePath(pathname: string): boolean {
  const path = pathname.split('?')[0] ?? pathname
  return path === PAYOUT_CYCLE_PATH
}

export const PRODUCT_REWRITE_PARAM = '__nimhunt_route' as const

/**
 * Reconstruct the original public product path from the internal URL seen by
 * the stable `/api/product` function after a Vercel rewrite.
 *
 * Vercel rewrite shape (see vercel.json):
 *   source `/api/expeditions/:path*` ->
 *   destination `/api/product?__nimhunt_route=/api/expeditions/:path*`
 * Incoming query (`?runId=abc`) is merged by Vercel, so the function sees e.g.
 *   `/api/product?__nimhunt_route=/api/expeditions/active&runId=abc`
 * and this helper returns `/api/expeditions/active?runId=abc`.
 *
 * Security: the returned path is still validated by `dispatchProductHttp`
 * against PRODUCT_OWNED_PATHS; forged/unknown routes fail closed there.
 * Duplicate conflicting `__nimhunt_route` values fail closed to `/api/product`.
 */
export function resolveRewriteDispatchPath(internalPath: string): string {
  let url: URL
  try {
    url = new URL(internalPath, 'http://localhost')
  } catch {
    return '/api/product'
  }
  const routedValues = url.searchParams.getAll(PRODUCT_REWRITE_PARAM)
  if (routedValues.length === 0) return internalPath
  const first = routedValues[0] ?? ''
  for (const value of routedValues) {
    if (value !== first) return '/api/product'
  }
  const routedPathname = (first.split('?')[0]?.split('#')[0] ?? '').trim()
  if (!routedPathname.startsWith('/api/')) return '/api/product'
  const preserved = new URLSearchParams()
  for (const [key, value] of url.searchParams) {
    if (key === PRODUCT_REWRITE_PARAM) continue
    preserved.append(key, value)
  }
  const suffix = preserved.toString()
  return suffix.length > 0 ? `${routedPathname}?${suffix}` : routedPathname
}

export type ProductHttpRequest = {
  readonly method: string
  readonly path: string
  readonly headers?: Readonly<Record<string, string | undefined>>
  readonly host?: string
  readonly protocol?: 'http' | 'https'
  readonly rawBody?: string
}

export type ProductHttpResponse = {
  readonly status: number
  readonly body: unknown
  readonly headers?: Readonly<Record<string, string>>
}

export async function dispatchProductHttp(
  request: ProductHttpRequest,
  env: Record<string, string | undefined> = process.env,
): Promise<ProductHttpResponse> {
  const pathname = request.path.split('?')[0] ?? request.path

  if (isPayoutCyclePath(pathname)) {
    return { status: 404, body: { ok: false, error: 'MALFORMED_REQUEST' } }
  }

  if (!isOwnedProductPath(pathname) && !isOwnedExpeditionPath(pathname)) {
    return { status: 404, body: { ok: false, error: 'MALFORMED_REQUEST' } }
  }

  const runtime: ExpeditionRuntime = resolveProductionExpeditionRuntime(env)

  if (pathname === GET_REWARD_PAYOUT_PATH) {
    const service = await createDefaultProofService(runtime, env)
    const store = await createDefaultPayoutStore(runtime, env)
    return dispatchPayoutHttp(service, store, {
      method: request.method,
      path: request.path,
      headers: request.headers,
      host: request.host,
      protocol: request.protocol,
      rawBody: request.rawBody,
    }, toSecurity(runtime))
  }

  if (pathname === TREASURE_BANK_PATH) {
    const { dispatchTreasureBankHttp } = await import('../treasureBank/http.js')
    const { createDefaultTreasureBankSource } = await import('../treasureBank/store.js')
    const service = await createDefaultProofService(runtime, env)
    const source = await createDefaultTreasureBankSource(runtime, env)
    return dispatchTreasureBankHttp(service, source, {
      method: request.method,
      path: request.path,
      headers: request.headers,
      host: request.host,
      protocol: request.protocol,
      rawBody: request.rawBody,
    }, toSecurity(runtime), env)
  }

  if (pathname === MONTHLY_HEROES_PATH) {
    const { dispatchMonthlyHeroesHttp } = await import('../monthlyHeroes/http.js')
    const { createDefaultMonthlyHeroesSource } = await import('../monthlyHeroes/store.js')
    const source = await createDefaultMonthlyHeroesSource(runtime, env)
    return dispatchMonthlyHeroesHttp(source, {
      method: request.method,
      path: request.path,
      headers: request.headers,
      host: request.host,
      protocol: request.protocol,
      rawBody: request.rawBody,
    }, toSecurity(runtime))
  }

  if (pathname === WALLET_MONTHLY_STATS_PATH) {
    const { dispatchWalletMonthlyStatsHttp } = await import('../monthlyHeroes/http.js')
    const { createDefaultMonthlyHeroesSource } = await import('../monthlyHeroes/store.js')
    const service = await createDefaultProofService(runtime, env)
    const source = await createDefaultMonthlyHeroesSource(runtime, env)
    return dispatchWalletMonthlyStatsHttp(service, source, {
      method: request.method,
      path: request.path,
      headers: request.headers,
      host: request.host,
      protocol: request.protocol,
      rawBody: request.rawBody,
    }, toSecurity(runtime))
  }

  if (isOwnedExpeditionPath(pathname)) {
    const service = await createDefaultProofService(runtime, env)
    return dispatchExpeditionHttp(service, {
      method: request.method,
      path: request.path,
      headers: request.headers,
      host: request.host,
      protocol: request.protocol,
      rawBody: request.rawBody,
    }, toSecurity(runtime))
  }

  const ledger = await createDefaultDailyLedger(env)
  return dispatchLedgerHttp(ledger, {
    method: request.method,
    path: request.path,
    rawBody: request.rawBody,
  })
}

function toSecurity(runtime: ExpeditionRuntime): ExpeditionHttpSecurity {
  return {
    expectedOrigin: runtime.expectedOrigin,
    expectedHost: runtime.expectedHost,
    expectedProtocol: runtime.expectedProtocol,
    secureCookie: runtime.secureCookie,
    allowAuthorizedLocalHttpOrigins: runtime.allowAuthorizedLocalHttpOrigins,
  }
}

export function readVercelHost(headers: Record<string, string | undefined>, fallback?: string): string | undefined {
  const forwardedHost = headers['x-forwarded-host']
  if (typeof forwardedHost === 'string' && forwardedHost.length > 0) {
    return forwardedHost.split(',')[0]?.trim()
  }
  const host = headers['host'] ?? fallback
  return typeof host === 'string' && host.length > 0 ? host : undefined
}

export function readVercelProtocol(
  headers: Record<string, string | undefined>,
  socketEncrypted: boolean,
): 'http' | 'https' | undefined {
  const forwardedProto = headers['x-forwarded-proto']
  if (typeof forwardedProto === 'string' && forwardedProto.length > 0) {
    const first = forwardedProto.split(',')[0]?.trim().toLowerCase()
    if (first === 'https' || first === 'http') return first
  }
  const forwardedSsl = headers['x-forwarded-ssl']
  if (typeof forwardedSsl === 'string' && forwardedSsl.toLowerCase() === 'on') return 'https'
  if (socketEncrypted) return 'https'
  const protocolHeader = headers['protocol']
  if (protocolHeader === 'http' || protocolHeader === 'https') return protocolHeader
  return undefined
}

export function readVercelHeaders(raw: Record<string, string | string[] | undefined>): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {}
  for (const [key, value] of Object.entries(raw)) {
    const lower = key.toLowerCase()
    if (typeof value === 'string') out[lower] = value
    else if (Array.isArray(value)) out[lower] = value[0]
    else out[lower] = undefined
  }
  return out
}

export async function readVercelRawBody(
  req: {
    readonly method?: string
    readonly headers: Record<string, string | string[] | undefined>
    on(event: 'data', listener: (chunk: Buffer) => void): unknown
    on(event: 'end', listener: () => void): unknown
    on(event: 'error', listener: (error: Error) => void): unknown
  } & { readonly body?: unknown },
  maxBytes = 16 * 1024,
): Promise<string | undefined> {
  const method = (req.method ?? 'GET').toUpperCase()
  if (method === 'GET' || method === 'OPTIONS' || method === 'HEAD') return undefined

  const parsed = (req as { readonly body?: unknown }).body
  if (parsed !== undefined) {
    if (typeof parsed === 'string') return parsed
    if (Buffer.isBuffer(parsed)) {
      if (parsed.length > maxBytes) throw new Error('REQUEST_TOO_LARGE')
      return parsed.toString('utf8')
    }
    if (typeof parsed === 'object' && parsed !== null) {
      const text = JSON.stringify(parsed)
      if (Buffer.byteLength(text, 'utf8') > maxBytes) throw new Error('REQUEST_TOO_LARGE')
      return text
    }
  }

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > maxBytes) {
        reject(new Error('REQUEST_TOO_LARGE'))
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}
