// Public usage-proof contract (NimHunt usage-analytics slice).
//
// A "gamer" is a UNIQUE wallet in public.expedition_runs with
// gameplay_started_at IS NOT NULL — a wallet that actually entered gameplay.
// Marketing visitors, wallet connections, unconsumed challenges, signed
// Starts that never entered gameplay, and run counts are all excluded.
//
// The server exposes only { gamers: number }. Wallet rows/addresses never
// leave the server.

export const PUBLIC_STATS_PATH = '/api/public-stats' as const

export const PUBLIC_STATS_ERRORS = ['MALFORMED_REQUEST', 'STATS_UNAVAILABLE'] as const
export type PublicStatsErrorCode = (typeof PUBLIC_STATS_ERRORS)[number]

export type PublicStatsResponse = {
  readonly ok: true
  readonly gamers: number
}

export function parsePublicStatsResponse(value: unknown): PublicStatsResponse | null {
  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>
  if (record.ok !== true) return null
  if (typeof record.gamers !== 'number' || !Number.isFinite(record.gamers)) return null
  const gamers = Math.floor(record.gamers)
  if (gamers < 0) return null
  return { ok: true, gamers }
}

export function parsePublicStatsError(value: unknown): PublicStatsErrorCode {
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>
    if (record.error === 'MALFORMED_REQUEST') return 'MALFORMED_REQUEST'
  }
  return 'STATS_UNAVAILABLE'
}
