import type { IncomingMessage, ServerResponse } from 'node:http'
import { loadEnv, type Plugin } from 'vite'
import { CHECKPOINT_PATH, GET_REWARD_PAYOUT_PATH } from '../../src/domain/expeditionProof.js'
import { TREASURE_BANK_PATH } from '../../src/domain/treasureBank.js'
import { MONTHLY_HEROES_PATH, WALLET_MONTHLY_STATS_PATH } from '../../src/domain/monthlyHeroes.js'
import { RECOVER_SESSION_CHALLENGE_PATH, RECOVER_SESSION_PATH } from '../../src/domain/walletRecovery.js'
import { createLazyValue } from './lazyValue.js'
import { describeSessionCookie, WALLET_RECOVERY_SESSION_COOKIE } from './session.js'
import { createDefaultPayoutRuntime, type PayoutRuntime } from '../payouts/runtime.js'
import { dispatchPayoutSchedulerHttp } from '../payouts/schedulerHttp.js'
import { executeScheduledPayoutCycle, readPayoutSchedulerConfig } from '../payouts/scheduler.js'
import {
  createDefaultPayoutStore,
  createDefaultProofService,
  createProofBackendLoader,
  isOwnedExpeditionPath,
  isOwnedPayoutSchedulerPath,
  isPrivateIpv4Host,
  resolveExpeditionRuntime,
  type ExpeditionRuntime,
} from './proofRuntime.js'
import type { ExpeditionProofService } from './types.js'

export {
  createDefaultPayoutStore,
  createDefaultProofService,
  createDevelopmentMemoryProofService,
  createProofBackendLoader,
  isOwnedExpeditionPath,
  isOwnedPayoutSchedulerPath,
  resolveExpeditionRuntime,
} from './proofRuntime.js'
export type { ExpeditionRuntime, ExpeditionRuntimeInput } from './proofRuntime.js'

const UNAVAILABLE_RUNTIME: ExpeditionRuntime = {
  backend: 'unavailable',
  appOrigin: '',
  expectedOrigin: '',
  expectedHost: '',
  expectedProtocol: 'https',
  secureCookie: true,
  allowAuthorizedLocalHttpOrigins: false,
}

export function expeditionProofPlugin(): Plugin {
  let runtime = UNAVAILABLE_RUNTIME
  let fileEnv: Record<string, string> = {}
  const env = () => ({ ...process.env, ...fileEnv })
  const backend = createProofBackendLoader(
    () => runtime,
    () => createDefaultProofService(runtime, env()),
  )
  const payoutStore = createLazyValue(async () => createDefaultPayoutStore(runtime, env()))
  const treasureSource = createLazyValue(async () => {
    const { createDefaultTreasureBankSource } = await import('../treasureBank/store.js')
    return createDefaultTreasureBankSource(runtime, env())
  })
  const payoutRuntime = createLazyValue(() => createDefaultPayoutRuntime(env()))

  return {
    name: 'nimhunt-expedition-proof',
    config(_, { mode }) {
      fileEnv = loadEnv(mode, process.cwd(), '')
      runtime = resolveExpeditionRuntime({
        mode,
        backend: fileEnv.NIMHUNT_PROOF_BACKEND ?? process.env.NIMHUNT_PROOF_BACKEND,
        appOrigin: fileEnv.NIMHUNT_APP_ORIGIN ?? process.env.NIMHUNT_APP_ORIGIN,
      })
    },
    configureServer(server) {
      server.middlewares.use(createHandler(
        () => backend.ensure(),
        () => payoutStore.ensure(),
        () => payoutRuntime.ensure(),
        () => runtime,
        env,
        () => treasureSource.ensure(),
      ))
    },
    configurePreviewServer(server) {
      server.middlewares.use(createHandler(
        () => backend.ensure(),
        () => payoutStore.ensure(),
        () => payoutRuntime.ensure(),
        () => runtime,
        env,
        () => treasureSource.ensure(),
      ))
    },
  }
}

