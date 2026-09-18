export const TREASURE_BANK_PATH = '/api/wallet/treasure-bank' as const

export const TREASURE_BANK_DISPLAY_STATUSES = ['SECURED', 'PROCESSING', 'DELIVERED', 'REVIEW'] as const
export type TreasureBankDisplayStatus = (typeof TREASURE_BANK_DISPLAY_STATUSES)[number]

export type TreasureBankMission = 'gem-runner' | 'chest-hunter' | 'vault-breaker'

export type TreasureBankReward = {
  readonly rewardDay: string
  readonly mission: TreasureBankMission
  readonly missionLabel: string
  readonly amountNim: number
  readonly status: TreasureBankDisplayStatus
  readonly txHash: string | null
}

export type TreasureBankResponse = {
  readonly ok: true
  readonly pendingNim: number
  readonly deliveredNim: number
  readonly lifetimeEarnedNim: number
  readonly pendingCount: number
  readonly deliveredCount: number
  readonly rewards: readonly TreasureBankReward[]
}

export const TREASURE_BANK_MISSION_LABELS: Record<TreasureBankMission, string> = {
  'gem-runner': 'Gem Runner',
  'chest-hunter': 'Chest Hunter',
  'vault-breaker': 'Vault Breaker',
}

export function missionLabel(mission: string): string {
  if (mission === 'gem-runner' || mission === 'chest-hunter' || mission === 'vault-breaker') {
    return TREASURE_BANK_MISSION_LABELS[mission]
  }
  return 'Expedition'
}

export function formatTreasureDay(rewardDay: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(rewardDay)
  if (!match) return rewardDay
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const month = months[Number(match[2]) - 1] ?? match[2]
  return `${month} ${Number(match[3])}`
}

export function parseTreasureBankResponse(value: unknown): TreasureBankResponse | null {
  if (!isRecord(value) || value.ok !== true) return null
  if (!hasExactKeys(value, ['ok', 'pendingNim', 'deliveredNim', 'lifetimeEarnedNim', 'pendingCount', 'deliveredCount', 'rewards'])) {
    return null
  }
  if (!isNonNegativeNumber(value.pendingNim) || !isNonNegativeNumber(value.deliveredNim) || !isNonNegativeNumber(value.lifetimeEarnedNim)) {
    return null
  }
  if (!isNonNegativeInteger(value.pendingCount) || !isNonNegativeInteger(value.deliveredCount)) return null
  if (!Array.isArray(value.rewards) || value.rewards.length > 365) return null
  const rewards: TreasureBankReward[] = []
  for (const entry of value.rewards) {
    const parsed = parseTreasureBankReward(entry)
    if (!parsed) return null
    rewards.push(parsed)
  }
  if (value.lifetimeEarnedNim !== value.pendingNim + value.deliveredNim) return null
  const pending = rewards.filter(reward => reward.status !== 'DELIVERED').length
  const delivered = rewards.filter(reward => reward.status === 'DELIVERED').length
  if (pending !== value.pendingCount || delivered !== value.deliveredCount) return null
  return {
    ok: true,
    pendingNim: value.pendingNim,
    deliveredNim: value.deliveredNim,
    lifetimeEarnedNim: value.lifetimeEarnedNim,
    pendingCount: value.pendingCount,
    deliveredCount: value.deliveredCount,
    rewards,
  }
}

function parseTreasureBankReward(value: unknown): TreasureBankReward | null {
  if (!isRecord(value) || !hasExactKeys(value, ['rewardDay', 'mission', 'missionLabel', 'amountNim', 'status', 'txHash'])) {
    return null
  }
  if (!isUtcDay(value.rewardDay)) return null
  if (value.mission !== 'gem-runner' && value.mission !== 'chest-hunter' && value.mission !== 'vault-breaker') return null
  if (typeof value.missionLabel !== 'string' || value.missionLabel.length === 0 || value.missionLabel.length > 64) return null
  if (!isPositiveNumber(value.amountNim) || value.amountNim > 1_000_000) return null
  if (!TREASURE_BANK_DISPLAY_STATUSES.includes(value.status as TreasureBankDisplayStatus)) return null
  if (value.txHash !== null && !isHash(value.txHash)) return null
  // Tx hash is only ever exposed for PROCESSING/DELIVERED.
  if (value.txHash !== null && value.status !== 'PROCESSING' && value.status !== 'DELIVERED') return null
  return {
    rewardDay: value.rewardDay,
    mission: value.mission,
    missionLabel: value.missionLabel,
    amountNim: value.amountNim,
    status: value.status as TreasureBankDisplayStatus,
    txHash: value.txHash,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value)
  return keys.length === expected.length && expected.every(key => keys.includes(key))
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function isUtcDay(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

function isHash(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)
}
