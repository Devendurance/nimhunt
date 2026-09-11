import type { IncomingMessage, ServerResponse } from 'node:http'
import { loadEnv, type Plugin } from 'vite'
import { WALLET_DAILY_STATUS_PATH } from '../../src/domain/dailyLedger.ts'
import {
  ACTIVE_EXPEDITION_PATH,
  CHECKPOINT_PATH,
  GAMEPLAY_START_PATH,
  START_CHALLENGE_PATH,
  START_EXPEDITION_PATH,
} from '../../src/domain/expeditionProof.ts'
import { createLazyValue, type LazyValue } from './lazyValue.ts'
import type { MemoryProofService } from './types.ts'

const OWNED_EXPEDITION_PATHS = new Set([
  START_CHALLENGE_PATH,
  START_EXPEDITION_PATH,
  ACTIVE_EXPEDITION_PATH,
  GAMEPLAY_START_PATH,
  CHECKPOINT_PATH,
  WALLET_DAILY_STATUS_PATH,
])

export function isOwnedExpeditionPath(path: string): boolean {
  return OWNED_EXPEDITION_PATHS.has(path)
}

export type ExpeditionRuntimeInput = {
  readonly mode: string
  readonly backend: string | undefined
  readonly appOrigin: string | undefined
}

export type ExpeditionRuntime = {
  readonly backend: 'memory' | 'unavailable'
  readonly appOrigin: string
  readonly expectedOrigin: string
  readonly expectedHost: string
  readonly expectedProtocol: 'http' | 'https'
  readonly secureCookie: boolean
  readonly allowAuthorizedLocalHttpOrigins: boolean
}

const UNAVAILABLE_RUNTIME: ExpeditionRuntime = {
  backend: 'unavailable',
  appOrigin: '',
  expectedOrigin: '',
  expectedHost: '',
  expectedProtocol: 'https',
  secureCookie: true,
  allowAuthorizedLocalHttpOrigins: false,
}

export function resolveExpeditionRuntime(input: ExpeditionRuntimeInput): ExpeditionRuntime {
  const origin = parseOrigin(input.appOrigin)
  if (!origin) return UNAVAILABLE_RUNTIME

  const enabled = input.backend === 'memory' && (input.mode === 'development' || input.mode === 'test')

  return {
    backend: enabled ? 'memory' : 'unavailable',
    appOrigin: origin.origin,
    expectedOrigin: origin.origin,
    expectedHost: origin.host,
    expectedProtocol: origin.protocol,
    secureCookie: enabled ? !isAuthorizedHttpOrigin(origin, input.mode) : true,
    allowAuthorizedLocalHttpOrigins: enabled && origin.protocol === 'http' && isAuthorizedHttpOrigin(origin, input.mode),
  }
}

export function createProofBackendLoader(
  getRuntime: () => ExpeditionRuntime,
  createService: () => MemoryProofService | Promise<MemoryProofService> = createDevelopmentMemoryProofService,
): LazyValue<MemoryProofService | null> {
  return createLazyValue(async () => {
    if (getRuntime().backend !== 'memory') return null
    return createService()
  })
}

export async function createDevelopmentMemoryProofService(): Promise<MemoryProofService> {
  const { utcDayKey } = await import('../ledger/utcDay.ts')
  const { createPublishedBootstrapBlueprints } = await import('./blueprintBootstrap.ts')
  const { createMemoryProofService } = await import('./memoryProofStore.ts')
  return createMemoryProofService({
    blueprints: createPublishedBootstrapBlueprints(utcDayKey(new Date())),
  })
}

export function expeditionProofPlugin(): Plugin {
  let runtime = UNAVAILABLE_RUNTIME
  const backend = createProofBackendLoader(() => runtime)

  return {
    name: 'nimhunt-expedition-proof',
    config(_, { mode }) {
      const env = loadEnv(mode, process.cwd(), '')
      runtime = resolveExpeditionRuntime({
        mode,
        backend: env.NIMHUNT_PROOF_BACKEND,
        appOrigin: env.NIMHUNT_APP_ORIGIN,
      })
    },
    configureServer(server) {
      server.middlewares.use(createHandler(() => backend.ensure(), () => runtime))
    },
    configurePreviewServer(server) {
      server.middlewares.use(createHandler(async () => null, () => runtime))
    },
  }
}

