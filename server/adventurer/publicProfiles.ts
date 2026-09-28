import type { SupabaseClient } from '@supabase/supabase-js'
import type { PublicAdventurerProfile } from '../../src/domain/adventurer.js'
import { mapSupabaseRun, type MonthlyHeroesProfileResolver } from '../monthlyHeroes/store.js'
import { deriveAdventurerStats } from './stats.js'
import { AdventurerUnavailableError } from './errors.js'
import type { MonthlyRunFacts } from '../monthlyHeroes/service.js'

const RUN_PAGE_SIZE = 1_000

type SupabaseRow = Record<string, unknown>

/**
 * Resolves only public identity fields for a bounded set of leaderboard
 * wallets. Profiles and lifetime stats are fetched in two batched queries;
 * no public wallet value leaves this server-side resolver.
 */
export function createSupabasePublicAdventurerProfileResolver(client: SupabaseClient): MonthlyHeroesProfileResolver {
  return async (wallets): Promise<ReadonlyMap<string, PublicAdventurerProfile>> => {
    const uniqueWallets = [...new Set(wallets)].filter(wallet => wallet.length > 0 && wallet.length <= 80)
    if (uniqueWallets.length === 0) return new Map()

    const { data: profileRows, error: profileError } = await client
      .from('adventurer_profiles')
      .select('player_id,wallet,display_name,avatar_id')
      .in('wallet', uniqueWallets)
    if (profileError) throw new AdventurerUnavailableError()

    const profilesByWallet = new Map<string, { readonly playerId: string; readonly displayName: string; readonly avatarId: string }>()
    for (const row of (Array.isArray(profileRows) ? profileRows : []) as SupabaseRow[]) {
      const playerId = asString(row.player_id)
      const wallet = asString(row.wallet)
      const displayName = asString(row.display_name)
      const avatarId = asString(row.avatar_id)
      if (!playerId || !wallet || !displayName || !avatarId) continue
      profilesByWallet.set(wallet, { playerId, displayName, avatarId })
    }

    const profileWallets = [...profilesByWallet.keys()]
    if (profileWallets.length === 0) return new Map()
    const runsByWallet = new Map<string, MonthlyRunFacts[]>()
    for (let from = 0; ; from += RUN_PAGE_SIZE) {
      const { data: runRows, error: runError } = await client
        .from('expedition_runs')
        .select('id,day_key,wallet,mission_type,started_at,ended_at,gameplay_started_at,terminal')
        .in('wallet', profileWallets)
        .order('day_key', { ascending: true })
        .order('started_at', { ascending: true })
        .range(from, from + RUN_PAGE_SIZE - 1)
      if (runError) throw new AdventurerUnavailableError()
      const page = Array.isArray(runRows) ? runRows as SupabaseRow[] : []
      for (const row of page) {
        const mapped = mapSupabaseRun(row, new Set())
        if (!mapped) continue
        const runs = runsByWallet.get(mapped.wallet) ?? []
        runs.push(mapped)
        runsByWallet.set(mapped.wallet, runs)
      }
      if (page.length < RUN_PAGE_SIZE) break
    }

    const resolved = new Map<string, PublicAdventurerProfile>()
    for (const [wallet, profile] of profilesByWallet) {
      const stats = deriveAdventurerStats(runsByWallet.get(wallet) ?? [])
      resolved.set(wallet, {
        playerId: profile.playerId,
        displayName: profile.displayName,
        avatarId: profile.avatarId,
        lifetimeGems: stats.lifetimeGems,
        expeditionsCompleted: stats.expeditionsCompleted,
        bestStreak: stats.bestStreak,
      })
    }
    return resolved
  }
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}
