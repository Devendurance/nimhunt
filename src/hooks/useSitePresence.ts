// Live "Explorers online" via Supabase Realtime Presence.
//
// "Online" = the number of UNIQUE presence keys in the shared
// `nimhunt:site-presence` channel. One anonymous browser visitor ID
// (persisted in localStorage) maps to exactly one presence key, so route
// changes and remounts inside one SPA session never double-count.
//
// Presence payloads carry only harmless state (visitorId, route, joinedAt).
// Wallet addresses, IPs, emails, and personal info are never tracked.
//
// Mount <SitePresenceBeacon /> once at the app root so visitors on BOTH /
// and /play count as online through a single shared channel. UI reads the
// shared count with useSitePresence(). When Presence is unavailable the
// status is 'unavailable' (online null) — the UI must not claim zero.
import { useEffect, useSyncExternalStore } from 'react'
import { useLocation } from 'react-router-dom'
import {
  SITE_PRESENCE_CHANNEL,
  SITE_VISITOR_STORAGE_KEY,
  getBrowserSupabaseClient,
} from '../integrations/supabase/browserPresenceClient.ts'

export const SITE_PRESENCE_EVENT = 'sync' as const

export type SitePresenceStatus = 'connecting' | 'live' | 'unavailable'

export type SitePresenceSnapshot = {
  readonly status: SitePresenceStatus
  /** Unique online visitor keys. Null unless status is 'live'. */
  readonly online: number | null
}

export type PresenceStateMap = Record<string, readonly unknown[]>

/** Count UNIQUE presence keys with at least one tracked presence. */
export function countPresenceKeys(state: PresenceStateMap | null | undefined): number {
  if (!state || typeof state !== 'object') return 0
  let count = 0
  for (const key of Object.keys(state)) {
    const presences = state[key]
    if (Array.isArray(presences) && presences.length > 0) count += 1
  }
  return count
}

const VISITOR_TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,128}$/
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isVisitorId(value: unknown): value is string {
  return typeof value === 'string' && (UUID_PATTERN.test(value) || VISITOR_TOKEN_PATTERN.test(value))
}

export function readVisitorId(
  storage: Pick<Storage, 'getItem'> | null = browserStorage(),
): string | null {
  if (!storage) return null
  try {
    const existing = storage.getItem(SITE_VISITOR_STORAGE_KEY)
    return isVisitorId(existing) ? existing : null
  } catch {
    return null
  }
}

export function getOrCreateVisitorId(
  storage: Pick<Storage, 'getItem' | 'setItem'> | null = browserStorage(),
  randomId: () => string = createRandomVisitorId,
): string {
  const existing = readVisitorId(storage)
  if (existing) return existing
  const created = randomId()
  if (storage) {
    try {
      storage.setItem(SITE_VISITOR_STORAGE_KEY, created)
    } catch {
      /* private mode / quota — still return the in-memory id for this session */
    }
  }
  return created
}

export function createRandomVisitorId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  const bytes = new Uint8Array(16)
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes)
  } else {
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256)
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x40
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export type PresenceChannelLike = {
  on(event: 'presence', filter: { readonly event: string }, callback: () => void): PresenceChannelLike
  subscribe(callback: (status: string) => void): void
  track(payload: Record<string, string>): Promise<void>
  presenceState(): PresenceStateMap
  unsubscribe(): void | Promise<void>
}

export type PresenceClientLike = {
  channel(name: string, options: { readonly config: { readonly presence: { readonly key: string } } }): PresenceChannelLike
  removeChannel(channel: PresenceChannelLike): void | Promise<void>
}

/**
 * Refcounted shared presence session. Multiple hook instances (StrictMode
 * remounts, App + page mounts) share ONE channel keyed by ONE visitor ID,
 * so a single SPA session is never double-counted.
 */
export class SharedSitePresence {
  private refs = 0
  private snapshot: SitePresenceSnapshot = { status: 'connecting', online: null }
  private listeners = new Set<(snapshot: SitePresenceSnapshot) => void>()
  private client: PresenceClientLike | null = null
  private channel: PresenceChannelLike | null = null
  private visitorId: string | null = null
  private joinedAt: string | null = null
  private route = '/'
  private readonly getClient: () => Promise<PresenceClientLike | null>
  private readonly storage: Pick<Storage, 'getItem' | 'setItem'> | null
  private readonly now: () => string

  constructor(
    getClient: () => Promise<PresenceClientLike | null> = defaultGetClient,
    storage: Pick<Storage, 'getItem' | 'setItem'> | null = browserStorage(),
    now: () => string = () => new Date().toISOString(),
  ) {
    this.getClient = getClient
    this.storage = storage
    this.now = now
  }

