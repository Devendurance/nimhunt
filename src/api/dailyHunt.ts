import { DAILY_HUNT_STATUS_PATH, WALLET_DAILY_STATUS_PATH, type DailyHuntStatus, type WalletDailyStatus } from '../domain/dailyLedger'

export type DailyHuntFetch =
  | { kind: 'live'; status: DailyHuntStatus }
  | { kind: 'unavailable' }

export async function fetchDailyHuntStatus(fetcher: typeof fetch = fetch): Promise<DailyHuntFetch> {
  try {
    const response = await fetcher(DAILY_HUNT_STATUS_PATH, {
      method: 'GET',
      headers: { accept: 'application/json' },
    })
    const data: unknown = await response.json()
    if (!response.ok) return { kind: 'unavailable' }
    const status = parseDailyHuntStatus(data)
    if (!status) return { kind: 'unavailable' }
    return { kind: 'live', status }
  } catch {
    return { kind: 'unavailable' }
  }
}

export async function fetchWalletDailyStatus(
  wallet: string,
  fetcher: typeof fetch = fetch,
): Promise<WalletDailyStatus | null> {
  try {
    const response = await fetcher(WALLET_DAILY_STATUS_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ wallet }),
    })
    const data: unknown = await response.json()
    if (!response.ok) return null
    return parseWalletDailyStatus(data)
  } catch {
    return null
  }
}

export function parseDailyHuntStatus(value: unknown): DailyHuntStatus | null {
  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>
  if (record.ok !== true) return null
  if (!isFiniteNumber(record.totalSlots) || !isFiniteNumber(record.reservedSlots) || !isFiniteNumber(record.remainingSlots)) {
    return null
  }
  if (typeof record.dayKey !== 'string' || typeof record.nextResetAt !== 'string') return null
  return {
    totalSlots: record.totalSlots,
    reservedSlots: record.reservedSlots,
    remainingSlots: record.remainingSlots,
    dayKey: record.dayKey,
    nextResetAt: record.nextResetAt,
  }
}

function parseWalletDailyStatus(value: unknown): WalletDailyStatus | null {
  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>
  if (record.ok !== true) return null
  if (!isFiniteNumber(record.expeditionsStarted) || !isFiniteNumber(record.expeditionsRemaining)) return null
  if (typeof record.dayKey !== 'string' || typeof record.nextResetAt !== 'string') return null
  if (typeof record.rewardAlreadyReserved !== 'boolean') return null
  return {
    dayKey: record.dayKey,
    expeditionsStarted: record.expeditionsStarted,
    expeditionsRemaining: record.expeditionsRemaining,
    rewardAlreadyReserved: record.rewardAlreadyReserved,
    nextResetAt: record.nextResetAt,
  }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}
