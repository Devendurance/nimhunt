import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  dispatchProductHttp,
  isOwnedProductPath,
  isPayoutCyclePath,
  PRODUCT_REWRITE_PARAM,
  readVercelRawBody,
  resolveRewriteDispatchPath,
} from './productAdapter.js'
import { resolveProductionExpeditionRuntime } from '../expeditions/proofRuntime.js'

const root = process.cwd()
const read = (rel: string) => readFileSync(join(root, rel), 'utf8')

type Rewrite = { source: string; destination: string }

function loadRewrites(): Rewrite[] {
  const vercel = JSON.parse(read('vercel.json')) as {
    rewrites?: Rewrite[]
    crons?: Array<{ path: string; schedule: string }>
  }
  return vercel.rewrites ?? []
}

/**
 * Minimal Vercel rewrite simulator for this project's vercel.json.
 * Matches pathname against `source` patterns supporting exact and `:path*`
 * suffix wildcards, then substitutes into `destination` and merges the
 * incoming query string (Vercel merges destination + incoming queries).
 */
function simulateVercelRewrite(publicPath: string): string | null {
  const url = new URL(publicPath, 'http://localhost')
  const pathname = url.pathname
  const incomingQuery = url.searchParams.toString()
  for (const entry of loadRewrites()) {
    const { source, destination } = entry
    if (!source.startsWith('/api')) continue
    if (source.endsWith('/:path*')) {
      const prefix = source.slice(0, -'/:path*'.length)
      if (pathname === prefix || pathname.startsWith(`${prefix}/`)) {
        const captured = pathname === prefix ? '' : pathname.slice(prefix.length + 1)
        const destWithPath = destination.replace(':path*', captured)
        if (incomingQuery.length === 0) return destWithPath
        const sep = destWithPath.includes('?') ? '&' : '?'
        return `${destWithPath}${sep}${incomingQuery}`
      }
      continue
    }
    if (pathname === source) {
      if (incomingQuery.length === 0) return destination
      const sep = destination.includes('?') ? '&' : '?'
      return `${destination}${sep}${incomingQuery}`
    }
  }
  return null
}

const REQUIRED_PRODUCT_PATHS = [
  '/api/daily-hunt-status',
  '/api/wallet-daily-status',
  '/api/expeditions/start-challenge',
  '/api/expeditions/start',
  '/api/expeditions/active',
  '/api/expeditions/session/recover',
  '/api/expeditions/gameplay-start',
  '/api/expeditions/checkpoint',
  '/api/expeditions/verify',
  '/api/expeditions/abandon',
  '/api/expeditions/vault-seal/prepare',
  '/api/expeditions/vault-seal/verify',
  '/api/rewards/claim/prepare',
  '/api/rewards/claim/finalize',
  '/api/rewards/claim/payout',
  '/api/wallet/recover-challenge',
  '/api/wallet/recover-session',
] as const

// Section 7 minimum multi-segment set (plus query variants below).
const MULTI_SEGMENT_MINIMUM = [
  '/api/daily-hunt-status',
  '/api/expeditions/start-challenge',
  '/api/expeditions/checkpoint',
  '/api/expeditions/vault-seal/prepare',
  '/api/rewards/claim/finalize',
  '/api/rewards/claim/payout?claimId=test',
  '/api/wallet/recover-challenge',
] as const

const MOCK_ENV = {
  NIMHUNT_PROOF_BACKEND: 'postgres',
  NIMHUNT_APP_ORIGIN: 'https://nimhunt.vercel.app',
}

