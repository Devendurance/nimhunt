// Monthly Heroes data sources. Read-only over existing durable tables.
// No migration, no new RPC: service-role selects on expedition_runs,
// expedition_vault_seals, reward_claims, and reward_payouts.
import type { SupabaseClient } from '@supabase/supabase-js'
import { MonthlyHeroesError } from './http-shared.js'
import type { MonthlyClaimFacts, MonthlyFacts, MonthlyPayoutFacts, MonthlyRunFacts } from './service.js'

export const MONTH_RUN_CAP = 20000
export const MONTH_CLAIM_CAP = 5000
export const MONTH_PAYOUT_CAP = 5000
export const STREAK_LOOKBACK_DAYS = 62

export type MonthlyHeroesSource = {
  loadMonthFacts(monthKey: string): Promise<{ facts: MonthlyFacts; truncated: boolean }>
  /** Qualifying UTC days strictly before monthStartDay (streak look-back). */
  loadPriorQualifyingDays(wallet: string, monthStartDay: string): Promise<readonly string[]>
}

export function monthDayRange(monthKey: string): { start: string; end: string } {
  const year = Number(monthKey.slice(0, 4))
  const month = Number(monthKey.slice(5, 7))
  const start = `${monthKey}-01`
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return { start, end: `${monthKey}-${String(lastDay).padStart(2, '0')}` }
}

export function lookbackStartDay(monthStartDay: string): string {
  return new Date(Date.parse(`${monthStartDay}T00:00:00.000Z`) - STREAK_LOOKBACK_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 10)
}

export function createMemoryMonthlyHeroesSource(seed: MonthlyFacts = { runs: [], claims: [], payouts: [] }): MonthlyHeroesSource & {
  seedRun(run: MonthlyRunFacts): void
  seedClaim(claim: MonthlyClaimFacts): void
  seedPayout(payout: MonthlyPayoutFacts): void
} {
  const runs: MonthlyRunFacts[] = [...seed.runs]
  const claims: MonthlyClaimFacts[] = [...seed.claims]
  const payouts: MonthlyPayoutFacts[] = [...seed.payouts]
  return {
    seedRun(run) {
      runs.push(run)
    },
    seedClaim(claim) {
      claims.push(claim)
    },
    seedPayout(payout) {
      payouts.push(payout)
    },
    async loadMonthFacts() {
      return { facts: { runs: [...runs], claims: [...claims], payouts: [...payouts] }, truncated: false }
    },
    async loadPriorQualifyingDays() {
      return []
    },
  }
}

type SupabaseRow = Record<string, unknown>

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function asDay(value: unknown): string | null {
  const text = asString(value)?.slice(0, 10) ?? null
  return text && /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null
}

function asIsoOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const text = String(value)
  const parsed = new Date(text)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

function asMission(value: unknown): MonthlyRunFacts['mission'] | null {
  return value === 'gem-runner' || value === 'chest-hunter' || value === 'vault-breaker' ? value : null
}

function asNonNegativeInt(value: unknown): number {
  const num = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(num) || num < 0) return 0
  return Math.floor(num)
}

function parseVerifiedFacts(terminal: unknown): MonthlyRunFacts['verified'] {
  if (typeof terminal !== 'object' || terminal === null || Array.isArray(terminal)) return null
  const row = terminal as SupabaseRow
  if (row.type !== 'VERIFIED') return null
  if (typeof row.result !== 'object' || row.result === null || Array.isArray(row.result)) return null
  const result = row.result as SupabaseRow
  const outcome = result.outcome
  if (outcome !== 'VERIFIED_ELIGIBLE' && outcome !== 'VAULT_GAMEPLAY_VERIFIED' && outcome !== 'FAILED') return null
  return {
    outcome,
    gemsCollected: asNonNegativeInt(result.gemsCollected),
    chestsOpened: asNonNegativeInt(result.chestsOpened),
    objectiveReached: result.objectiveReached === true,
    missionSatisfied: result.missionSatisfied === true,
    finalHp: typeof result.finalHp === 'number' && Number.isFinite(result.finalHp) ? result.finalHp : 0,
  }
}

export function mapSupabaseRun(row: SupabaseRow, sealedRunIds: ReadonlySet<string>): MonthlyRunFacts | null {
  const runId = asString(row.id)
  const wallet = asString(row.wallet)
  const mission = asMission(row.mission_type)
  const dayKey = asDay(row.day_key)
  const startedAt = asIsoOrNull(row.started_at)
  if (!runId || !wallet || !mission || !dayKey || !startedAt) return null
  return {
    runId,
    wallet,
    mission,
    dayKey,
    startedAt,
    endedAt: asIsoOrNull(row.ended_at),
    gameplayStartedAt: asIsoOrNull(row.gameplay_started_at),
    verified: parseVerifiedFacts(row.terminal),
    vaultSealed: sealedRunIds.has(runId),
  }
}

