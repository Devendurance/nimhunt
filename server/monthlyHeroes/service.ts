// Authoritative monthly player statistics (pure aggregation, no I/O).
//
// SOURCE OF TRUTH (server-owned only):
// - expedition_runs durable rows: day_key (UTC), wallet, mission_type,
//   started_at, ended_at, gameplay_started_at, terminal jsonb (VERIFIED with
//   replay-derived gemsCollected/chestsOpened/outcome, or ABANDONED).
// - expedition_vault_seals: one row per sealed run (PK run_id).
// - reward_claims RESERVED rows: rewardDay month attribution.
// - reward_payouts CONFIRMED rows: frozen amount_luna, attributed by the
//   claim's rewardDay month (NOT execution/confirm time).
//
// STAT SEMANTICS (v1, deterministic):
// - Month scope: run belongs to monthKey iff run.dayKey starts with monthKey.
//   day_key is the UTC start day written by start_expedition_authorized.
// - Practice/dev runs never appear: practice is client-local (useAngkorRun)
//   and never creates expedition_runs rows, so the source already excludes it.
// - expeditionsStarted: every durable run in month (any status/terminal).
// - Items (gems/chests): ONLY from terminal.type === 'VERIFIED' replay truth
//   (verified completions AND verified failures contribute what was collected
//   before failure). ABANDONED / STARTED-without-terminal contribute zero.
// - expeditionsCompleted: VERIFIED_ELIGIBLE (gem/chest, COMPLETED) OR
//   vault-breaker VAULT_GAMEPLAY_VERIFIED with objectiveReached + survived.
//   +100 points each, exactly once per run (one terminal per run; runs are
//   deduped by runId so checkpoint retries can never double-count).
// - expeditionsFailed: VERIFIED outcome FAILED. No completion/vault bonus.
// - vaultsSealed: verified VAULT_GAMEPLAY_VERIFIED run with a durable vault
//   seal row. +50 bonus points, exactly once per run (seal PK is run_id).
// - Points: gems*10 + chests*25 + completions*100 + vaultSeals*50.
// - Expedition time: per run, endedAt - (gameplayStartedAt ?? startedAt),
//   floored at 0, capped at 15 minutes. Runs without endedAt credit 0.
//   All timestamps are server-owned (started_at / mark_gameplay_started /
//   persist_run_terminal). Client wall-clock is never used.
// - Streak day: UTC dayKey with >= 1 verified completion (multiple same-day
//   completions count once). bestStreak: longest consecutive qualifying-day
//   run within the requested month. currentStreak: consecutive qualifying days
//   ending today (UTC); when today has no qualifying activity yet, the run is
//   measured ending yesterday. Pre-month qualifying days may be supplied via
//   priorQualifyingDays so month-boundary streaks stay exact.
// - NIM: nimDelivered sums CONFIRMED payout amount_luna joined to their
//   claim's rewardDay month. Pending/reserved-but-unconfirmed NIM never counts.
//   rewardsSecured counts durable RESERVED claims in the month.
// - Hero tie-break (total order): primary metric desc, expeditionsCompleted
//   desc, earliest first qualifying activity (min startedAt) asc, wallet asc.
//   Rank is the 1-based position in that order. A wallet boards a category
//   only with metric > 0; otherwise leaders stay empty (never fixtures).

import { LUNA_PER_NIM } from '../payouts/types.js'
import {
  HERO_CATEGORIES,
  MONTHLY_HERO_IDS,
  maskWalletAddress,
  type HeroMetricKey,
  type MonthlyHeroCategory,
  type MonthlyHeroesResponse,
  type MonthlyHeroId,
  type WalletMonthlyStats,
  type WalletMonthlyStatsResponse,
} from '../../src/domain/monthlyHeroes.js'

export const POINTS_PER_GEM = 10
export const POINTS_PER_CHEST = 25
export const POINTS_PER_COMPLETION = 100
export const POINTS_PER_VAULT_SEAL = 50
export const MAX_CREDITED_RUN_MS = 15 * 60 * 1000

