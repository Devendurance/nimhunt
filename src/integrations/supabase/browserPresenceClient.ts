// Browser Supabase client for Realtime Presence ONLY.
//
// Reads the public anon/publishable credentials from Vite env. The
// service-role key must NEVER appear here (server-only, no VITE_ prefix).
// Returns null when the public config is absent so presence UI degrades
// gracefully instead of showing a fake number.
//
// Required Vercel env (public, safe to expose):
//   VITE_SUPABASE_URL
//   VITE_SUPABASE_ANON_KEY  (or VITE_SUPABASE_PUBLISHABLE_KEY)
import type { SupabaseClient } from '@supabase/supabase-js'

export const SITE_PRESENCE_CHANNEL = 'nimhunt:site-presence' as const
export const SITE_VISITOR_STORAGE_KEY = 'nimhunt:visitor-id' as const

export type BrowserSupabaseConfig = {
  readonly url: string
  readonly anonKey: string
}

export function readBrowserSupabaseConfig(
  env: Record<string, string | undefined> = readViteEnv(),
): BrowserSupabaseConfig | null {
  const url = env.VITE_SUPABASE_URL?.trim()
  const anonKey = env.VITE_SUPABASE_ANON_KEY?.trim() || env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()
  if (!url || !anonKey) return null
  return { url, anonKey }
}

let cached: SupabaseClient | null | undefined

export async function getBrowserSupabaseClient(): Promise<SupabaseClient | null> {
  if (cached !== undefined) return cached
  const config = readBrowserSupabaseConfig()
  if (!config) {
    cached = null
    return cached
  }
  try {
    const { createClient } = await import('@supabase/supabase-js')
    cached = createClient(config.url, config.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      realtime: { params: { eventsPerSecond: 5 } },
    })
  } catch {
    cached = null
  }
  return cached
}

/** Test seam: reset the cached client between tests. */
export function resetBrowserSupabaseClientForTests(): void {
  cached = undefined
}

function readViteEnv(): Record<string, string | undefined> {
  try {
    if (typeof import.meta !== 'undefined' && import.meta.env) {
      return import.meta.env as Record<string, string | undefined>
    }
  } catch {
    /* non-Vite runtime (tests) — fall through */
  }
  return {}
}