export function createSupabaseMonthlyHeroesSource(client: SupabaseClient): MonthlyHeroesSource {
  return {
    async loadMonthFacts(monthKey: string): Promise<{ facts: MonthlyFacts; truncated: boolean }> {
      const { start, end } = monthDayRange(monthKey)
      let truncated = false

      const { data: runRows, error: runError } = await client
        .from('expedition_runs')
        .select('id,day_key,wallet,mission_type,started_at,ended_at,gameplay_started_at,terminal')
        .gte('day_key', start)
        .lte('day_key', end)
        .order('started_at', { ascending: true })
        .limit(MONTH_RUN_CAP + 1)
      if (runError) throw new MonthlyHeroesError('HEROES_UNAVAILABLE')
      const rawRuns = Array.isArray(runRows) ? runRows as SupabaseRow[] : []
      if (rawRuns.length > MONTH_RUN_CAP) truncated = true
      const cappedRuns = rawRuns.slice(0, MONTH_RUN_CAP)
      const runIds = cappedRuns.map(row => asString(row.id)).filter((id): id is string => id !== null)

      const sealedRunIds = new Set<string>()
      for (const chunk of chunkOf(runIds, 200)) {
        if (chunk.length === 0) continue
        const { data: sealRows, error: sealError } = await client
          .from('expedition_vault_seals')
          .select('run_id')
          .in('run_id', chunk)
        if (sealError) throw new MonthlyHeroesError('HEROES_UNAVAILABLE')
        for (const seal of (Array.isArray(sealRows) ? sealRows : []) as SupabaseRow[]) {
          const runId = asString(seal.run_id)
          if (runId) sealedRunIds.add(runId)
        }
      }

      const runs: MonthlyRunFacts[] = []
      for (const row of cappedRuns) {
        const mapped = mapSupabaseRun(row, sealedRunIds)
        if (mapped) runs.push(mapped)
      }

      const { data: claimRows, error: claimError } = await client
        .from('reward_claims')
        .select('claim_id,run_id,wallet,day_key,status')
        .gte('day_key', start)
        .lte('day_key', end)
        .limit(MONTH_CLAIM_CAP + 1)
      if (claimError) throw new MonthlyHeroesError('HEROES_UNAVAILABLE')
      const rawClaims = Array.isArray(claimRows) ? claimRows as SupabaseRow[] : []
      if (rawClaims.length > MONTH_CLAIM_CAP) truncated = true
      const claims: MonthlyClaimFacts[] = []
      const claimIds: string[] = []
      for (const row of rawClaims.slice(0, MONTH_CLAIM_CAP)) {
        const claimId = asString(row.claim_id)
        const wallet = asString(row.wallet)
        const dayKey = asDay(row.day_key)
        const status = asString(row.status)
        if (!claimId || !wallet || !dayKey || !status) continue
        claims.push({ claimId, runId: asString(row.run_id) ?? '', wallet, dayKey, status })
        claimIds.push(claimId)
      }

      const payouts: MonthlyPayoutFacts[] = []
      for (const chunk of chunkOf(claimIds, 200)) {
        if (chunk.length === 0) continue
        const { data: payoutRows, error: payoutError } = await client
          .from('reward_payouts')
          .select('claim_id,wallet,amount_luna,status')
          .in('claim_id', chunk)
          .limit(MONTH_PAYOUT_CAP)
        if (payoutError) throw new MonthlyHeroesError('HEROES_UNAVAILABLE')
        for (const row of (Array.isArray(payoutRows) ? payoutRows : []) as SupabaseRow[]) {
          const claimId = asString(row.claim_id)
          const wallet = asString(row.wallet)
          const amount = row.amount_luna
          const status = asString(row.status)
          if (!claimId || !wallet || !status) continue
          payouts.push({ claimId, wallet, amountLuna: String(amount ?? ''), status })
        }
      }

      return { facts: { runs, claims, payouts }, truncated }
    },

    async loadPriorQualifyingDays(wallet: string, monthStartDay: string): Promise<readonly string[]> {
      if (!wallet || wallet.length > 80) throw new MonthlyHeroesError('HEROES_UNAVAILABLE')
      const from = lookbackStartDay(monthStartDay)
      const { data: rows, error } = await client
        .from('expedition_runs')
        .select('id,day_key,terminal')
        .eq('wallet', wallet)
        .gte('day_key', from)
        .lt('day_key', monthStartDay)
        .limit(1000)
      if (error) throw new MonthlyHeroesError('HEROES_UNAVAILABLE')
      const days = new Set<string>()
      for (const row of (Array.isArray(rows) ? rows : []) as SupabaseRow[]) {
        const dayKey = asDay(row.day_key)
        if (!dayKey) continue
        const verified = parseVerifiedFacts(row.terminal)
        if (!verified) continue
        // Qualifying day: verified completion. Vault gameplay counts when the
        // objective was reached and the run survived (mirror of service rule;
        // VAULT_GAMEPLAY_VERIFIED only occurs for vault-breaker runs).
        if (verified.outcome === 'VERIFIED_ELIGIBLE' && verified.missionSatisfied && verified.finalHp > 0) {
          days.add(dayKey)
        } else if (verified.outcome === 'VAULT_GAMEPLAY_VERIFIED' && verified.objectiveReached && verified.finalHp > 0) {
          days.add(dayKey)
        }
      }
      return [...days]
    },
  }
}

export async function createDefaultMonthlyHeroesSource(
  runtime: { readonly backend: 'memory' | 'postgres' | 'unavailable' },
  env: Record<string, string | undefined> = process.env,
): Promise<MonthlyHeroesSource | null> {
  if (runtime.backend === 'memory') return createMemoryMonthlyHeroesSource()
  if (runtime.backend !== 'postgres') return null
  const { readServerSupabaseConfig, createSupabaseAdminClient } = await import('../ledger/config.js')
  const config = readServerSupabaseConfig(env)
  if (!config) return null
  return createSupabaseMonthlyHeroesSource(createSupabaseAdminClient(config))
}

function chunkOf<T>(values: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let index = 0; index < values.length; index += size) out.push(values.slice(index, index + size))
  return out
}
