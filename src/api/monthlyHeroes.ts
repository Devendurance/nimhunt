import {
  MONTHLY_HEROES_PATH,
  WALLET_MONTHLY_STATS_PATH,
  parseMonthlyHeroesResponse,
  parseWalletMonthlyStatsResponse,
  type MonthlyHeroesResponse,
  type WalletMonthlyStatsResponse,
} from '../domain/monthlyHeroes.ts'

export type MonthlyHeroesApiErrorCode =
  | 'RUN_SESSION_INVALID'
  | 'HEROES_UNAVAILABLE'
  | 'NETWORK_ERROR'
  | 'MALFORMED_RESPONSE'
  | 'MALFORMED_REQUEST'

export class MonthlyHeroesApiError extends Error {
  readonly code: MonthlyHeroesApiErrorCode
  constructor(code: MonthlyHeroesApiErrorCode) {
    super(code)
    this.name = 'MonthlyHeroesApiError'
    this.code = code
  }
}

export async function fetchMonthlyHeroes(fetcher: typeof fetch = fetch): Promise<MonthlyHeroesResponse> {
  let response: Response
  try {
    response = await fetcher(MONTHLY_HEROES_PATH, {
      method: 'GET',
      cache: 'no-store',
      headers: { accept: 'application/json' },
    })
  } catch {
    throw new MonthlyHeroesApiError('NETWORK_ERROR')
  }
  let data: unknown
  try {
    data = await response.json()
  } catch {
    throw new MonthlyHeroesApiError('MALFORMED_RESPONSE')
  }
  if (!response.ok) throw new MonthlyHeroesApiError(readErrorCode(data))
  const parsed = parseMonthlyHeroesResponse(data)
  if (!parsed) throw new MonthlyHeroesApiError('MALFORMED_RESPONSE')
  return parsed
}

export async function fetchWalletMonthlyStats(fetcher: typeof fetch = fetch): Promise<WalletMonthlyStatsResponse> {
  let response: Response
  try {
    response = await fetcher(WALLET_MONTHLY_STATS_PATH, {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { accept: 'application/json' },
    })
  } catch {
    throw new MonthlyHeroesApiError('NETWORK_ERROR')
  }
  let data: unknown
  try {
    data = await response.json()
  } catch {
    throw new MonthlyHeroesApiError('MALFORMED_RESPONSE')
  }
  if (!response.ok) throw new MonthlyHeroesApiError(readErrorCode(data))
  const parsed = parseWalletMonthlyStatsResponse(data)
  if (!parsed) throw new MonthlyHeroesApiError('MALFORMED_RESPONSE')
  return parsed
}

function readErrorCode(data: unknown): MonthlyHeroesApiErrorCode {
  if (typeof data === 'object' && data !== null && !Array.isArray(data) && 'error' in data) {
    const error = (data as Record<string, unknown>).error
    if (error === 'RUN_SESSION_INVALID') return 'RUN_SESSION_INVALID'
    if (error === 'HEROES_UNAVAILABLE') return 'HEROES_UNAVAILABLE'
    if (error === 'MALFORMED_REQUEST') return 'MALFORMED_REQUEST'
  }
  return 'MALFORMED_RESPONSE'
}
