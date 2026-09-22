import {
  PUBLIC_STATS_PATH,
  parsePublicStatsError,
  parsePublicStatsResponse,
  type PublicStatsResponse,
} from '../domain/publicStats.ts'

export type PublicStatsApiErrorCode = 'STATS_UNAVAILABLE' | 'NETWORK_ERROR' | 'MALFORMED_RESPONSE' | 'MALFORMED_REQUEST'

export class PublicStatsApiError extends Error {
  readonly code: PublicStatsApiErrorCode
  constructor(code: PublicStatsApiErrorCode) {
    super(code)
    this.name = 'PublicStatsApiError'
    this.code = code
  }
}

export type GamerCountView = {
  readonly status: 'loading' | 'live' | 'unavailable'
  /** Last valid count. Retained across API failures; null until first live. */
  readonly gamers: number | null
}

/**
 * Pure gamer-count transition (tested): live fetches set the count, failures
 * retain the last valid count when one exists, otherwise go unavailable.
 * Never fabricates a value.
 */
export function applyGamerFetch(current: GamerCountView, stats: PublicStatsResponse | null): GamerCountView {
  if (stats) return { status: 'live', gamers: stats.gamers }
  if (current.gamers !== null) return { status: 'unavailable', gamers: current.gamers }
  return { status: 'unavailable', gamers: null }
}

export async function fetchPublicStats(fetcher: typeof fetch = fetch): Promise<PublicStatsResponse> {
  let response: Response
  try {
    response = await fetcher(PUBLIC_STATS_PATH, {
      method: 'GET',
      cache: 'no-store',
      headers: { accept: 'application/json' },
    })
  } catch {
    throw new PublicStatsApiError('NETWORK_ERROR')
  }
  let data: unknown
  try {
    data = await response.json()
  } catch {
    throw new PublicStatsApiError('MALFORMED_RESPONSE')
  }
  if (!response.ok) throw new PublicStatsApiError(parsePublicStatsError(data))
  const parsed = parsePublicStatsResponse(data)
  if (!parsed) throw new PublicStatsApiError('MALFORMED_RESPONSE')
  return parsed
}
