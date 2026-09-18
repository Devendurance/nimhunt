// Monthly Heroes + wallet monthly stats contract (NimHunt FINAL pre-E2E slice).
//
// Server-derived only. No client counters, no fixtures, no full wallet
// addresses on the public endpoint. Month boundaries are UTC calendar months.

export const MONTHLY_HEROES_PATH = '/api/monthly-heroes' as const
export const WALLET_MONTHLY_STATS_PATH = '/api/wallet/monthly-stats' as const

export const MONTHLY_HERO_IDS = [
  'pathfinder',
  'relic-keeper',
  'unbroken',
  'golden-hand',
  'chestbreaker',
  'fallen-legend',
] as const
export type MonthlyHeroId = (typeof MONTHLY_HERO_IDS)[number]

export type HeroMetricKey =
  | 'expeditionMinutes'
  | 'points'
  | 'bestStreak'
  | 'nimDelivered'
  | 'chestsOpened'
  | 'expeditionsFailed'

export type HeroCategoryDef = {
  readonly heroId: MonthlyHeroId
  readonly title: string
  readonly metricLabel: string
  readonly metricKey: HeroMetricKey
  readonly unit: string
}

export const HERO_CATEGORIES: readonly HeroCategoryDef[] = [
  { heroId: 'pathfinder', title: 'THE PATHFINDER', metricLabel: 'Most Expedition Time', metricKey: 'expeditionMinutes', unit: 'min' },
  { heroId: 'relic-keeper', title: 'THE RELIC KEEPER', metricLabel: 'Most Points', metricKey: 'points', unit: 'pts' },
  { heroId: 'unbroken', title: 'THE UNBROKEN', metricLabel: 'Highest Streak', metricKey: 'bestStreak', unit: 'days' },
  { heroId: 'golden-hand', title: 'THE GOLDEN HAND', metricLabel: 'Most NIM Collected', metricKey: 'nimDelivered', unit: 'NIM' },
  { heroId: 'chestbreaker', title: 'THE CHESTBREAKER', metricLabel: 'Most Chests Opened', metricKey: 'chestsOpened', unit: 'chests' },
  { heroId: 'fallen-legend', title: 'THE FALLEN LEGEND', metricLabel: 'Most Expeditions Failed', metricKey: 'expeditionsFailed', unit: 'failed' },
]

export type MonthlyHeroLeader = {
  readonly rank: number
  readonly maskedWallet: string
  readonly value: number
}

export type MonthlyHeroCategory = {
  readonly heroId: MonthlyHeroId
  readonly title: string
  readonly metricLabel: string
  readonly leaders: readonly MonthlyHeroLeader[]
}

export type MonthlyHeroesResponse = {
  readonly ok: true
  readonly monthKey: string
  readonly generatedAt: string
  readonly categories: readonly MonthlyHeroCategory[]
}

export type WalletMonthlyStats = {
  readonly gemsCollected: number
  readonly chestsOpened: number
  readonly expeditionsStarted: number
  readonly expeditionsCompleted: number
  readonly expeditionsFailed: number
  readonly vaultsSealed: number
  readonly expeditionMinutes: number
  readonly currentStreak: number
  readonly bestStreak: number
  readonly points: number
  readonly nimDelivered: number
  readonly rewardsSecured: number
}

export type WalletMonthlyStatsResponse = {
  readonly ok: true
  readonly monthKey: string
  readonly stats: WalletMonthlyStats
  readonly ranks: Record<MonthlyHeroId, number | null>
}

export function monthKeyOfUtc(date: Date): string {
  return date.toISOString().slice(0, 7)
}

export function isMonthKey(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return false
  const year = Number(value.slice(0, 4))
  return year >= 2020 && year <= 2100
}

export function monthLabel(monthKey: string): string {
  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ]
  const month = months[Number(monthKey.slice(5, 7)) - 1] ?? monthKey.slice(5, 7)
  return `${month} ${monthKey.slice(0, 4)}`
}

/**
 * One-way wallet label for public leaderboards. Never returns the full
 * address. Mirrors the client shorten rule (first 6 … last 4) for real
 * Nimiq addresses; short/odd inputs are still truncated, never echoed.
 */
export function maskWalletAddress(wallet: string): string {
  const compact = wallet.replace(/\s+/g, '')
  if (compact.length <= 12) {
    if (compact.length <= 4) return '•••'
    return `${compact.slice(0, 2)}…${compact.slice(-2)}`
  }
  return `${compact.slice(0, 6)}…${compact.slice(-4)}`
}

