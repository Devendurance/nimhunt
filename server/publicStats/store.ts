// Public usage-proof data source. Read-only over the existing
// public.expedition_runs table. No migration, no new RPC, no gameplay,
// payout, or scheduler mutation is reachable from here.
//
// Gamer definition: COUNT(DISTINCT wallet) over rows with
// gameplay_started_at IS NOT NULL — unique wallets that actually entered
// gameplay. Signed Starts that never entered gameplay (gameplay_started_at
// NULL) never count, and repeated runs by one wallet count once.
import type { SupabaseClient } from '@supabase/supabase-js'
import { PublicStatsError } from './http-shared.js'

export type GamerRunSeed = {
  readonly wallet: string
  readonly gameplayStartedAt: string | null
}

export type PublicStatsSource = {
  countGamers(): Promise<number>
}

/** Pure gamer rule shared by the memory + Supabase sources (and tests). */
export function isGamerRow(row: { readonly wallet: unknown; readonly gameplayStartedAt: unknown }): boolean {
  return (
    typeof row.wallet === 'string' &&
    row.wallet.length > 0 &&
    row.gameplayStartedAt !== null &&
    row.gameplayStartedAt !== undefined
  )
}

export function countDistinctGamers(rows: readonly GamerRunSeed[]): number {
  const wallets = new Set<string>()
  for (const row of rows) {
    if (isGamerRow(row)) wallets.add(row.wallet)
  }
  return wallets.size
}

export function createMemoryPublicStatsSource(seed: readonly GamerRunSeed[] = []): PublicStatsSource {
  const rows = [...seed]
  return {
    async countGamers(): Promise<number> {
      return countDistinctGamers(rows)
    },
  }
}

export function createSupabasePublicStatsSource(client: SupabaseClient): PublicStatsSource {
  return {
    async countGamers(): Promise<number> {
      // Service-role only via the narrowly-scoped SECURITY DEFINER RPC
      // (013_public_gamer_count.sql). Count only — the browser never touches
      // expedition_runs (RLS has no anon/authenticated policies) and no
      // wallet rows ever leave the server. Missing RPC fails closed.
      const { data, error } = await client.rpc('get_public_gamer_count')
      if (error) throw new PublicStatsError('STATS_UNAVAILABLE')
      const count = Number(data)
      if (!Number.isFinite(count) || count < 0) throw new PublicStatsError('STATS_UNAVAILABLE')
      return Math.floor(count)
    },
  }
}

export async function createDefaultPublicStatsSource(
  runtime: { readonly backend: 'memory' | 'postgres' | 'unavailable' },
  env: Record<string, string | undefined> = process.env,
): Promise<PublicStatsSource | null> {
  if (runtime.backend === 'memory') return createMemoryPublicStatsSource()
  if (runtime.backend !== 'postgres') return null
  const { readServerSupabaseConfig, createSupabaseAdminClient } = await import('../ledger/config.js')
  const config = readServerSupabaseConfig(env)
  if (!config) return null
  return createSupabasePublicStatsSource(createSupabaseAdminClient(config))
}
