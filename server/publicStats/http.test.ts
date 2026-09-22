// Public-stats endpoint tests: DISTINCT gamer definition, NULL exclusion,
// repeat-run dedup, count-only responses (never wallets), and graceful
// unavailable/error states.
import { describe, expect, it } from 'vitest'
import { PUBLIC_STATS_PATH, parsePublicStatsResponse } from '../../src/domain/publicStats.js'
import type { ExpeditionHttpSecurity } from '../expeditions/http.js'
import { dispatchPublicStatsHttp } from './http.js'
import {
  countDistinctGamers,
  createMemoryPublicStatsSource,
  createSupabasePublicStatsSource,
} from './store.js'
import { PublicStatsError } from './http-shared.js'

const SECURITY: ExpeditionHttpSecurity = {
  expectedOrigin: 'https://hunt.example',
  expectedHost: 'hunt.example',
  expectedProtocol: 'https',
  secureCookie: true,
}

function liveRequest(path: string, method = 'GET') {
  return {
    method,
    path,
    headers: { origin: SECURITY.expectedOrigin, host: SECURITY.expectedHost, protocol: SECURITY.expectedProtocol },
    host: SECURITY.expectedHost,
    protocol: SECURITY.expectedProtocol,
  } as const
}

describe('public stats gamer definition', () => {
  it('counts DISTINCT wallets with gameplay_started_at, ignoring NULL rows', () => {
    expect(
      countDistinctGamers([
        { wallet: 'NQ ALPHA', gameplayStartedAt: '2026-09-18T10:00:00.000Z' },
        { wallet: 'NQ ALPHA', gameplayStartedAt: '2026-09-18T11:00:00.000Z' },
        { wallet: 'NQ BETA', gameplayStartedAt: '2026-09-17T10:00:00.000Z' },
      ]),
    ).toBe(2)
  })

  it('does NOT count signed Starts that never entered gameplay', () => {
    expect(
      countDistinctGamers([
        { wallet: 'NQ GHOST', gameplayStartedAt: null },
        { wallet: 'NQ GHOST', gameplayStartedAt: null },
      ]),
    ).toBe(0)
  })

  it('counts repeated runs by the same wallet exactly once', () => {
    expect(
      countDistinctGamers([
        { wallet: 'NQ LOYAL', gameplayStartedAt: '2026-09-10T10:00:00.000Z' },
        { wallet: 'NQ LOYAL', gameplayStartedAt: '2026-09-11T10:00:00.000Z' },
        { wallet: 'NQ LOYAL', gameplayStartedAt: '2026-09-12T10:00:00.000Z' },
      ]),
    ).toBe(1)
  })
})

describe('public stats supabase source (RPC)', () => {
  it('calls get_public_gamer_count and returns the count only', async () => {
    const seen: string[] = []
    const client = {
      async rpc(fn: string) {
        seen.push(fn)
        if (fn !== 'get_public_gamer_count') throw new Error(`unexpected rpc ${fn}`)
        return { data: 42, error: null }
      },
    }
    const source = createSupabasePublicStatsSource(client as never)
    await expect(source.countGamers()).resolves.toBe(42)
    expect(seen).toEqual(['get_public_gamer_count'])
  })

  it('fails closed when the RPC errors or returns a bad count', async () => {
    const failing = createSupabasePublicStatsSource({
      async rpc() {
        return { data: null, error: { message: 'missing' } }
      },
    } as never)
    await expect(failing.countGamers()).rejects.toMatchObject({ name: 'PublicStatsError' })

    const negative = createSupabasePublicStatsSource({
      async rpc() {
        return { data: -1, error: null }
      },
    } as never)
    await expect(negative.countGamers()).rejects.toMatchObject({ name: 'PublicStatsError' })
  })
})

describe('public stats endpoint', () => {
  it('exposes count only, never wallets', async () => {
    const wallet = 'NQ32 AAAA BBBB CCCC DDDD EEEE FFFF GGGG HHHH'
    const source = createMemoryPublicStatsSource([
      { wallet, gameplayStartedAt: '2026-09-18T10:00:00.000Z' },
      { wallet: 'NQ OTHER', gameplayStartedAt: '2026-09-18T11:00:00.000Z' },
      { wallet: 'NQ SIGNED ONLY', gameplayStartedAt: null },
    ])
    const response = await dispatchPublicStatsHttp(source, liveRequest(PUBLIC_STATS_PATH), SECURITY)
    expect(response.status).toBe(200)
    expect(response.body).toEqual({ ok: true, gamers: 2 })
    const parsed = parsePublicStatsResponse(response.body)
    expect(parsed).toEqual({ ok: true, gamers: 2 })
    const text = JSON.stringify(response.body)
    expect(text).not.toContain(wallet)
    expect(text).not.toContain('OTHER')
    expect(text).not.toMatch(/wallet|address|runId|checkpoint|snapshot/i)
  })

  it('serves zero gamers without fixtures when nobody played', async () => {
    const source = createMemoryPublicStatsSource()
    const response = await dispatchPublicStatsHttp(source, liveRequest(PUBLIC_STATS_PATH), SECURITY)
    expect(response.status).toBe(200)
    expect(response.body).toEqual({ ok: true, gamers: 0 })
  })

  it('rejects query params, non-GET methods, and unknown paths', async () => {
    const source = createMemoryPublicStatsSource()
    const withQuery = await dispatchPublicStatsHttp(source, liveRequest(`${PUBLIC_STATS_PATH}?month=2026-09`), SECURITY)
    expect(withQuery.status).toBe(400)
    expect(withQuery.body).toEqual({ ok: false, error: 'MALFORMED_REQUEST' })
    const post = await dispatchPublicStatsHttp(source, liveRequest(PUBLIC_STATS_PATH, 'POST'), SECURITY)
    expect(post.status).toBe(405)
    const wrong = await dispatchPublicStatsHttp(source, liveRequest('/api/daily-hunt-status'), SECURITY)
    expect(wrong.status).toBe(404)
  })

  it('fails gracefully when the source is unavailable or throws', async () => {
    const missing = await dispatchPublicStatsHttp(null, liveRequest(PUBLIC_STATS_PATH), SECURITY)
    expect(missing.status).toBe(503)
    expect(missing.body).toEqual({ ok: false, error: 'STATS_UNAVAILABLE' })

    const throwing = {
      async countGamers(): Promise<number> {
        throw new PublicStatsError('STATS_UNAVAILABLE')
      },
    }
    const failed = await dispatchPublicStatsHttp(throwing, liveRequest(PUBLIC_STATS_PATH), SECURITY)
    expect(failed.status).toBe(503)
    expect(failed.body).toEqual({ ok: false, error: 'STATS_UNAVAILABLE' })

    const noRuntime = await dispatchPublicStatsHttp(
      createMemoryPublicStatsSource(),
      liveRequest(PUBLIC_STATS_PATH),
      { ...SECURITY, expectedOrigin: '', expectedHost: '' },
    )
    expect(noRuntime.status).toBe(503)
  })

  it('uses no-store cache control for near-live stats', async () => {
    const source = createMemoryPublicStatsSource()
    const response = await dispatchPublicStatsHttp(source, liveRequest(PUBLIC_STATS_PATH), SECURITY)
    expect(response.headers?.['cache-control']).toBe('no-store')
  })
})
