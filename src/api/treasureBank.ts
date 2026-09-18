import { TREASURE_BANK_PATH, parseTreasureBankResponse, type TreasureBankResponse } from '../domain/treasureBank.ts'

export type TreasureBankApiErrorCode =
  | 'RUN_SESSION_INVALID'
  | 'TREASURE_UNAVAILABLE'
  | 'NETWORK_ERROR'
  | 'MALFORMED_RESPONSE'
  | 'MALFORMED_REQUEST'

export class TreasureBankApiError extends Error {
  readonly code: TreasureBankApiErrorCode
  constructor(code: TreasureBankApiErrorCode) {
    super(code)
    this.name = 'TreasureBankApiError'
    this.code = code
  }
}

export async function fetchTreasureBank(fetcher: typeof fetch = fetch): Promise<TreasureBankResponse> {
  let response: Response
  try {
    response = await fetcher(TREASURE_BANK_PATH, {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { accept: 'application/json' },
    })
  } catch {
    throw new TreasureBankApiError('NETWORK_ERROR')
  }
  let data: unknown
  try {
    data = await response.json()
  } catch {
    throw new TreasureBankApiError('MALFORMED_RESPONSE')
  }
  if (!response.ok) {
    throw new TreasureBankApiError(readErrorCode(data))
  }
  const parsed = parseTreasureBankResponse(data)
  if (!parsed) throw new TreasureBankApiError('MALFORMED_RESPONSE')
  return parsed
}

function readErrorCode(data: unknown): TreasureBankApiErrorCode {
  if (typeof data === 'object' && data !== null && !Array.isArray(data) && 'error' in data) {
    const error = (data as Record<string, unknown>).error
    if (error === 'RUN_SESSION_INVALID') return 'RUN_SESSION_INVALID'
    if (error === 'TREASURE_UNAVAILABLE') return 'TREASURE_UNAVAILABLE'
    if (error === 'MALFORMED_REQUEST') return 'MALFORMED_REQUEST'
  }
  return 'MALFORMED_RESPONSE'
}
