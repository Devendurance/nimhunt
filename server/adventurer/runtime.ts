import type { SupabaseClient } from '@supabase/supabase-js'
import { readServerSupabaseConfig, createSupabaseAdminClient } from '../ledger/config.js'
import { createAdventurerService } from './identity.js'
import { createSupabaseAdventurerIdentityStore } from './postgresStore.js'
import { createMemoryAdventurerIdentityStore } from './store.js'
import { createMemoryAdventurerStatsSource, createSupabaseAdventurerStatsSource } from './stats.js'
import type { AdventurerService } from './types.js'

export async function createDefaultAdventurerService(
  runtime: { readonly backend: 'memory' | 'postgres' | 'unavailable' },
  env: Record<string, string | undefined> = process.env,
): Promise<AdventurerService | null> {
  if (runtime.backend === 'memory') return createMemoryAdventurerService()
  if (runtime.backend !== 'postgres') return null
  const config = readServerSupabaseConfig(env)
  if (!config) return null
  const client = createSupabaseAdminClient(config)
  return createPostgresAdventurerService(client)
}

export function createMemoryAdventurerService(): AdventurerService {
  const store = createMemoryAdventurerIdentityStore()
  return createAdventurerService({ store, stats: createMemoryAdventurerStatsSource() })
}

export function createPostgresAdventurerService(client: SupabaseClient): AdventurerService {
  return createAdventurerService({
    store: createSupabaseAdventurerIdentityStore(client),
    stats: createSupabaseAdventurerStatsSource(client),
  })
}