export function formatHeroValue(metricKey: HeroMetricKey, value: number): string {
  switch (metricKey) {
    case 'expeditionMinutes': {
      if (value < 60) return `${value} min`
      const hours = Math.floor(value / 60)
      const minutes = value % 60
      return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`
    }
    case 'points':
      return `${value.toLocaleString('en-US')} pts`
    case 'bestStreak':
      return `${value} day${value === 1 ? '' : 's'}`
    case 'nimDelivered':
      return `${trimNim(value)} NIM`
    case 'chestsOpened':
      return `${value} chest${value === 1 ? '' : 's'}`
    case 'expeditionsFailed':
      return `${value} failed`
  }
}

function trimNim(value: number): string {
  if (!Number.isFinite(value)) return '0'
  return String(Math.round(value * 100000) / 100000)
}

export function parseMonthlyHeroesResponse(value: unknown): MonthlyHeroesResponse | null {
  if (!isRecord(value) || value.ok !== true) return null
  if (!hasExactKeys(value, ['ok', 'monthKey', 'generatedAt', 'categories'])) return null
  if (!isMonthKey(value.monthKey)) return null
  if (typeof value.generatedAt !== 'string' || Number.isNaN(Date.parse(value.generatedAt))) return null
  if (!Array.isArray(value.categories) || value.categories.length !== HERO_CATEGORIES.length) return null
  const categories: MonthlyHeroCategory[] = []
  for (let index = 0; index < HERO_CATEGORIES.length; index += 1) {
    const def = HERO_CATEGORIES[index]
    const parsed = parseHeroCategory(value.categories[index], def)
    if (!parsed) return null
    categories.push(parsed)
  }
  return { ok: true, monthKey: value.monthKey, generatedAt: value.generatedAt, categories }
}

function parseHeroCategory(value: unknown, def: HeroCategoryDef): MonthlyHeroCategory | null {
  if (!isRecord(value) || !hasExactKeys(value, ['heroId', 'title', 'metricLabel', 'leaders'])) return null
  if (value.heroId !== def.heroId || value.title !== def.title || value.metricLabel !== def.metricLabel) return null
  if (!Array.isArray(value.leaders) || value.leaders.length > 10) return null
  const leaders: MonthlyHeroLeader[] = []
  for (let index = 0; index < value.leaders.length; index += 1) {
    const entry = value.leaders[index]
    if (!isRecord(entry) || !hasExactKeys(entry, ['rank', 'maskedWallet', 'value'])) return null
    if (entry.rank !== index + 1) return null
    if (typeof entry.maskedWallet !== 'string' || entry.maskedWallet.length === 0 || entry.maskedWallet.length > 32) return null
    if (typeof entry.value !== 'number' || !Number.isFinite(entry.value) || entry.value <= 0) return null
    leaders.push({ rank: entry.rank, maskedWallet: entry.maskedWallet, value: entry.value })
  }
  return { heroId: def.heroId, title: def.title, metricLabel: def.metricLabel, leaders }
}

export function parseWalletMonthlyStatsResponse(value: unknown): WalletMonthlyStatsResponse | null {
  if (!isRecord(value) || value.ok !== true) return null
  if (!hasExactKeys(value, ['ok', 'monthKey', 'stats', 'ranks'])) return null
  if (!isMonthKey(value.monthKey)) return null
  if (!isRecord(value.stats) || !hasExactKeys(value.stats, [
    'gemsCollected', 'chestsOpened', 'expeditionsStarted', 'expeditionsCompleted',
    'expeditionsFailed', 'vaultsSealed', 'expeditionMinutes', 'currentStreak',
    'bestStreak', 'points', 'nimDelivered', 'rewardsSecured',
  ])) {
    return null
  }
  const stats = value.stats as Record<string, unknown>
  for (const key of Object.keys(stats)) {
    const entry = stats[key]
    if (typeof entry !== 'number' || !Number.isFinite(entry) || entry < 0) return null
    if (key !== 'nimDelivered' && !Number.isInteger(entry)) return null
  }
  if (!isRecord(value.ranks)) return null
  const rankKeys = Object.keys(value.ranks)
  if (rankKeys.length !== MONTHLY_HERO_IDS.length || !MONTHLY_HERO_IDS.every(id => rankKeys.includes(id))) return null
  const ranks = {} as Record<MonthlyHeroId, number | null>
  for (const id of MONTHLY_HERO_IDS) {
    const entry = (value.ranks as Record<string, unknown>)[id]
    if (entry !== null && (typeof entry !== 'number' || !Number.isInteger(entry) || entry < 1)) return null
    ranks[id] = entry
  }
  return {
    ok: true,
    monthKey: value.monthKey,
    stats: {
      gemsCollected: stats.gemsCollected as number,
      chestsOpened: stats.chestsOpened as number,
      expeditionsStarted: stats.expeditionsStarted as number,
      expeditionsCompleted: stats.expeditionsCompleted as number,
      expeditionsFailed: stats.expeditionsFailed as number,
      vaultsSealed: stats.vaultsSealed as number,
      expeditionMinutes: stats.expeditionMinutes as number,
      currentStreak: stats.currentStreak as number,
      bestStreak: stats.bestStreak as number,
      points: stats.points as number,
      nimDelivered: stats.nimDelivered as number,
      rewardsSecured: stats.rewardsSecured as number,
    },
    ranks,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value)
  return keys.length === expected.length && expected.every(key => keys.includes(key))
}
