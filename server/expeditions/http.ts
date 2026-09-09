import { START_CHALLENGE_PATH, START_EXPEDITION_PATH } from '../../src/domain/expeditionProof.ts'
import { ProofError, isProofError } from './errors.ts'
import { parseStartPayload, type SignedStartRequest } from './canonical.ts'
import { serializeRunSessionCookie } from './session.ts'
import type { MemoryProofService } from './types.ts'

export const MAX_EXPEDITION_BODY_BYTES = 16 * 1024

export type ExpeditionHttpRequest = {
  readonly method: string
  readonly path: string
  readonly body?: unknown
  readonly rawBody?: string
}

export type ExpeditionHttpResponse = {
  readonly status: number
  readonly body: unknown
  readonly headers?: Readonly<Record<string, string>>
}

export async function dispatchExpeditionHttp(
  service: MemoryProofService | null,
  request: ExpeditionHttpRequest,
): Promise<ExpeditionHttpResponse> {
  const method = request.method.toUpperCase()
  const path = request.path.split('?')[0] ?? request.path
  const headers = {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
    'x-content-type-options': 'nosniff',
  }

  if (request.rawBody !== undefined && Buffer.byteLength(request.rawBody, 'utf8') > MAX_EXPEDITION_BODY_BYTES) {
    return { status: 413, body: { ok: false, error: 'MALFORMED_REQUEST' }, headers }
  }
  if (path !== START_CHALLENGE_PATH && path !== START_EXPEDITION_PATH) {
    return { status: 404, body: { ok: false, error: 'MALFORMED_REQUEST' }, headers }
  }
  if (method === 'OPTIONS') return { status: 204, body: null, headers }
  if (method !== 'POST') return { status: 405, body: { ok: false, error: 'MALFORMED_REQUEST' }, headers }
  if (!service) return { status: 503, body: { ok: false, error: 'PROOF_UNAVAILABLE' }, headers }

  try {
    const body = readJsonBody(request)
    if (path === START_CHALLENGE_PATH) {
      const challenge = await service.issueStartChallenge(asString(body.wallet), asMission(body.mission))
      return { status: 200, body: { ok: true, ...challenge }, headers }
    }

    const signed = readSignedStart(body)
    if (!parseStartPayload(signed.payload)) throw new ProofError('START_CHALLENGE_INVALID')
    const started = await service.authorizeStart(signed)
    return {
      status: 200,
      body: { ok: true, outcome: started.outcome, ...started.start },
      headers: {
        ...headers,
        'set-cookie': serializeRunSessionCookie(
          started.sessionCapability,
          new Date(started.session.expiresAt),
          new Date(started.session.createdAt),
        ),
      },
    }
  } catch (error) {
    if (isProofError(error)) return { status: statusFor(error.code), body: { ok: false, error: error.code }, headers }
    if (error instanceof SyntaxError) return { status: 400, body: { ok: false, error: 'MALFORMED_REQUEST' }, headers }
    return { status: 400, body: { ok: false, error: 'MALFORMED_REQUEST' }, headers }
  }
}

function readJsonBody(request: ExpeditionHttpRequest): Record<string, unknown> {
  if (request.rawBody !== undefined) {
    if (request.rawBody.length === 0) throw new ProofError('START_CHALLENGE_INVALID')
    const parsed: unknown = JSON.parse(request.rawBody)
    if (!isRecord(parsed)) throw new ProofError('START_CHALLENGE_INVALID')
    return parsed
  }
  if (!isRecord(request.body)) throw new ProofError('START_CHALLENGE_INVALID')
  return request.body
}

function readSignedStart(body: Record<string, unknown>): SignedStartRequest {
  if (!isBoundedString(body.payload, 4_096) || !isBoundedString(body.publicKey, 130) || !isBoundedString(body.signature, 258)) {
    throw new ProofError('START_CHALLENGE_INVALID')
  }
  return { payload: body.payload, publicKey: body.publicKey, signature: body.signature }
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function asMission(value: unknown): 'gem-runner' | 'chest-hunter' | 'vault-breaker' {
  if (value === 'gem-runner' || value === 'chest-hunter' || value === 'vault-breaker') return value
  throw new ProofError('START_CHALLENGE_INVALID')
}

function isBoundedString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function statusFor(code: string): number {
  if (code === 'PROOF_UNAVAILABLE' || code === 'DAILY_BLUEPRINT_UNAVAILABLE') return 503
  if (code === 'DAILY_EXPEDITION_LIMIT_REACHED' || code === 'START_CHALLENGE_EXPIRED' || code === 'START_CHALLENGE_DAY_EXPIRED') return 409
  return 400
}
