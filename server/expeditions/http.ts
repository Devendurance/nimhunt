import { ABANDON_EXPEDITION_PATH, ACTIVE_EXPEDITION_PATH, CHECKPOINT_PATH, FINALIZE_REWARD_CLAIM_PATH, GAMEPLAY_START_PATH, PREPARE_REWARD_CLAIM_PATH, PRODUCT_VAULT_SEAL_PREPARE_PATH, PRODUCT_VAULT_SEAL_VERIFY_PATH, START_CHALLENGE_PATH, START_EXPEDITION_PATH, VERIFY_EXPEDITION_PATH } from '../../src/domain/expeditionProof.ts'
import type { MoveAction } from '../../src/game/replay/types.ts'
import { MAX_CHECKPOINT_BATCH_ACTIONS } from '../../src/game/replay/versions.ts'
import { WALLET_DAILY_STATUS_PATH } from '../../src/domain/dailyLedger.ts'
import { ProofError, isProofError } from './errors.ts'
import { parseStartPayload, type SignedStartRequest } from './canonical.ts'
import { parseRunSessionCookie, serializeRunSessionCookie, type RunSessionRecord } from './session.ts'
import type { ExpeditionProofService } from './types.ts'

export const MAX_EXPEDITION_BODY_BYTES = 16 * 1024

export type ExpeditionHttpRequest = {
  readonly method: string
  readonly path: string
  readonly headers?: Readonly<Record<string, string | undefined>>
  readonly host?: string
  readonly protocol?: 'http' | 'https'
  readonly body?: unknown
  readonly rawBody?: string
}

export type ExpeditionHttpSecurity = {
  readonly expectedOrigin: string
  readonly expectedHost: string
  readonly expectedProtocol: 'http' | 'https'
  readonly secureCookie: boolean
  readonly allowAuthorizedLocalHttpOrigins?: boolean
}

export type ExpeditionHttpResponse = {
  readonly status: number
  readonly body: unknown
  readonly headers?: Readonly<Record<string, string>>
}

const BASE_HEADERS = {
  'cache-control': 'no-store',
  'content-type': 'application/json; charset=utf-8',
  'x-content-type-options': 'nosniff',
}

