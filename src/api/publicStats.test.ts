// Public-stats client tests: response parsing and graceful fetch errors.
import { describe, expect, it } from 'vitest'
import { fetchPublicStats, applyGamerFetch } from './publicStats.ts'
import { parsePublicStatsError, parsePublicStatsResponse, PUBLIC_STATS_PATH } from '../domain/publicStats.ts'

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response
}

describe('parsePublicStatsResponse', () => {
  it('accepts count-only payloads and rejects negatives, floats stay floored', () => {
    expect(parsePublicStatsResponse({ ok: true, gamers: 38 })).toEqual({ ok: true, gamers: 38 })
    expect(parsePublicStatsResponse({ ok: true, gamers: 0 })).toEqual({ ok: true, gamers: 0 })
    expect(parsePublicStatsResponse({ ok: true, gamers: -1 })).toBeNull()
    expect(parsePublicStatsResponse({ ok: true })).toBeNull()
    expect(parsePublicStatsResponse({ ok: false, error: 'STATS_UNAVAILABLE' })).toBeNull()
    expect(parsePublicStatsResponse(null)).toBeNull()
  })

  it('maps server error codes with safe fallback', () => {
    expect(parsePublicStatsError({ ok: false, error: 'MALFORMED_REQUEST' })).toBe('MALFORMED_REQUEST')
    expect(parsePublicStatsError({ ok: false, error: 'STATS_UNAVAILABLE' })).toBe('STATS_UNAVAILABLE')
    expect(parsePublicStatsError(null)).toBe('STATS_UNAVAILABLE')
  })
})

describe('applyGamerFetch', () => {
  it('sets live counts and retains the last valid count on failure', () => {
    expect(applyGamerFetch({ status: 'loading', gamers: null }, { ok: true, gamers: 40 })).toEqual({
      status: 'live',
      gamers: 40,
    })
    // API failure with a previous count: retain, never fabricate.
    expect(applyGamerFetch({ status: 'live', gamers: 40 }, null)).toEqual({
      status: 'unavailable',
      gamers: 40,
    })
    // API failure with no previous count: hide.
    expect(applyGamerFetch({ status: 'loading', gamers: null }, null)).toEqual({
      status: 'unavailable',
      gamers: null,
    })
  })
})

describe('fetchPublicStats', () => {
  it('fetches the public endpoint with no-store and returns the count', async () => {
    const seen: string[] = []
    const stats = await fetchPublicStats((async (input: string | URL | Request, init?: RequestInit) => {
      seen.push(String(input))
      expect(init?.method).toBe('GET')
      expect(init?.cache).toBe('no-store')
      return jsonResponse({ ok: true, gamers: 38 })
    }) as typeof fetch)
    expect(stats).toEqual({ ok: true, gamers: 38 })
    expect(seen).toEqual([PUBLIC_STATS_PATH])
  })

  it('fails softly on network, malformed, and server errors', async () => {
    await expect(fetchPublicStats((async () => {
      throw new Error('offline')
    }) as typeof fetch)).rejects.toMatchObject({ name: 'PublicStatsApiError', code: 'NETWORK_ERROR' })

    await expect(
      fetchPublicStats((async () => jsonResponse({ ok: false, error: 'STATS_UNAVAILABLE' }, 503)) as typeof fetch),
    ).rejects.toMatchObject({ name: 'PublicStatsApiError', code: 'STATS_UNAVAILABLE' })

    await expect(
      fetchPublicStats((async () => jsonResponse({ ok: true, wallets: ['NQ X'] })) as typeof fetch),
    ).rejects.toMatchObject({ code: 'MALFORMED_RESPONSE' })
  })
})