  getSnapshot(): SitePresenceSnapshot {
    return this.snapshot
  }

  subscribe(listener: (snapshot: SitePresenceSnapshot) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  acquire(route = '/'): void {
    this.refs += 1
    this.route = normalizeRoute(route)
    if (this.refs === 1) {
      void this.start()
    } else if (this.channel) {
      void this.retrack()
    }
  }

  updateRoute(route: string): void {
    const next = normalizeRoute(route)
    if (next === this.route) return
    this.route = next
    if (this.channel) void this.retrack()
  }

  release(): void {
    if (this.refs <= 0) return
    this.refs -= 1
    if (this.refs === 0) void this.stop()
  }

  /** Test seam: number of active acquirers. */
  refCountForTests(): number {
    return this.refs
  }

  private async start(): Promise<void> {
    this.setSnapshot({ status: 'connecting', online: null })
    let client: PresenceClientLike | null
    try {
      client = await this.getClient()
    } catch {
      client = null
    }
    if (this.refs === 0) return
    if (!client) {
      this.setSnapshot({ status: 'unavailable', online: null })
      return
    }
    this.client = client
    this.visitorId = getOrCreateVisitorId(this.storage)
    this.joinedAt = this.now()
    const visitorId = this.visitorId
    try {
      const channel = client.channel(SITE_PRESENCE_CHANNEL, { config: { presence: { key: visitorId } } })
      this.channel = channel
      channel.on('presence', { event: SITE_PRESENCE_EVENT }, () => {
        if (this.channel !== channel) return
        try {
          this.setSnapshot({ status: 'live', online: countPresenceKeys(channel.presenceState()) })
        } catch {
          /* keep the last live snapshot on malformed state */
        }
      })
      channel.subscribe(status => {
        if (this.channel !== channel) return
        if (status === 'SUBSCRIBED') {
          void this.retrack()
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          this.setSnapshot({ status: 'unavailable', online: null })
        }
      })
    } catch {
      this.channel = null
      this.setSnapshot({ status: 'unavailable', online: null })
    }
  }

  private async retrack(): Promise<void> {
    const channel = this.channel
    const visitorId = this.visitorId
    if (!channel || !visitorId) return
    try {
      await channel.track({ visitorId, route: this.route, joinedAt: this.joinedAt ?? this.now() })
    } catch {
      /* transient track failure — next sync or route change retries */
    }
  }

  private async stop(): Promise<void> {
    const client = this.client
    const channel = this.channel
    this.client = null
    this.channel = null
    this.visitorId = null
    this.joinedAt = null
    this.setSnapshot({ status: 'connecting', online: null })
    if (client && channel) {
      try {
        await client.removeChannel(channel)
      } catch {
        /* teardown best-effort */
      }
      try {
        await channel.unsubscribe()
      } catch {
        /* teardown best-effort */
      }
    }
  }

  private setSnapshot(next: SitePresenceSnapshot): void {
    this.snapshot = next
    for (const listener of [...this.listeners]) listener(next)
  }
}

async function defaultGetClient(): Promise<PresenceClientLike | null> {
  const client = await getBrowserSupabaseClient()
  return (client as unknown as PresenceClientLike | null) ?? null
}

function normalizeRoute(route: string): string {
  if (!route || !route.startsWith('/')) return '/'
  const pathname = route.split('?')[0]?.split('#')[0] ?? '/'
  return pathname.length > 0 ? pathname : '/'
}

function browserStorage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null
    return localStorage
  } catch {
    return null
  }
}

const sharedPresence = new SharedSitePresence()

/**
 * Shared live-presence snapshot. Subscribes only — the channel lifecycle is
 * owned by <SitePresenceBeacon /> (one channel per SPA session). Reporting
 * the current route keeps the payload fresh without creating new keys.
 */
export function useSitePresence(route: string): SitePresenceSnapshot {
  const snapshot = useSyncExternalStore(
    (onChange) => sharedPresence.subscribe(onChange),
    () => sharedPresence.getSnapshot(),
  )

  useEffect(() => {
    sharedPresence.updateRoute(route)
  }, [route])

  return snapshot
}

/**
 * Global presence tracker. Mount ONCE at the app root (App) so visitors on
 * both / and /play share one channel and one visitor key. Renders nothing.
 */
export function SitePresenceBeacon(): null {
  const location = useLocation()

  useEffect(() => {
    sharedPresence.acquire()
    return () => {
      sharedPresence.release()
    }
  }, [])

  useEffect(() => {
    sharedPresence.updateRoute(location.pathname)
  }, [location.pathname])

  return null
}
