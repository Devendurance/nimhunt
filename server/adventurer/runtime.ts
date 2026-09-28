import type { SupabaseClient } from '@supabase/supabase-js'
import { readServerSupabaseConfig, createSupabaseAdminClient } from '../ledger/config.js'
import { createAdventurerService } from './identity.js'
import { createSupabaseAdventurerIdentityStore } from './postgresStore.js'
import { createMemoryAdventurerIdentityStore } from './store.js'
import { createMemoryAdventurerStatsSource, createSupabaseAdventurerStatsSource } from './stats.js'
import { createAdventurerSocialService } from './social.js'
import { createSupabaseAdventurerSocialStore } from './socialPostgresStore.js'
import { createMemoryAdventurerSocialStore } from './socialStore.js'
import type { AdventurerSocialService } from './socialTypes.js'
import type { AdventurerService } from './types.js'

export type AdventurerServices = {
  readonly identity: AdventurerService
  readonly social: AdventurerSocialService
}

export async function createDefaultAdventurerService(
  runtime: { readonly backend: 'memory' | 'postgres' | 'unavailable' },
  env: Record<string, string | undefined> = process.env,
): Promise<AdventurerService | null> {
  const services = await createDefaultAdventurerServices(runtime, env)
  return services?.identity ?? null
}

export async function createDefaultAdventurerServices(
  runtime: { readonly backend: 'memory' | 'postgres' | 'unavailable' },
  env: Record<string, string | undefined> = process.env,
): Promise<AdventurerServices | null> {
  if (runtime.backend === 'memory') return createMemoryAdventurerServices()
  if (runtime.backend !== 'postgres') return null
  const config = readServerSupabaseConfig(env)
  if (!config) return null
  return createPostgresAdventurerServices(createSupabaseAdminClient(config))
}

export function createMemoryAdventurerService(): AdventurerService {
  return createMemoryAdventurerServices().identity
}

export function createMemoryAdventurerServices(): AdventurerServices {
  const identityStore = createMemoryAdventurerIdentityStore()
  const socialStore = createMemoryAdventurerSocialStore(playerId => identityStore.getProfileByPlayerId(playerId).then(profile => profile ? {
    playerId: profile.playerId,
    displayName: profile.displayName,
    avatarId: profile.avatarId,
  } : null))
  return {
    identity: createAdventurerService({ store: identityStore, stats: createMemoryAdventurerStatsSource() }),
    social: createAdventurerSocialService(socialStore),
  }
}

export function createPostgresAdventurerService(client: SupabaseClient): AdventurerService {
  return createPostgresAdventurerServices(client).identity
}

export function createPostgresAdventurerServices(client: SupabaseClient): AdventurerServices {
  return {
    identity: createAdventurerService({
      store: createSupabaseAdventurerIdentityStore(client),
      stats: createSupabaseAdventurerStatsSource(client),
    }),
    social: createAdventurerSocialService(createSupabaseAdventurerSocialStore(client)),
  }
}
