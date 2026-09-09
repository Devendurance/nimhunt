import type { IncomingMessage, ServerResponse } from 'node:http'
import { loadEnv, type Plugin } from 'vite'
import { utcDayKey } from '../ledger/utcDay.ts'
import { createPublishedBootstrapBlueprints } from './blueprintBootstrap.ts'
import { dispatchExpeditionHttp } from './http.ts'
import { createMemoryProofService } from './memoryProofStore.ts'
import type { MemoryProofService } from './types.ts'

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
}

const UNAVAILABLE_RUNTIME: ExpeditionRuntime = {
  backend: 'unavailable',
  appOrigin: '',
  expectedOrigin: '',
  expectedHost: '',
  expectedProtocol: 'https',
  secureCookie: true,
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
  }
}

export function expeditionProofPlugin(): Plugin {
  let runtime = UNAVAILABLE_RUNTIME
  let service: MemoryProofService | null = null

  return {
    name: 'nimhunt-expedition-proof',
    config(_, { mode }) {
      const env = loadEnv(mode, process.cwd(), '')
      runtime = resolveExpeditionRuntime({
        mode,
        backend: env.NIMHUNT_PROOF_BACKEND,
        appOrigin: env.NIMHUNT_APP_ORIGIN,
      })
      service = runtime.backend === 'memory'
        ? createMemoryProofService({ blueprints: createPublishedBootstrapBlueprints(utcDayKey(new Date())) })
        : null
    },
    configureServer(server) {
      server.middlewares.use(createHandler(() => service, () => runtime))
    },
    configurePreviewServer(server) {
      server.middlewares.use(createHandler(() => null, () => runtime))
    },
  }
}

function createHandler(
  getService: () => MemoryProofService | null,
  getRuntime: () => ExpeditionRuntime,
) {
  return async (req: IncomingMessage, res: ServerResponse, next: () => void): Promise<void> => {
    const path = req.url?.split('?')[0] ?? ''
    if (!isOwnedPath(path)) {
      next()
      return
    }

    const runtime = getRuntime()
    try {
      const rawBody = req.method === 'GET' || req.method === 'OPTIONS' ? undefined : await readBody(req)
      const response = await dispatchExpeditionHttp(getService(), {
        method: req.method ?? 'GET',
        path: req.url ?? path,
        headers: readHeaders(req),
        host: req.headers.host,
        protocol: isTlsRequest(req) ? 'https' : 'http',
        rawBody,
      }, runtime)
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

function isOwnedPath(path: string): boolean {
  return path === '/api/expeditions/start-challenge'
    || path === '/api/expeditions/start'
    || path === '/api/expeditions/active'
    || path === '/api/expeditions/gameplay-start'
    || path === '/api/wallet-daily-status'
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