function createHandler(
  getService: () => MemoryProofService | null | Promise<MemoryProofService | null>,
  getRuntime: () => ExpeditionRuntime,
) {
  let dispatch: typeof import('./http.ts').dispatchExpeditionHttp | undefined
  return async (req: IncomingMessage, res: ServerResponse, next: () => void): Promise<void> => {
    const path = req.url?.split('?')[0] ?? ''
    if (!isOwnedExpeditionPath(path)) {
      next()
      return
    }

    const runtime = getRuntime()
    try {
      const rawBody = req.method === 'GET' || req.method === 'OPTIONS' ? undefined : await readBody(req)
      if (!dispatch) ({ dispatchExpeditionHttp: dispatch } = await import('./http.ts'))
      const service = await getService()
      const response = await dispatch(service, {
        method: req.method ?? 'GET',
        path: req.url ?? path,
        headers: readHeaders(req),
        host: req.headers.host,
        protocol: isTlsRequest(req) ? 'https' : 'http',
        rawBody,
      }, runtime)
      traceStartChallengeHttp(path, req, runtime, response, service)
      traceCheckpointHttp(path, req, runtime, response, service, rawBody)
      writeJson(res, response.status, response.body, response.headers)
    } catch (error) {
      const tooLarge = error instanceof Error && error.message === 'REQUEST_TOO_LARGE'
      writeJson(res, tooLarge ? 413 : 400, { ok: false, error: 'MALFORMED_REQUEST' }, {
        'cache-control': 'no-store',
        'content-type': 'application/json; charset=utf-8',
        'x-content-type-options': 'nosniff',
      })
    }
  }
}

function traceCheckpointHttp(
  path: string,
  req: IncomingMessage,
  runtime: ExpeditionRuntime,
  response: { readonly status: number; readonly body: unknown; readonly headers?: Readonly<Record<string, string>> },
  service: MemoryProofService | null,
  rawBody: string | undefined,
): void {
  if (path !== CHECKPOINT_PATH) return
  if (process.env.VITEST === 'true' || process.env.NODE_ENV === 'test') return

  const body = response.body
  const fields = isPlainObject(body) ? Object.keys(body) : []
  const error = isPlainObject(body) && typeof body.error === 'string' ? body.error : undefined
  const contentType = response.headers?.['content-type'] ?? 'application/json; charset=utf-8'
  console.info(
    `[product-proof] CHECKPOINT_HTTP_STATUS method=${req.method ?? 'POST'} status=${response.status} contentType=${contentType} fields=[${fields.join(',')}]`
    + `${error ? ` error=${error}` : ''} cookiePresent=${req.headers.cookie ? 'yes' : 'no'} originPresent=${req.headers.origin ? 'yes' : 'no'} host=${req.headers.host ?? 'missing'} expectedHost=${runtime.expectedHost || 'missing'} allowLocalAlias=${runtime.allowAuthorizedLocalHttpOrigins}`,
  )
  console.info(`[product-proof] CHECKPOINT_REQUEST ${summarizeCheckpointRequest(rawBody)} ${summarizeServerCheckpoint(service, rawBody)}`)
}

function summarizeCheckpointRequest(rawBody: string | undefined): string {
  const parsed = readSafeJsonObject(rawBody)
  if (!parsed) return 'body=unparsed'
  const actions = Array.isArray(parsed.actions) ? parsed.actions : []
  const seqs = actions.map(action => (isPlainObject(action) && typeof action.seq === 'number' ? action.seq : '?'))
  const dirs = actions.map(action => (isPlainObject(action) && typeof action.direction === 'string' ? action.direction : '?'))
  return `seq=${seqs[0] ?? '?'}-${seqs[seqs.length - 1] ?? '?'} prev=${truncateHash(parsed.previousCheckpointHash)} dirs=${dirs.join(',')} actionCount=${actions.length}`
}

function summarizeServerCheckpoint(service: MemoryProofService | null, rawBody: string | undefined): string {
  if (!service) return 'service=null'
  const parsed = readSafeJsonObject(rawBody)
  const runId = parsed && typeof parsed.runId === 'string' ? parsed.runId : null
  if (!runId) return 'run=unknown'
  const run = service.getRun(runId)
  if (!run) return 'run=missing'
  // Compared after dispatch: client previousCheckpointHash is pre-append; run.checkpointHash is post-append.
  const clientPreviousCheckpointHash = parsed ? parsed.previousCheckpointHash : undefined
  const serverCheckpointHashAfterDispatch = run.checkpointHash
  const prevEqualsCurrent = clientPreviousCheckpointHash === serverCheckpointHashAfterDispatch ? 'yes' : 'no'
  return `serverSeq=${run.seq} clientPrev=${truncateHash(clientPreviousCheckpointHash)} serverAfterDispatch=${truncateHash(serverCheckpointHashAfterDispatch)} prevEqualsCurrent=${prevEqualsCurrent}`
}