export async function dispatchExpeditionHttp(
  service: ExpeditionProofService | null,
  request: ExpeditionHttpRequest,
  security: ExpeditionHttpSecurity,
): Promise<ExpeditionHttpResponse> {
  const pathHint = request.path.split('?')[0] ?? ''
  if (!security.expectedOrigin || !security.expectedHost) {
    return isExpeditionPath(pathHint)
      ? response(503, { ok: false, error: 'PROOF_UNAVAILABLE' })
      : response(400, { ok: false, error: 'MALFORMED_REQUEST' })
  }

  const url = parseRequestUrl(request.path, security.expectedOrigin)
  if (!url) return response(400, { ok: false, error: 'MALFORMED_REQUEST' })

  const path = url.pathname
  if (!isExpeditionPath(path)) return response(404, { ok: false, error: 'MALFORMED_REQUEST' })
  if (!service) return response(503, { ok: false, error: 'PROOF_UNAVAILABLE' })
  if (!isAllowedRequest(request, path, security)) return response(400, { ok: false, error: 'MALFORMED_REQUEST' })

  if (request.rawBody !== undefined && Buffer.byteLength(request.rawBody, 'utf8') > MAX_EXPEDITION_BODY_BYTES) {
    return response(413, { ok: false, error: 'MALFORMED_REQUEST' })
  }

  const method = request.method.toUpperCase()
  if (method === 'OPTIONS') return { status: 204, body: null, headers: BASE_HEADERS }
  if (!isExpectedMethod(path, method)) return response(405, { ok: false, error: 'MALFORMED_REQUEST' })
  if (method === 'POST' && !isJsonRequest(request)) return response(400, { ok: false, error: 'MALFORMED_REQUEST' })

  try {
    if (path === START_CHALLENGE_PATH) {
      const body = readChallengeRequest(readJsonBody(request))
      const challenge = await service.issueStartChallenge(body.wallet, body.mission)
      return response(200, { ok: true, ...challenge })
    }

    if (path === WALLET_DAILY_STATUS_PATH) {
      const body = readWalletDailyStatusRequest(readJsonBody(request))
      const status = await service.getWalletDailyStatus(body.wallet)
      return response(200, { ok: true, ...status })
    }

    if (path === START_EXPEDITION_PATH) {
      const signed = readSignedStart(readJsonBody(request))
      if (!parseStartPayload(signed.payload)) throw new ProofError('START_CHALLENGE_INVALID')
      const started = await service.authorizeStart(signed)
      return {
        ...response(200, { ok: true, outcome: started.outcome, ...started.start }),
        headers: {
          ...BASE_HEADERS,
          'set-cookie': serializeRunSessionCookie(
            started.sessionCapability,
            new Date(started.session.expiresAt),
            new Date(started.session.createdAt),
            security.secureCookie,
          ),
        },
      }
    }

    if (path === ACTIVE_EXPEDITION_PATH) {
      const runId = readActiveRunId(url)
      const session = await authenticateSession(service, request)
      const active = await service.getActiveExpedition(runId, session)
      return response(200, { ok: true, ...active })
    }

    if (path === GAMEPLAY_START_PATH) {
      const session = await authenticateSession(service, request)
      const runId = readGameplayStartRequest(readJsonBody(request)).runId
      const gameplayStart = await service.markGameplayStarted(runId, session)
      return response(200, { ok: true, ...gameplayStart })
    }

    if (path === CHECKPOINT_PATH) {
      const session = await authenticateSession(service, request)
      const checkpointRequest = readCheckpointRequest(readJsonBody(request))
      const acknowledgement = await service.appendCheckpoint({
        runId: checkpointRequest.runId,
        session,
        previousCheckpointHash: checkpointRequest.previousCheckpointHash,
        actions: checkpointRequest.actions,
      })
      return response(200, { ok: true, ...acknowledgement })
    }

    if (path === VERIFY_EXPEDITION_PATH) {
      const session = await authenticateSession(service, request)
      const locator = readRunLocatorRequest(readJsonBody(request))
      const verified = await service.verifyExpedition({
        runId: locator.runId,
        session,
        checkpointHash: locator.checkpointHash,
      })
      return response(200, { ok: true, ...verified })
    }

    if (path === ABANDON_EXPEDITION_PATH) {
      const session = await authenticateSession(service, request)
      const locator = readRunLocatorRequest(readJsonBody(request))
      const abandoned = await service.abandonExpedition({
        runId: locator.runId,
        session,
        checkpointHash: locator.checkpointHash,
      })
      return response(200, { ok: true, ...abandoned })
    }

    if (path === PRODUCT_VAULT_SEAL_PREPARE_PATH) {
      const session = await authenticateSession(service, request)
      const runId = readGameplayStartRequest(readJsonBody(request)).runId
      const prepared = await service.prepareVaultSeal(runId, session)
      return response(200, { ok: true, ...prepared })
    }

    if (path === PRODUCT_VAULT_SEAL_VERIFY_PATH) {
      const session = await authenticateSession(service, request)
      const signed = readSignedVaultSeal(readJsonBody(request))
      const verified = await service.verifyVaultSeal({
        session,
        payload: signed.payload,
        publicKey: signed.publicKey,
        signature: signed.signature,
      })
      return response(200, { ok: true, ...verified })
    }

    if (path === PREPARE_REWARD_CLAIM_PATH) {
      const session = await authenticateSession(service, request)
      const runId = readGameplayStartRequest(readJsonBody(request)).runId
      const prepared = await service.prepareRewardClaim(runId, session)
      return response(200, { ok: true, ...prepared })
    }

    if (path === FINALIZE_REWARD_CLAIM_PATH) {
      const session = await authenticateSession(service, request)
      const signed = readSignedRewardClaim(readJsonBody(request))
      const finalized = await service.finalizeRewardClaim({
        session,
        claimId: signed.claimId,
        payload: signed.payload,
        publicKey: signed.publicKey,
        signature: signed.signature,
      })
      return response(200, { ok: true, ...finalized })
    }

    return response(404, { ok: false, error: 'MALFORMED_REQUEST' })
  } catch (error) {
    if (isProofError(error)) return response(statusFor(error.code), { ok: false, error: publicErrorCode(error.code) })
    if (error instanceof SyntaxError) return response(400, { ok: false, error: 'MALFORMED_REQUEST' })
    return response(400, { ok: false, error: 'MALFORMED_REQUEST' })
  }
}

