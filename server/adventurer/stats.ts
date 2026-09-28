import type { AdventurerStats } from '../../src/domain/adventurer.js'
import { isQualifyingCompletion, type MonthlyRunFacts } from '../monthlyHeroes/service.js'
import { mapSupabaseRun } from '../monthlyHeroes/store.js'
import { AdventurerUnavailableError } from './errors.js'
import type { AdventurerStatsSource } from './types.js'
import type { SupabaseClient } from '@supabase/supabase-js'

const RUN_PAGE_SIZE = 1_000

export function deriveAdventurerStats(runs: readonly MonthlyRunFacts[]): AdventurerStats {
  const seen = new Set<string>()
  let lifetimeGems = 0
  let expeditionsCompleted = 0
  const qualifyingDays = new Set<string>()

  for (const run of runs) {
    if (!run.runId || seen.has(run.runId)) continue
    seen.add(run.runId)
    if (run.verified) {
      lifetimeGems += Math.max(0, Math.floor(run.verified.gemsCollected))
    }
    if (!isQualifyingCompletion(run)) continue
    expeditionsCompleted += 1
    if (/^\d{4}-\d{2}-\d{2}$/.test(run.dayKey)) qualifyingDays.add(run.dayKey)
  }

  return {
    lifetimeGems,
    expeditionsCompleted,
    bestStreak: longestUtcStreak(qualifyingDays),
  }
}

export function longestUtcStreak(days: ReadonlySet<string>): number {
  const sorted = [...days].filter(isUtcDay).sort()
  let best = 0
  let current = 0
  let previous: string | null = null
  for (const day of sorted) {
    if (previous !== null && utcDayAfter(previous) === day) current += 1
    else current = 1
    best = Math.max(best, current)
    previous = day
  }
  return best
}

export function createMemoryAdventurerStatsSource(seed: readonly MonthlyRunFacts[] = []): AdventurerStatsSource & {
  seedRun(run: MonthlyRunFacts): void
} {
  const runs = [...seed]
  return {
    seedRun(run) {
      runs.push(run)
    },
    async loadWalletRuns(wallet) {
      return runs.filter(run => run.wallet === wallet)
    },
  }
}

export function createSupabaseAdventurerStatsSource(client: SupabaseClient): AdventurerStatsSource {
  return {
    async loadWalletRuns(wallet) {
      const rows: Record<string, unknown>[] = []
      for (let from = 0; ; from += RUN_PAGE_SIZE) {
        const { data, error } = await client
          .from('expedition_runs')
          .select('id,day_key,wallet,mission_type,started_at,ended_at,gameplay_started_at,terminal')
          .eq('wallet', wallet)
          .order('day_key', { ascending: true })
          .order('started_at', { ascending: true })
          .range(from, from + RUN_PAGE_SIZE - 1)
        if (error) throw new AdventurerUnavailableError()
        const page = Array.isArray(data) ? data as Record<string, unknown>[] : []
        rows.push(...page)
        if (page.length < RUN_PAGE_SIZE) break
      }
      return rows.flatMap(row => {
        const mapped = mapSupabaseRun(row, new Set())
        return mapped && mapped.wallet === wallet ? [mapped] : []
      })
    },
  }
}

function isUtcDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

function utcDayAfter(day: string): string {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) + 86_400_000).toISOString().slice(0, 10)
}