describe('deployment routing: vercel.json product rewrites', () => {
  it('keeps /play SPA rewrite and disabled payout cron unchanged', () => {
    const vercel = JSON.parse(read('vercel.json')) as {
      rewrites?: Rewrite[]
      crons?: Array<{ path: string; schedule: string }>
    }
    const play = (vercel.rewrites ?? []).find(entry => entry.source === '/play')
    expect(play?.destination).toBe('/index.html')
    expect(vercel.crons).toHaveLength(1)
    expect(vercel.crons?.[0]).toEqual({
      path: '/api/internal/payout-cycle',
      schedule: '0 14 * * *',
    })
  })

  it('maps single-segment product paths to the stable function', () => {
    const rewrites = loadRewrites()
    for (const source of ['/api/daily-hunt-status', '/api/wallet-daily-status']) {
      const entry = rewrites.find(rewrite => rewrite.source === source)
      expect(entry, source).toBeDefined()
      expect(entry?.destination).toBe(`/api/product?${PRODUCT_REWRITE_PARAM}=${source}`)
    }
  })

  it('maps nested PRODUCT prefixes with :path* wildcards', () => {
    const rewrites = loadRewrites()
    for (const source of ['/api/expeditions/:path*', '/api/rewards/:path*', '/api/wallet/:path*']) {
      const entry = rewrites.find(rewrite => rewrite.source === source)
      expect(entry, source).toBeDefined()
      expect(entry?.destination).toContain('/api/product?')
      expect(entry?.destination).toContain(PRODUCT_REWRITE_PARAM)
      expect(entry?.destination).toContain(':path*')
    }
  })

  it('leaves /api/internal/payout-cycle outside every product rewrite', () => {
    const rewrites = loadRewrites()
    for (const entry of rewrites) {
      expect(entry.source).not.toContain('/api/internal')
      expect(entry.destination).not.toContain('/api/internal')
      expect(entry.destination).not.toContain('payout-cycle')
    }
    expect(simulateVercelRewrite('/api/internal/payout-cycle')).toBeNull()
    expect(simulateVercelRewrite('/api/internal/payout-cycle?foo=bar')).toBeNull()
  })

  it('never rewrites an API route to the SPA shell', () => {
    for (const entry of loadRewrites()) {
      if (entry.source.startsWith('/api')) {
        expect(entry.destination.startsWith('/api/product')).toBe(true)
      }
    }
  })

  it('uses ONE stable physical function and stops relying on the catch-all', () => {
    expect(existsSync(join(root, 'api', 'product.ts'))).toBe(true)
    expect(existsSync(join(root, 'api', '[...nimhunt].ts'))).toBe(false)
    expect(existsSync(join(root, 'api', 'internal', 'payout-cycle.ts'))).toBe(true)
    const serverTsconfig = read('tsconfig.server.json')
    expect(serverTsconfig).toContain('api/product.ts')
    expect(serverTsconfig).not.toContain('[...nimhunt]')
    const productSource = read('api/product.ts')
    expect(productSource).toContain('dispatchProductHttp')
    expect(productSource).toContain('resolveRewriteDispatchPath')
    expect(productSource).toContain('readVercelRawBody')
  })
})

describe('deployment routing: nested route coverage (multi-segment, not just unit dispatch)', () => {
  it.each([...REQUIRED_PRODUCT_PATHS])('rewrite + reconstruct %s exactly', (publicPath) => {
    const internal = simulateVercelRewrite(publicPath)
    expect(internal, publicPath).not.toBeNull()
    expect(internal).toContain('/api/product?')
    expect(internal).toContain(`${PRODUCT_REWRITE_PARAM}=`)
    expect(resolveRewriteDispatchPath(internal as string)).toBe(publicPath)
  })

  it.each([...MULTI_SEGMENT_MINIMUM])('section-7 minimum %s reaches the adapter', (publicPath) => {
    const internal = simulateVercelRewrite(publicPath)
    expect(internal).not.toBeNull()
    expect(resolveRewriteDispatchPath(internal as string)).toBe(publicPath)
  })

  it('reconstructs three-segment vault-seal and claim paths exactly', () => {
    expect(resolveRewriteDispatchPath(simulateVercelRewrite('/api/expeditions/vault-seal/prepare') as string))
      .toBe('/api/expeditions/vault-seal/prepare')
    expect(resolveRewriteDispatchPath(simulateVercelRewrite('/api/expeditions/vault-seal/verify') as string))
      .toBe('/api/expeditions/vault-seal/verify')
    expect(resolveRewriteDispatchPath(simulateVercelRewrite('/api/rewards/claim/prepare') as string))
      .toBe('/api/rewards/claim/prepare')
  })

  it('reuses productAdapter for every required path without business-logic duplication', async () => {
    for (const publicPath of REQUIRED_PRODUCT_PATHS) {
      expect(isOwnedProductPath(publicPath)).toBe(true)
      const dispatchPath = resolveRewriteDispatchPath(simulateVercelRewrite(publicPath) as string)
      const response = await dispatchProductHttp({
        method: 'GET',
        path: dispatchPath,
        headers: { origin: 'https://nimhunt.vercel.app', host: 'nimhunt.vercel.app' },
        host: 'nimhunt.vercel.app',
        protocol: 'https',
      }, MOCK_ENV)
      // Reaching the adapter means a product JSON envelope (200/4xx/503),
      // never a platform 404 page. Invalid safe GETs fail validation inside
      // the adapter without consuming attempts or executing payouts.
      expect(typeof response.status).toBe('number')
      expect(response.body).toMatchObject({ ok: expect.anything() })
      const text = JSON.stringify(response.body)
      expect(text).not.toContain('NOT_FOUND_PAGE')
      expect(text).not.toContain('<html')
    }
  })

  it('proves nested multi-segment dispatch is JSON (not Vercel platform 404)', async () => {
    for (const publicPath of MULTI_SEGMENT_MINIMUM) {
      const dispatchPath = resolveRewriteDispatchPath(simulateVercelRewrite(publicPath) as string)
      const response = await dispatchProductHttp({ method: 'GET', path: dispatchPath }, MOCK_ENV)
      expect(response.body).toMatchObject({ ok: expect.anything() })
      expect(JSON.stringify(response.body)).not.toContain('NOT_FOUND_PAGE')
    }
  })
})