function parseRequestUrl(path: string, expectedOrigin: string): URL | null {
  if (!path.startsWith('/')) return null
  try {
    return new URL(path, expectedOrigin)
  } catch {
    return null
  }
}

function isExpeditionPath(path: string): boolean {
  return path === START_CHALLENGE_PATH
    || path === START_EXPEDITION_PATH
    || path === ACTIVE_EXPEDITION_PATH
    || path === GAMEPLAY_START_PATH
    || path === CHECKPOINT_PATH
    || path === VERIFY_EXPEDITION_PATH
    || path === ABANDON_EXPEDITION_PATH
    || path === PRODUCT_VAULT_SEAL_PREPARE_PATH
    || path === PRODUCT_VAULT_SEAL_VERIFY_PATH
    || path === PREPARE_REWARD_CLAIM_PATH
    || path === FINALIZE_REWARD_CLAIM_PATH
    || path === WALLET_DAILY_STATUS_PATH
}

function isExpectedMethod(path: string, method: string): boolean {
  return path === ACTIVE_EXPEDITION_PATH ? method === 'GET' : method === 'POST'
}

function isAllowedRequest(request: ExpeditionHttpRequest, path: string, security: ExpeditionHttpSecurity): boolean {
  const host = request.host ?? getHeader(request, 'host')
  const protocol = request.protocol ?? getProtocolHeader(request)
  const origin = getHeader(request, 'origin')
  const isRead = path === ACTIVE_EXPEDITION_PATH && request.method.toUpperCase() === 'GET'
  if (!host || !protocol) return false

  if (host === security.expectedHost && protocol === security.expectedProtocol) {
    return isRead ? origin === undefined || origin === security.expectedOrigin : origin === security.expectedOrigin
  }

  return isAuthorizedLocalHttpAlias(host, protocol, origin, isRead, security)
}

function isAuthorizedLocalHttpAlias(
  host: string,
  protocol: 'http' | 'https',
  origin: string | undefined,
  isRead: boolean,
  security: ExpeditionHttpSecurity,
): boolean {
  if (!security.allowAuthorizedLocalHttpOrigins || protocol !== 'http' || security.expectedProtocol !== 'http') return false
  if (hostPort(host) !== hostPort(security.expectedHost) || !isLocalHttpHost(host)) return false
  if (isRead && origin === undefined) return true
  const parsed = parseOriginHeader(origin)
  return parsed !== null && parsed.protocol === 'http' && parsed.host === host && isLocalHttpHost(parsed.host)
}

function parseOriginHeader(origin: string | undefined): { host: string; protocol: 'http' | 'https' } | null {
  if (!origin) return null
  try {
    const parsed = new URL(origin)
    if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || parsed.origin !== origin.replace(/\/$/, '')) return null
    return { host: parsed.host, protocol: parsed.protocol === 'https:' ? 'https' : 'http' }
  } catch {
    return null
  }
}

function isLocalHttpHost(host: string): boolean {
  return isLoopbackHost(host) || isPrivateIpv4Host(host)
}

function isLoopbackHost(host: string): boolean {
  const hostname = host.split(':')[0]?.replace('[', '').replace(']', '')
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
}