export type MonthlyRunFacts = {
  readonly runId: string
  readonly wallet: string
  readonly mission: 'gem-runner' | 'chest-hunter' | 'vault-breaker'
  readonly dayKey: string
  readonly startedAt: string
  readonly endedAt: string | null
  readonly gameplayStartedAt: string | null
  /** Replay truth. Null unless terminal.type === 'VERIFIED'. */
  readonly verified: {
    readonly outcome: 'VERIFIED_ELIGIBLE' | 'VAULT_GAMEPLAY_VERIFIED' | 'FAILED'
    readonly gemsCollected: number
    readonly chestsOpened: number
    readonly objectiveReached: boolean
    readonly missionSatisfied: boolean
    readonly finalHp: number
  } | null
  /** Durable vault-seal row exists for this run. */
  readonly vaultSealed: boolean
}

export type MonthlyClaimFacts = {
  readonly claimId: string
  readonly runId: string
  readonly wallet: string
  /** rewardDay (claim day_key). */
  readonly dayKey: string
  readonly status: string
}

export type MonthlyPayoutFacts = {
  readonly claimId: string
  readonly wallet: string
  readonly amountLuna: string
  readonly status: string
}

export type MonthlyFacts = {
  readonly runs: readonly MonthlyRunFacts[]
  readonly claims: readonly MonthlyClaimFacts[]
  readonly payouts: readonly MonthlyPayoutFacts[]
}

export type WalletBoardEntry = {
  readonly wallet: string
  readonly stats: WalletMonthlyStats
  readonly firstActivityAt: string
}

export function lunaToNimFloat(amountLuna: bigint): number {
  if (amountLuna <= 0n) return 0
  const whole = amountLuna / LUNA_PER_NIM
  const remainder = amountLuna % LUNA_PER_NIM
  return Number(whole) + Number(remainder) / Number(LUNA_PER_NIM)
}

export function parseAmountLuna(value: string): bigint | null {
  if (!/^[0-9]+$/.test(value)) return null
  try {
    const amount = BigInt(value)
    return amount > 0n ? amount : null
  } catch {
    return null
  }
}

function inMonth(dayKey: string, monthKey: string): boolean {
  return dayKey.length >= 7 && dayKey.slice(0, 7) === monthKey
}

function dedupeRuns(runs: readonly MonthlyRunFacts[]): MonthlyRunFacts[] {
  const seen = new Set<string>()
  const out: MonthlyRunFacts[] = []
  for (const run of runs) {
    if (!run.runId || seen.has(run.runId)) continue
    seen.add(run.runId)
    out.push(run)
  }
  return out
}

function isVaultCompletion(run: MonthlyRunFacts): boolean {
  const verified = run.verified
  if (!verified) return false
  if (verified.outcome === 'VERIFIED_ELIGIBLE' && verified.missionSatisfied && verified.finalHp > 0) return true
  return run.mission === 'vault-breaker'
    && verified.outcome === 'VAULT_GAMEPLAY_VERIFIED'
    && verified.objectiveReached
    && verified.finalHp > 0
}

function isFailed(run: MonthlyRunFacts): boolean {
  return run.verified?.outcome === 'FAILED'
}

function creditedRunMs(run: MonthlyRunFacts): number {
  if (!run.endedAt) return 0
  const end = Date.parse(run.endedAt)
  const start = Date.parse(run.gameplayStartedAt ?? run.startedAt)
  if (Number.isNaN(end) || Number.isNaN(start)) return 0
  const elapsed = end - start
  if (elapsed <= 0) return 0
  return Math.min(elapsed, MAX_CREDITED_RUN_MS)
}

export function longestStreakWithinMonth(days: ReadonlySet<string>, monthKey: string): number {
  const sorted = [...days].filter(day => inMonth(day, monthKey)).sort()
  let best = 0
  let current = 0
  let previous: string | null = null
  for (const day of sorted) {
    if (previous !== null && utcDayAfter(previous) === day) {
      current += 1
    } else {
      current = 1
    }
    if (current > best) best = current
    previous = day
  }
  return best
}

/**
 * Consecutive qualifying days ending today (UTC); if today is not qualifying,
 * the run is measured ending yesterday. Days after today are never counted.
 */
export function currentStreakEndingToday(days: ReadonlySet<string>, todayDay: string): number {
  let cursor = days.has(todayDay) ? todayDay : utcDayBefore(todayDay)
  if (!days.has(cursor)) return 0
  let streak = 0
  while (days.has(cursor)) {
    streak += 1
    cursor = utcDayBefore(cursor)
  }
  return streak
}

function utcDayBefore(day: string): string {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) - 86_400_000).toISOString().slice(0, 10)
}