function createHandler(
  getService: () => ExpeditionProofService | null | Promise<ExpeditionProofService | null>,
  getPayoutStore: () => Promise<Awaited<ReturnType<typeof createDefaultPayoutStore>>>,
  getPayoutRuntime: () => Promise<PayoutRuntime | null>,
  getRuntime: () => ExpeditionRuntime,
  getEnv: () => Record<string, string | undefined>,
  getTreasureSource?: () => Promise<Awaited<ReturnType<typeof import('../treasureBank/store.js').createDefaultTreasureBankSource>>>,
) {
  let dispatch: typeof import('./http.js').dispatchExpeditionHttp | undefined
  let dispatchPayout: typeof import('../payouts/http.js').dispatchPayoutHttp | undefined
  let dispatchTreasure: typeof import('../treasureBank/http.js').dispatchTreasureBankHttp | undefined
  let dispatchHeroes: typeof import('../monthlyHeroes/http.js').dispatchMonthlyHeroesHttp | undefined
  let dispatchWalletStats: typeof import('../monthlyHeroes/http.js').dispatchWalletMonthlyStatsHttp | undefined
  return async (req: IncomingMessage, res: ServerResponse, next: () => void): Promise<void> => {
    const path = req.url?.split('?')[0] ?? ''
    const isTreasurePath = path === TREASURE_BANK_PATH
    const isHeroesPath = path === MONTHLY_HEROES_PATH || path === WALLET_MONTHLY_STATS_PATH
    if (!isOwnedExpeditionPath(path) && !isOwnedPayoutSchedulerPath(path) && !isTreasurePath && !isHeroesPath) {
      next()
      return
    }

    const runtime = getRuntime()
    try {
      const rawBody = req.method === 'GET' || req.method === 'OPTIONS' ? undefined : await readBody(req)
      if (isOwnedPayoutSchedulerPath(path)) {
        const schedulerConfig = readPayoutSchedulerConfig(getEnv())
        let payoutRuntimePromise: Promise<PayoutRuntime | null> | undefined
        const response = await dispatchPayoutSchedulerHttp({
          secret: schedulerConfig.cronSecret,
          runCycle: async () => {
            payoutRuntimePromise ??= getPayoutRuntime()
            const payoutRuntime = await payoutRuntimePromise
            if (!payoutRuntime) throw new Error('PAYOUT_UNAVAILABLE')
            return executeScheduledPayoutCycle({
              store: payoutRuntime.store,
              treasury: payoutRuntime.treasury,
              config: payoutRuntime.config,
              scheduler: payoutRuntime.scheduler,
              secret: payoutRuntime.secret,
            })
          },
        }, {
          method: req.method ?? 'GET',
          path: req.url ?? path,
          headers: readHeaders(req),
          rawBody,
        })
        writeJson(res, response.status, response.body, response.headers)
        return
      }

      const service = await getService()
      if (path === MONTHLY_HEROES_PATH) {
        if (!dispatchHeroes) ({ dispatchMonthlyHeroesHttp: dispatchHeroes } = await import('../monthlyHeroes/http.js'))
        const { createDefaultMonthlyHeroesSource } = await import('../monthlyHeroes/store.js')
        const source = await createDefaultMonthlyHeroesSource(runtime, getEnv())
        const response = await dispatchHeroes(source, {
          method: req.method ?? 'GET',
          path: req.url ?? path,
          headers: readHeaders(req),
          host: req.headers.host,
          protocol: isTlsRequest(req) ? 'https' : 'http',
          rawBody,
        }, runtime)
        writeJson(res, response.status, response.body, response.headers)
        return
      }
      if (path === WALLET_MONTHLY_STATS_PATH) {
        if (!dispatchWalletStats) ({ dispatchWalletMonthlyStatsHttp: dispatchWalletStats } = await import('../monthlyHeroes/http.js'))
        const { createDefaultMonthlyHeroesSource } = await import('../monthlyHeroes/store.js')
        const source = await createDefaultMonthlyHeroesSource(runtime, getEnv())
        const response = await dispatchWalletStats(service, source, {
          method: req.method ?? 'GET',
          path: req.url ?? path,
          headers: readHeaders(req),
          host: req.headers.host,
          protocol: isTlsRequest(req) ? 'https' : 'http',
          rawBody,
        }, runtime)
        writeJson(res, response.status, response.body, response.headers)
        return
      }
      if (path === TREASURE_BANK_PATH) {
        if (!dispatchTreasure) ({ dispatchTreasureBankHttp: dispatchTreasure } = await import('../treasureBank/http.js'))
        const { createDefaultTreasureBankSource } = await import('../treasureBank/store.js')
        const source = getTreasureSource ? await getTreasureSource() : await createDefaultTreasureBankSource(runtime, getEnv())
        const response = await dispatchTreasure(service, source, {
          method: req.method ?? 'GET',
          path: req.url ?? path,
          headers: readHeaders(req),
          host: req.headers.host,
          protocol: isTlsRequest(req) ? 'https' : 'http',
          rawBody,
        }, runtime, getEnv())
        writeJson(res, response.status, response.body, response.headers)
        return
      }
      if (path === GET_REWARD_PAYOUT_PATH) {
        if (!dispatchPayout) ({ dispatchPayoutHttp: dispatchPayout } = await import('../payouts/http.js'))
        const response = await dispatchPayout(service, await getPayoutStore(), {
          method: req.method ?? 'GET',
          path: req.url ?? path,
          headers: readHeaders(req),
          host: req.headers.host,
          protocol: isTlsRequest(req) ? 'https' : 'http',
          rawBody,
        }, runtime)
        tracePayoutHttp(req, runtime, response)
        writeJson(res, response.status, response.body, response.headers)
        return
      }
      if (!dispatch) ({ dispatchExpeditionHttp: dispatch } = await import('./http.js'))
      const response = await dispatch(service, {
        method: req.method ?? 'GET',
        path: req.url ?? path,
        headers: readHeaders(req),
        host: req.headers.host,
        protocol: isTlsRequest(req) ? 'https' : 'http',
        rawBody,
      }, runtime)
      await traceStartChallengeHttp(path, req, runtime, response, service)
      await traceCheckpointHttp(path, req, runtime, response, service, rawBody)
      traceWalletRecoveryHttp(path, req, runtime, response)
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

function tracePayoutHttp(
  req: IncomingMessage,
  runtime: ExpeditionRuntime,
  response: { readonly status: number; readonly body: unknown },
): void {
  if (process.env.VITEST === 'true' || process.env.NODE_ENV === 'test') return
  const host = req.headers.host ?? ''
  const origin = typeof req.headers.origin === 'string' ? req.headers.origin : ''
  const error = isPlainObject(response.body) && typeof response.body.error === 'string' ? response.body.error : 'ok'
  console.info(
    `[payout-http] PAYOUT_GET hostMatch=${host === runtime.expectedHost ? 'yes' : 'no'} originMatch=${!origin || origin === runtime.expectedOrigin ? 'yes' : 'no'} lanHost=${isPrivateIpv4Host(host) ? 'yes' : 'no'} cookiePresent=${req.headers.cookie ? 'yes' : 'no'} walletSessionCookie=${cookieHasName(req.headers.cookie, WALLET_RECOVERY_SESSION_COOKIE)} allowedLocalAlias=${runtime.allowAuthorizedLocalHttpOrigins ? 'yes' : 'no'} status=${response.status} error=${error}`,
  )
}

function traceWalletRecoveryHttp(
  path: string,
  req: IncomingMessage,
  runtime: ExpeditionRuntime,
  response: { readonly status: number; readonly body: unknown; readonly headers?: Readonly<Record<string, string>> },
): void {
  if (path !== RECOVER_SESSION_CHALLENGE_PATH && path !== RECOVER_SESSION_PATH) return
  if (process.env.VITEST === 'true' || process.env.NODE_ENV === 'test') return
  const error = isPlainObject(response.body) && typeof response.body.error === 'string' ? response.body.error : 'ok'
  if (path === RECOVER_SESSION_PATH) {
    const cookie = describeSessionCookie(response.headers?.['set-cookie'])
    console.info(
      `[wallet-recovery] RECOVERY_VERIFY_REQUESTED=yes RECOVERY_VERIFY_HTTP_STATUS=${response.status} RECOVERY_VERIFY_BODY_CODE=${error} RECOVERY_SET_COOKIE_HEADER=${cookie.header} RECOVERY_COOKIE_NAME=${cookie.name} RECOVERY_COOKIE_SECURE=${cookie.secure} RECOVERY_COOKIE_SAMESITE=${cookie.sameSite || 'none'} RECOVERY_COOKIE_PATH=${cookie.path || 'none'} RECOVERY_COOKIE_MAXAGE_PRESENT=${cookie.maxAgePresent}`,
    )
    return
  }
  console.info(
    `[wallet-recovery] RECOVERY_CHALLENGE hostMatch=${req.headers.host === runtime.expectedHost ? 'yes' : 'no'} lanHost=${isPrivateIpv4Host(req.headers.host ?? '') ? 'yes' : 'no'} cookiePresent=${req.headers.cookie ? 'yes' : 'no'} setCookie=${response.headers?.['set-cookie'] ? 'yes' : 'no'} status=${response.status} error=${error}`,
  )
}

function cookieHasName(header: string | undefined, name: string): 'yes' | 'no' {
  if (!header) return 'no'
  return header.split(';').some(part => part.trim().startsWith(`${name}=`)) ? 'yes' : 'no'
}

async function traceCheckpointHttp(
  path: string,
  req: IncomingMessage,
  runtime: ExpeditionRuntime,
  response: { readonly status: number; readonly body: unknown; readonly headers?: Readonly<Record<string, string>> },
  service: ExpeditionProofService | null,
  rawBody: string | undefined,
): Promise<void> {
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
  console.info(`[product-proof] CHECKPOINT_REQUEST ${summarizeCheckpointRequest(rawBody)} ${await summarizeServerCheckpoint(service, rawBody)}`)
}

function summarizeCheckpointRequest(rawBody: string | undefined): string {
  const parsed = readSafeJsonObject(rawBody)
  if (!parsed) return 'body=unparsed'
  const actions = Array.isArray(parsed.actions) ? parsed.actions : []
  const seqs = actions.map(action => (isPlainObject(action) && typeof action.seq === 'number' ? action.seq : '?'))
  const dirs = actions.map(action => (isPlainObject(action) && typeof action.direction === 'string' ? action.direction : '?'))
  return `seq=${seqs[0] ?? '?'}-${seqs[seqs.length - 1] ?? '?'} prev=${truncateHash(parsed.previousCheckpointHash)} dirs=${dirs.join(',')} actionCount=${actions.length}`
}

async function summarizeServerCheckpoint(service: ExpeditionProofService | null, rawBody: string | undefined): Promise<string> {
  if (!service) return 'service=null'
  const parsed = readSafeJsonObject(rawBody)
  const runId = parsed && typeof parsed.runId === 'string' ? parsed.runId : null
  if (!runId) return 'run=unknown'
  const run = await service.getRun(runId)
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

async function traceStartChallengeHttp(
  path: string,
  req: IncomingMessage,
  runtime: ExpeditionRuntime,
  response: { readonly status: number; readonly body: unknown; readonly headers?: Readonly<Record<string, string>> },
  service: ExpeditionProofService | null,
): Promise<void> {
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
  const snapshot = await service.snapshot()
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