function isPrivateIpv4Host(host: string): boolean {
  const hostname = host.split(':')[0] ?? ''
  const octets = hostname.split('.').map(Number)
  if (octets.length !== 4 || octets.some(octet => !Number.isInteger(octet) || octet < 0 || octet > 255)) return false
  return octets[0] === 10
    || (octets[0] === 172 && (octets[1] ?? -1) >= 16 && (octets[1] ?? -1) <= 31)
    || (octets[0] === 192 && octets[1] === 168)
}

function hostPort(host: string): string {
  const index = host.lastIndexOf(':')
  if (index <= 0 || host.endsWith(']')) return ''
  return host.slice(index + 1)
}

function isJsonRequest(request: ExpeditionHttpRequest): boolean {
  const contentType = getHeader(request, 'content-type')
  return contentType?.split(';', 1)[0]?.trim().toLowerCase() === 'application/json'
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

function readChallengeRequest(body: Record<string, unknown>): { wallet: string; mission: 'gem-runner' | 'chest-hunter' | 'vault-breaker' } {
  requireExactKeys(body, ['wallet', 'mission'])
  if (!isBoundedString(body.wallet, 80)) throw new ProofError('START_CHALLENGE_INVALID')
  return { wallet: body.wallet, mission: asMission(body.mission) }
}

function readSignedStart(body: Record<string, unknown>): SignedStartRequest {
  requireExactKeys(body, ['payload', 'publicKey', 'signature'])
  if (!isBoundedString(body.payload, 4_096) || !isBoundedString(body.publicKey, 130) || !isBoundedString(body.signature, 258)) {
    throw new ProofError('START_CHALLENGE_INVALID')
  }
  return { payload: body.payload, publicKey: body.publicKey, signature: body.signature }
}

function readSignedVaultSeal(body: Record<string, unknown>): SignedStartRequest {
  const keys = Object.keys(body)
  if (keys.length !== 3 || !keys.includes('payload') || !keys.includes('publicKey') || !keys.includes('signature')) {
    throw new ProofError('MALFORMED_REQUEST')
  }
  if (!isBoundedString(body.payload, 4_096) || !isBoundedString(body.publicKey, 130) || !isBoundedString(body.signature, 258)) {
    throw new ProofError('MALFORMED_REQUEST')
  }
  return { payload: body.payload, publicKey: body.publicKey, signature: body.signature }
}

function readSignedRewardClaim(body: Record<string, unknown>): SignedStartRequest & { claimId: string } {
  const keys = Object.keys(body)
  if (keys.length !== 4 || !keys.includes('claimId') || !keys.includes('payload') || !keys.includes('publicKey') || !keys.includes('signature')) {
    throw new ProofError('MALFORMED_REQUEST')
  }
  if (!isBoundedString(body.claimId, 128) || !isBoundedString(body.payload, 4_096) || !isBoundedString(body.publicKey, 130) || !isBoundedString(body.signature, 258)) {
    throw new ProofError('MALFORMED_REQUEST')
  }
  return { claimId: body.claimId, payload: body.payload, publicKey: body.publicKey, signature: body.signature }
}

function readGameplayStartRequest(body: Record<string, unknown>): { runId: string } {
  requireExactKeys(body, ['runId'])
  if (!isBoundedString(body.runId, 128)) throw new ProofError('START_CHALLENGE_INVALID')
  return { runId: body.runId }
}

function readRunLocatorRequest(body: Record<string, unknown>): {
  runId: string
  checkpointHash: string
} {
  const keys = Object.keys(body)
  if (keys.length !== 2 || !keys.includes('runId') || !keys.includes('checkpointHash')) {
    throw new ProofError('MALFORMED_REQUEST')
  }
  if (!isBoundedString(body.runId, 128) || !isHash(body.checkpointHash)) {
    throw new ProofError('MALFORMED_REQUEST')
  }
  return { runId: body.runId, checkpointHash: body.checkpointHash }
}

function readCheckpointRequest(body: Record<string, unknown>): {
  runId: string
  previousCheckpointHash: string
  actions: readonly MoveAction[]
} {
  const keys = Object.keys(body)
  if (keys.length !== 3 || !keys.includes('runId') || !keys.includes('previousCheckpointHash') || !keys.includes('actions')) {
    throw new ProofError('MALFORMED_REQUEST')
  }
  if (!isBoundedString(body.runId, 128) || !isHash(body.previousCheckpointHash) || !Array.isArray(body.actions)) {
    throw new ProofError('MALFORMED_REQUEST')
  }
  if (body.actions.length === 0 || body.actions.length > MAX_CHECKPOINT_BATCH_ACTIONS) {
    throw new ProofError('MALFORMED_REQUEST')
  }
  return {
    runId: body.runId,
    previousCheckpointHash: body.previousCheckpointHash,
    actions: body.actions.map(readCheckpointAction),
  }
}

function readCheckpointAction(value: unknown): MoveAction {
  if (!isRecord(value)) throw new ProofError('MALFORMED_REQUEST')
  const keys = Object.keys(value)
  if (keys.length !== 3 || !keys.includes('seq') || !keys.includes('type') || !keys.includes('direction')) {
    throw new ProofError('MALFORMED_REQUEST')
  }
  if (typeof value.seq !== 'number' || !Number.isInteger(value.seq) || value.seq < 1) throw new ProofError('INVALID_SEQUENCE')
  if (value.type !== 'MOVE') throw new ProofError('INVALID_ACTION')
  if (value.direction !== 'UP' && value.direction !== 'DOWN' && value.direction !== 'LEFT' && value.direction !== 'RIGHT') {
    throw new ProofError('INVALID_ACTION')
  }
  return { seq: value.seq, type: 'MOVE', direction: value.direction }
}

function isHash(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)
}