describe('deployment routing: query preservation', () => {
  it('preserves runId exactly (not /api/product)', () => {
    const internal = simulateVercelRewrite('/api/expeditions/active?runId=abc') as string
    expect(internal).toContain(`${PRODUCT_REWRITE_PARAM}=/api/expeditions/active`)
    expect(internal).toContain('runId=abc')
    const dispatchPath = resolveRewriteDispatchPath(internal)
    expect(dispatchPath).toBe('/api/expeditions/active?runId=abc')
    expect(dispatchPath.startsWith('/api/product')).toBe(false)
    expect(dispatchPath).not.toContain(PRODUCT_REWRITE_PARAM)
  })

  it('preserves claimId exactly', () => {
    const dispatchPath = resolveRewriteDispatchPath(
      simulateVercelRewrite('/api/rewards/claim/payout?claimId=test') as string,
    )
    expect(dispatchPath).toBe('/api/rewards/claim/payout?claimId=test')
  })

  it('preserves all legitimate query params together', () => {
    const dispatchPath = resolveRewriteDispatchPath(
      simulateVercelRewrite('/api/expeditions/active?runId=abc&claimId=test&foo=bar') as string,
    )
    const parsed = new URL(dispatchPath, 'http://localhost')
    expect(parsed.pathname).toBe('/api/expeditions/active')
    expect(parsed.searchParams.get('runId')).toBe('abc')
    expect(parsed.searchParams.get('claimId')).toBe('test')
    expect(parsed.searchParams.get('foo')).toBe('bar')
    expect(dispatchPath).not.toContain(PRODUCT_REWRITE_PARAM)
  })

  it('reaches the adapter with preserved query as product JSON', async () => {
    const dispatchPath = resolveRewriteDispatchPath(
      simulateVercelRewrite('/api/expeditions/active?runId=abc') as string,
    )
    const response = await dispatchProductHttp({
      method: 'GET',
      path: dispatchPath,
      headers: { origin: 'https://nimhunt.vercel.app', host: 'nimhunt.vercel.app' },
      host: 'nimhunt.vercel.app',
      protocol: 'https',
    }, MOCK_ENV)
    expect(response.body).toMatchObject({ ok: expect.anything() })
    expect(JSON.stringify(response.body)).not.toContain('NOT_FOUND_PAGE')
  })
})

