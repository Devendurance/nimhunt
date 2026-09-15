import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export type ServerSupabaseConfig = {
  url: string
  serviceRoleKey: string
}

export function readServerSupabaseConfig(
  env: Record<string, string | undefined> = process.env,
): ServerSupabaseConfig | null {
  const url = env.SUPABASE_URL?.trim()
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim() || env.SUPABASE_SECRET_KEY?.trim()
  if (!url || !serviceRoleKey) return null
  return { url, serviceRoleKey }
}

export function createSupabaseAdminClient(config: ServerSupabaseConfig): SupabaseClient {
  return createClient(config.url, config.serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
}