function readWalletDailyStatusRequest(body: Record<string, unknown>): { wallet: string } {
  requireExactKeys(body, ['wallet'])
  if (!isBoundedString(body.wallet, 80)) throw new ProofError('START_CHALLENGE_INVALID')
  return { wallet: body.wallet }
}

function readActiveRunId(url: URL): string {
  const entries = [...url.searchParams.entries()]
  if (entries.length !== 1 || entries[0]?.[0] !== 'runId' || !isBoundedString(entries[0][1], 128)) {
    throw new ProofError('START_CHALLENGE_INVALID')
  }
  return entries[0][1]
}

function requireExactKeys(body: Record<string, unknown>, expected: readonly string[]): void {
  const keys = Object.keys(body)
  if (keys.length !== expected.length || expected.some(key => !keys.includes(key))) {
    throw new ProofError('START_CHALLENGE_INVALID')
  }
}

async function authenticateSession(service: ExpeditionProofService, request: ExpeditionHttpRequest): Promise<RunSessionRecord> {
  const raw = parseRunSessionCookie(getHeader(request, 'cookie'))
  if (!raw) throw new ProofError('RUN_SESSION_INVALID')
  try {
    return await service.authenticateSession(raw)
  } catch (error) {
    if (isProofError(error) && (error.code === 'INVALID_SESSION' || error.code === 'SESSION_EXPIRED' || error.code === 'SESSION_REVOKED')) {
      throw new ProofError('RUN_SESSION_INVALID')
    }
    throw error
  }
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
  if (code === 'RUN_SESSION_INVALID') return 401
  if (code === 'ACTIVE_RUN_UNAVAILABLE' || code === 'CHECKPOINT_MISMATCH' || code === 'PROOF_LOST' || code === 'RUN_NOT_ACTIVE' || code === 'RUN_INCOMPLETE' || code === 'CLAIM_WINDOW_EXPIRED') return 409
  if (code === 'DAILY_EXPEDITION_LIMIT_REACHED' || code === 'START_CHALLENGE_EXPIRED' || code === 'START_CHALLENGE_DAY_EXPIRED') return 409
  return 400
}

function publicErrorCode(code: string): string {
  if (code === 'INVALID_SESSION' || code === 'SESSION_EXPIRED' || code === 'SESSION_REVOKED') return 'RUN_SESSION_INVALID'
  return code
}

function response(status: number, body: unknown): ExpeditionHttpResponse {
  return { status, body, headers: BASE_HEADERS }
}