function readSafeJsonObject(rawBody: string | undefined): Record<string, unknown> | null {
  if (!rawBody) return null
  try {
    const parsed: unknown = JSON.parse(rawBody)
    return isPlainObject(parsed) ? parsed : null
  } catch {
    return null
  }
}

function truncateHash(value: unknown): string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value) ? `${value.slice(0, 8)}…` : 'invalid'
}

function traceStartChallengeHttp(
  path: string,
  req: IncomingMessage,
  runtime: ExpeditionRuntime,
  response: { readonly status: number; readonly body: unknown; readonly headers?: Readonly<Record<string, string>> },
  service: MemoryProofService | null,
): void {
  if (path !== '/api/expeditions/start-challenge') return
  if (process.env.VITEST === 'true' || process.env.NODE_ENV === 'test') return

  const body = response.body
  const fields = isPlainObject(body) ? Object.keys(body) : []
  const error = isPlainObject(body) && typeof body.error === 'string' ? body.error : undefined
  const contentType = response.headers?.['content-type'] ?? 'application/json; charset=utf-8'
  console.info(
    `[product-proof] START_CHALLENGE_HTTP_STATUS method=${req.method ?? 'GET'} status=${response.status} contentType=${contentType} fields=[${fields.join(',')}]`
    + `${error ? ` error=${error}` : ''} originPresent=${req.headers.origin ? 'yes' : 'no'} host=${req.headers.host ?? 'missing'} expectedHost=${runtime.expectedHost || 'missing'} allowLocalAlias=${runtime.allowAuthorizedLocalHttpOrigins}`,
  )
  if (!service) {
    console.info('[product-proof] PROOF_STORE_COUNTS service=null')
    return
  }
  const snapshot = service.snapshot()
  console.info(`[product-proof] PROOF_STORE_COUNTS challenges=${snapshot.challenges.length} runs=${snapshot.runs.length} sessions=${snapshot.sessions.length}`)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readHeaders(req: IncomingMessage): Record<string, string | undefined> {
  return Object.fromEntries(
    Object.entries(req.headers).map(([key, value]) => [key, typeof value === 'string' ? value : undefined]),
  )
}

function isTlsRequest(req: IncomingMessage): boolean {
  return 'encrypted' in req.socket && Boolean((req.socket as { readonly encrypted?: boolean }).encrypted)
}

function readBody(req: IncomingMessage): Promise<string> {
  const maxBytes = 16 * 1024
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0

    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > maxBytes) {
        req.destroy()
        reject(new Error('REQUEST_TOO_LARGE'))
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function writeJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: Readonly<Record<string, string>> = {},
): void {
  res.statusCode = status
  for (const [name, value] of Object.entries(headers)) res.setHeader(name, value)
  if (body === null) {
    res.end()
    return
  }
  res.end(JSON.stringify(body))
}

function parseOrigin(value: string | undefined): { origin: string; host: string; protocol: 'http' | 'https' } | null {
  if (!value) return null
  try {
    const parsed = new URL(value)
    if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || parsed.origin !== value.replace(/\/$/, '')) return null
    return {
      origin: parsed.origin,
      host: parsed.host,
      protocol: parsed.protocol === 'https:' ? 'https' : 'http',
    }
  } catch {
    return null
  }
}

function isAuthorizedHttpOrigin(
  origin: { host: string; protocol: 'http' | 'https' },
  mode: string,
): boolean {
  if (origin.protocol !== 'http') return false
  if (mode === 'test') return isLoopbackHost(origin.host)
  return isLoopbackHost(origin.host) || isPrivateIpv4Host(origin.host)
}

function isLoopbackHost(host: string): boolean {
  const hostname = host.split(':')[0]?.replace('[', '').replace(']', '')
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
}

function isPrivateIpv4Host(host: string): boolean {
  const hostname = host.split(':')[0]
  const octets = hostname.split('.').map(Number)
  if (octets.length !== 4 || octets.some(octet => !Number.isInteger(octet) || octet < 0 || octet > 255)) return false
  return octets[0] === 10
    || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
    || (octets[0] === 192 && octets[1] === 168)
}