function utcDayAfter(day: string): string {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) + 86_400_000).toISOString().slice(0, 10)
}

function emptyStats(): WalletMonthlyStats {
  return {
    gemsCollected: 0,
    chestsOpened: 0,
    expeditionsStarted: 0,
    expeditionsCompleted: 0,
    expeditionsFailed: 0,
    vaultsSealed: 0,
    expeditionMinutes: 0,
    currentStreak: 0,
    bestStreak: 0,
    points: 0,
    nimDelivered: 0,
    rewardsSecured: 0,
  }
}

export function computeWalletMonthBoard(input: {
  readonly facts: MonthlyFacts
  readonly monthKey: string
  readonly todayDay: string
  readonly priorQualifyingDaysByWallet?: ReadonlyMap<string, readonly string[]>
}): Map<string, WalletBoardEntry> {
  const runs = dedupeRuns(input.facts.runs).filter(run => inMonth(run.dayKey, input.monthKey))
  const claimsByWallet = new Map<string, MonthlyClaimFacts[]>()
  for (const claim of input.facts.claims) {
    if (claim.status !== 'RESERVED' || !inMonth(claim.dayKey, input.monthKey)) continue
    const list = claimsByWallet.get(claim.wallet) ?? []
    list.push(claim)
    claimsByWallet.set(claim.wallet, list)
  }
  const payoutsByClaim = new Map<string, MonthlyPayoutFacts>()
  for (const payout of input.facts.payouts) {
    if (!payoutsByClaim.has(payout.claimId)) payoutsByClaim.set(payout.claimId, payout)
  }

  type MutableStats = { -readonly [K in keyof WalletMonthlyStats]: WalletMonthlyStats[K] }
  type MutableSlot = { stats: MutableStats; firstActivityAt: string; days: Set<string> }
  const slots = new Map<string, MutableSlot>()
  const ensure = (wallet: string): MutableSlot => {
    let slot = slots.get(wallet)
    if (!slot) {
      slot = { stats: emptyStats(), firstActivityAt: '', days: new Set<string>() }
      slots.set(wallet, slot)
    }
    return slot
  }

  for (const run of runs) {
    const slot = ensure(run.wallet)
    const stats = slot.stats
    stats.expeditionsStarted += 1
    if (!slot.firstActivityAt || run.startedAt < slot.firstActivityAt) slot.firstActivityAt = run.startedAt
    if (run.verified) {
      stats.gemsCollected += Math.max(0, Math.floor(run.verified.gemsCollected))
      stats.chestsOpened += Math.max(0, Math.floor(run.verified.chestsOpened))
    }
    const completed = isVaultCompletion(run)
    if (completed) {
      stats.expeditionsCompleted += 1
      slot.days.add(run.dayKey)
    } else if (isFailed(run)) {
      stats.expeditionsFailed += 1
    }
    if (completed && run.mission === 'vault-breaker' && run.vaultSealed) {
      stats.vaultsSealed += 1
    }
  }

  // Expedition minutes: sum capped per-run ms, then floor to whole minutes.
  const msByWallet = new Map<string, number>()
  for (const run of runs) {
    msByWallet.set(run.wallet, (msByWallet.get(run.wallet) ?? 0) + creditedRunMs(run))
  }

  const board = new Map<string, WalletBoardEntry>()
  for (const [wallet, slot] of slots) {
    const stats: MutableStats = { ...slot.stats }
    stats.expeditionMinutes = Math.floor((msByWallet.get(wallet) ?? 0) / 60_000)
    const days = new Set(slot.days)
    for (const prior of input.priorQualifyingDaysByWallet?.get(wallet) ?? []) days.add(prior)
    stats.bestStreak = longestStreakWithinMonth(days, input.monthKey)
    stats.currentStreak = currentStreakEndingToday(days, input.todayDay)
    stats.points = stats.gemsCollected * POINTS_PER_GEM
      + stats.chestsOpened * POINTS_PER_CHEST
      + stats.expeditionsCompleted * POINTS_PER_COMPLETION
      + stats.vaultsSealed * POINTS_PER_VAULT_SEAL

    let nimDelivered = 0
    let rewardsSecured = 0
    for (const claim of claimsByWallet.get(wallet) ?? []) {
      rewardsSecured += 1
      const payout = payoutsByClaim.get(claim.claimId)
      if (!payout || payout.status !== 'CONFIRMED') continue
      const amount = parseAmountLuna(payout.amountLuna)
      if (amount === null) continue
      nimDelivered += lunaToNimFloat(amount)
    }
    stats.nimDelivered = nimDelivered
    stats.rewardsSecured = rewardsSecured
    board.set(wallet, { wallet, stats, firstActivityAt: slot.firstActivityAt })
  }

  // Wallets with secured rewards but no runs in month still board (NIM heroes).
  for (const [wallet, walletClaims] of claimsByWallet) {
    if (board.has(wallet)) continue
    const stats: MutableStats = emptyStats()
    let nimDelivered = 0
    for (const claim of walletClaims) {
      stats.rewardsSecured += 1
      const payout = payoutsByClaim.get(claim.claimId)
      if (!payout || payout.status !== 'CONFIRMED') continue
      const amount = parseAmountLuna(payout.amountLuna)
      if (amount === null) continue
      nimDelivered += lunaToNimFloat(amount)
    }
    stats.nimDelivered = nimDelivered
    const days = new Set<string>()
    for (const prior of input.priorQualifyingDaysByWallet?.get(wallet) ?? []) days.add(prior)
    stats.bestStreak = longestStreakWithinMonth(days, input.monthKey)
    stats.currentStreak = currentStreakEndingToday(days, input.todayDay)
    board.set(wallet, { wallet, stats, firstActivityAt: '' })
  }

  return board
}