describe('deployment routing: security / fail-closed', () => {
  it('forged router-control params cannot dispatch outside PRODUCT_OWNED_PATHS', async () => {
    for (const forged of [
      `/api/product?${PRODUCT_REWRITE_PARAM}=/api/internal/payout-cycle`,
      `/api/product?${PRODUCT_REWRITE_PARAM}=/api/internal/payout-cycle&claimId=test`,
      `/api/product?${PRODUCT_REWRITE_PARAM}=/etc/passwd`,
      `/api/product?${PRODUCT_REWRITE_PARAM}=https://evil.example/api/expeditions/active`,
      `/api/product?${PRODUCT_REWRITE_PARAM}=/api/unknown-route`,
    ]) {
      const dispatchPath = resolveRewriteDispatchPath(forged)
      const response = await dispatchProductHttp({ method: 'GET', path: dispatchPath }, MOCK_ENV)
      expect(response.status).toBe(404)
      expect(response.body).toEqual({ ok: false, error: 'MALFORMED_REQUEST' })
    }
  })

  it('conflicting duplicate router-control params fail closed', async () => {
    const dispatchPath = resolveRewriteDispatchPath(
      `/api/product?${PRODUCT_REWRITE_PARAM}=/api/expeditions/active&${PRODUCT_REWRITE_PARAM}=/api/internal/payout-cycle`,
    )
    expect(dispatchPath).toBe('/api/product')
    const response = await dispatchProductHttp({ method: 'GET', path: dispatchPath }, MOCK_ENV)
    expect(response.status).toBe(404)
  })

  it('/api/internal/payout-cycle can never route into productAdapter', async () => {
    expect(isPayoutCyclePath('/api/internal/payout-cycle')).toBe(true)
    expect(isOwnedProductPath('/api/internal/payout-cycle')).toBe(false)
    const response = await dispatchProductHttp({
      method: 'GET',
      path: '/api/internal/payout-cycle',
      headers: { authorization: 'Bearer wrong' },
    }, MOCK_ENV)
    expect(response.status).toBe(404)
    expect(response.body).toEqual({ ok: false, error: 'MALFORMED_REQUEST' })
  })

  it('unknown product path fails closed as JSON', async () => {
    const internal = simulateVercelRewrite('/api/expeditions/unknown') as string
    expect(internal).toContain('/api/product?')
    const dispatchPath = resolveRewriteDispatchPath(internal)
    expect(dispatchPath).toBe('/api/expeditions/unknown')
    const response = await dispatchProductHttp({ method: 'GET', path: dispatchPath }, MOCK_ENV)
    expect(response.status).toBe(404)
    expect(response.body).toEqual({ ok: false, error: 'MALFORMED_REQUEST' })
  })

  it('Origin/Host/protocol security unchanged through rewritten dispatch', async () => {
    const dispatchPath = resolveRewriteDispatchPath(
      simulateVercelRewrite('/api/expeditions/start-challenge') as string,
    )
    const response = await dispatchProductHttp({
      method: 'POST',
      path: dispatchPath,
      headers: {
        origin: 'https://evil.example',
        host: 'nimhunt.vercel.app',
        'content-type': 'application/json',
      },
      host: 'nimhunt.vercel.app',
      protocol: 'https',
      rawBody: JSON.stringify({ wallet: 'NQ00', mission: 'gem-runner' }),
    }, MOCK_ENV)
    expect(response.status).toBeGreaterThanOrEqual(400)
    expect(response.body).toEqual({ ok: false, error: expect.anything() })
  })

  it('body limits unchanged (16k cap)', async () => {
    const oversized = Buffer.from('x'.repeat(17 * 1024))
    const fakeReq = {
      method: 'POST',
      headers: {},
      body: oversized,
      on: () => undefined,
    } as unknown as Parameters<typeof readVercelRawBody>[0]
    await expect(readVercelRawBody(fakeReq)).rejects.toThrow('REQUEST_TOO_LARGE')
    const productSource = read('api/product.ts')
    expect(productSource).toContain('REQUEST_TOO_LARGE')
    expect(productSource).toContain('413')
  })

  it('session cookies unchanged (Secure https production runtime)', () => {
    const runtime = resolveProductionExpeditionRuntime(MOCK_ENV)
    expect(runtime.expectedHost).toBe('nimhunt.vercel.app')
    expect(runtime.expectedProtocol).toBe('https')
    expect(runtime.secureCookie).toBe(true)
  })

  it('no server secret reaches the client through rewritten dispatch', async () => {
    const dispatchPath = resolveRewriteDispatchPath(
      simulateVercelRewrite('/api/expeditions/checkpoint') as string,
    )
    const response = await dispatchProductHttp({
      method: 'POST',
      path: dispatchPath,
      headers: { 'content-type': 'application/json' },
      rawBody: JSON.stringify({ nope: true }),
    }, MOCK_ENV)
    const text = JSON.stringify(response.body)
    expect(text).not.toContain('CRON_SECRET')
    expect(text).not.toContain('service-role')
    expect(text).not.toContain('SERVICE_ROLE')
    expect(text).not.toContain('SUPABASE_SERVICE')
  })
})
