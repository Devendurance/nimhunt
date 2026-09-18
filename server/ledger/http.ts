import {
  ABANDON_EXPEDITION_PATH,
  COMPLETE_EXPEDITION_PATH,
  DAILY_HUNT_STATUS_PATH,
  FAIL_EXPEDITION_PATH,
  RESERVE_REWARD_PATH,
  START_EXPEDITION_PATH,
  WALLET_DAILY_STATUS_PATH,
  type LedgerErrorCode,
} from '../../src/domain/dailyLedger.js'
import { isLedgerError, LedgerError } from './errors.js'
import type { DailyLedger } from './types.js'

export const MAX_LEDGER_BODY_BYTES = 12_288

export type LedgerHttpRequest = {
  method: string
  path: string
  body?: unknown
  rawBody?: string
}

export type LedgerHttpResponse = {
  status: number
  body: unknown
}

const WRITE_PATHS = new Set([
  START_EXPEDITION_PATH,
  COMPLETE_EXPEDITION_PATH,
  FAIL_EXPEDITION_PATH,
  ABANDON_EXPEDITION_PATH,
  RESERVE_REWARD_PATH,
  WALLET_DAILY_STATUS_PATH,
])

export async function dispatchLedgerHttp(
  ledger: DailyLedger | null,
  request: LedgerHttpRequest,
): Promise<LedgerHttpResponse> {
  const method = request.method.toUpperCase()
  const path = request.path.split('?')[0] ?? request.path

  if (request.rawBody !== undefined && Buffer.byteLength(request.rawBody, 'utf8') > MAX_LEDGER_BODY_BYTES) {
    return { status: 413, body: { ok: false, error: 'MALFORMED_REQUEST' } }
  }

  if (path === DAILY_HUNT_STATUS_PATH) {
    if (method === 'OPTIONS') return { status: 204, body: null }
    if (method !== 'GET') return methodNotAllowed()
    return withLedger(ledger, async active => {
      const status = await active.getDailyHuntStatus()
      return { status: 200, body: { ok: true, ...status } }
    })
  }

  if (!WRITE_PATHS.has(path)) {
    return { status: 404, body: { ok: false, error: 'MALFORMED_REQUEST' } }
  }

  if (method === 'OPTIONS') return { status: 204, body: null }
  if (method !== 'POST') return methodNotAllowed()

  return withLedger(ledger, async active => {
    const body = readJsonBody(request)
    if (path === START_EXPEDITION_PATH) {
      const started = await active.startExpedition(asString(body.wallet), asString(body.missionType))
      return { status: 200, body: { ok: true, ...started } }
    }
    if (path === WALLET_DAILY_STATUS_PATH) {
      const status = await active.getWalletDailyStatus(asString(body.wallet))
      return { status: 200, body: { ok: true, ...status } }
    }
    if (path === COMPLETE_EXPEDITION_PATH) {
      const run = await active.completeRun(asString(body.runId), asString(body.wallet))
      return { status: 200, body: { ok: true, run } }
    }
    if (path === FAIL_EXPEDITION_PATH) {
      const run = await active.failRun(asString(body.runId), asString(body.wallet))
      return { status: 200, body: { ok: true, run } }
    }
    if (path === ABANDON_EXPEDITION_PATH) {
      const run = await active.abandonRun(asString(body.runId), asString(body.wallet))
      return { status: 200, body: { ok: true, run } }
    }
    const reserved = await active.reserveDailyReward(asString(body.runId), asString(body.wallet))
    return { status: 200, body: { ok: true, ...reserved } }
  })
}

async function withLedger(
  ledger: DailyLedger | null,
  fn: (ledger: DailyLedger) => Promise<LedgerHttpResponse>,
): Promise<LedgerHttpResponse> {
  if (!ledger) {
    return { status: 503, body: { ok: false, error: 'LEDGER_UNAVAILABLE' } }
  }
  try {
    return await fn(ledger)
  } catch (error) {
    if (isLedgerError(error)) return { status: statusFor(error.code), body: { ok: false, error: error.code } }
    if (error instanceof SyntaxError) {
      return { status: 400, body: { ok: false, error: 'MALFORMED_REQUEST' } }
    }
    throw error
  }
}

function readJsonBody(request: LedgerHttpRequest): Record<string, unknown> {
  if (request.rawBody !== undefined) {
    if (request.rawBody.length === 0) throw new LedgerError('MALFORMED_REQUEST')
    const parsed: unknown = JSON.parse(request.rawBody)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new LedgerError('MALFORMED_REQUEST')
    }
    return parsed as Record<string, unknown>
  }
  if (typeof request.body !== 'object' || request.body === null || Array.isArray(request.body)) {
    throw new LedgerError('MALFORMED_REQUEST')
  }
  return request.body as Record<string, unknown>
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function methodNotAllowed(): LedgerHttpResponse {
  return { status: 405, body: { ok: false, error: 'MALFORMED_REQUEST' } }
}

function statusFor(code: LedgerErrorCode): number {
  if (code === 'LEDGER_UNAVAILABLE') return 503
  if (code === 'RUN_NOT_FOUND') return 404
  if (code === 'DAILY_EXPEDITION_LIMIT_REACHED' || code === 'SOLD_OUT' || code === 'ALREADY_REWARDED' || code === 'INVALID_RUN_TRANSITION') {
    return 409
  }
  if (code === 'WALLET_MISMATCH' || code === 'RUN_NOT_COMPLETED') return 409
  return 400
}