function metricValue(stats: WalletMonthlyStats, key: HeroMetricKey): number {
  return stats[key]
}

function compareBoardEntries(
  left: WalletBoardEntry,
  right: WalletBoardEntry,
  key: HeroMetricKey,
): number {
  const primary = metricValue(right.stats, key) - metricValue(left.stats, key)
  if (primary !== 0) return primary
  const completions = right.stats.expeditionsCompleted - left.stats.expeditionsCompleted
  if (completions !== 0) return completions
  if (left.firstActivityAt !== right.firstActivityAt) {
    return left.firstActivityAt < right.firstActivityAt ? -1 : 1
  }
  return left.wallet < right.wallet ? -1 : left.wallet > right.wallet ? 1 : 0
}

export function buildMonthlyHeroes(input: {
  readonly monthKey: string
  readonly generatedAt: string
  readonly board: ReadonlyMap<string, WalletBoardEntry>
}): MonthlyHeroesResponse {
  const entries = [...input.board.values()]
  const categories: MonthlyHeroCategory[] = HERO_CATEGORIES.map(def => {
    const ranked = entries
      .filter(entry => metricValue(entry.stats, def.metricKey) > 0)
      .sort((left, right) => compareBoardEntries(left, right, def.metricKey))
      .slice(0, 10)
    return {
      heroId: def.heroId,
      title: def.title,
      metricLabel: def.metricLabel,
      leaders: ranked.map((entry, index) => ({
        rank: index + 1,
        maskedWallet: maskWalletAddress(entry.wallet),
        value: metricValue(entry.stats, def.metricKey),
      })),
    }
  })
  return { ok: true, monthKey: input.monthKey, generatedAt: input.generatedAt, categories }
}

export function rankOfWallet(
  board: ReadonlyMap<string, WalletBoardEntry>,
  wallet: string,
  heroId: MonthlyHeroId,
): number | null {
  const def = HERO_CATEGORIES.find(category => category.heroId === heroId)
  if (!def) return null
  const ranked = [...board.values()]
    .filter(entry => metricValue(entry.stats, def.metricKey) > 0)
    .sort((left, right) => compareBoardEntries(left, right, def.metricKey))
  const index = ranked.findIndex(entry => entry.wallet === wallet)
  return index === -1 ? null : index + 1
}

export function buildWalletMonthlyStats(input: {
  readonly monthKey: string
  readonly board: ReadonlyMap<string, WalletBoardEntry>
  readonly wallet: string
}): WalletMonthlyStatsResponse {
  const entry = input.board.get(input.wallet)
  const stats = entry ? { ...entry.stats } : emptyStats()
  const ranks = {} as Record<MonthlyHeroId, number | null>
  for (const heroId of MONTHLY_HERO_IDS) ranks[heroId] = rankOfWallet(input.board, input.wallet, heroId)
  return { ok: true, monthKey: input.monthKey, stats, ranks }
}
