// Site-presence tests: unique-key counting, visitor-ID persistence (no
// double-count across route changes), single shared channel, and cleanup.
import { describe, expect, it } from 'vitest'
import {
  SharedSitePresence,
  countPresenceKeys,
  getOrCreateVisitorId,
  isVisitorId,
  readVisitorId,
  type PresenceChannelLike,
  type PresenceClientLike,
  type PresenceStateMap,
} from './useSitePresence.ts'
import { SITE_PRESENCE_CHANNEL } from '../integrations/supabase/browserPresenceClient.ts'

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(initial))
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value)
    },
    removeItem: (key: string) => {
      data.delete(key)
    },
    clear: () => data.clear(),
    key: (index: number) => [...data.keys()][index] ?? null,
    get length() {
      return data.size
    },
  } as Storage
}

type FakeChannel = PresenceChannelLike & {
  tracks: Record<string, string>[]
  syncCallbacks: (() => void)[]
  subscribeCallbacks: ((status: string) => void)[]
  state: PresenceStateMap
  unsubscribed: boolean
  emitSync(): void
  emitSubscribe(status: string): void
}

function createFakeChannel(): FakeChannel {
  const channel = {} as FakeChannel
  channel.tracks = []
  channel.syncCallbacks = []
  channel.subscribeCallbacks = []
  channel.state = {}
  channel.unsubscribed = false
  channel.on = (_event: 'presence', _filter: { readonly event: string }, callback: () => void) => {
    channel.syncCallbacks.push(callback)
    return channel
  }
  channel.subscribe = (callback: (status: string) => void) => {
    channel.subscribeCallbacks.push(callback)
  }
  channel.track = async (payload: Record<string, string>) => {
    channel.tracks.push(payload)
  }
  channel.presenceState = () => channel.state
  channel.unsubscribe = () => {
    channel.unsubscribed = true
  }
  channel.emitSync = () => {
    for (const callback of [...channel.syncCallbacks]) callback()
  }
  channel.emitSubscribe = (status: string) => {
    for (const callback of [...channel.subscribeCallbacks]) callback(status)
  }
  return channel
}

function createFakeClient(channels: FakeChannel[]): PresenceClientLike & { removed: PresenceChannelLike[] } {
  return {
    removed: [],
    channel(name: string, options: { readonly config: { readonly presence: { readonly key: string } } }) {
      if (name !== SITE_PRESENCE_CHANNEL) throw new Error('unexpected channel')
      if (typeof options.config.presence.key !== 'string' || options.config.presence.key.length === 0) {
        throw new Error('presence key must be the visitor id')
      }
      const channel = createFakeChannel()
      channels.push(channel)
      return channel
    },
    removeChannel(channel: PresenceChannelLike) {
      ;(this as { removed: PresenceChannelLike[] }).removed.push(channel)
    },
  }
}

async function flush(times = 5): Promise<void> {
  for (let index = 0; index < times; index += 1) await Promise.resolve()
}

describe('countPresenceKeys', () => {
  it('deduplicates visitor keys and ignores empty slots', () => {
    expect(countPresenceKeys(null)).toBe(0)
    expect(countPresenceKeys(undefined)).toBe(0)
    expect(
      countPresenceKeys({
        'visitor-a': [{ visitorId: 'visitor-a', route: '/', joinedAt: 't' }],
        'visitor-b': [
          { visitorId: 'visitor-b', route: '/', joinedAt: 't' },
          { visitorId: 'visitor-b', route: '/play', joinedAt: 't' },
        ],
        'visitor-empty': [],
      }),
    ).toBe(2)
  })
})

describe('visitor id', () => {
  it('persists one anonymous id across route changes', () => {
    const storage = memoryStorage()
    const first = getOrCreateVisitorId(storage, () => 'test-visitor-id-0001')
    expect(isVisitorId(first)).toBe(true)
    // Route changes reuse the stored id — never mint a new visitor.
    expect(getOrCreateVisitorId(storage, () => 'test-visitor-id-0002')).toBe(first)
    expect(readVisitorId(storage)).toBe(first)
  })

  it('never accepts wallet-like or personal values from storage', () => {
    expect(isVisitorId('NQ32 1234 5678 9012 3456 7890 1234 5678 9012')).toBe(false)
    expect(isVisitorId('player@example.com')).toBe(false)
    expect(isVisitorId('192.168.0.1')).toBe(false)
    expect(isVisitorId('')).toBe(false)
    expect(isVisitorId(null)).toBe(false)
  })
})

describe('SharedSitePresence', () => {
  it('shares one channel across mounts and never double-counts one session', async () => {
    const channels: FakeChannel[] = []
    const client = createFakeClient(channels)
    const presence = new SharedSitePresence(async () => client, memoryStorage(), () => '2026-09-22T00:00:00.000Z')

    presence.acquire('/')
    presence.acquire('/play')
    await flush()
    expect(channels).toHaveLength(1)
    const channel = channels[0]!
    expect(presence.refCountForTests()).toBe(2)

    channel.emitSubscribe('SUBSCRIBED')
    await flush()
    expect(channel.tracks).toHaveLength(1)
    const visitorId = channel.tracks[0]?.visitorId
    expect(typeof visitorId).toBe('string')
    expect(channel.tracks[0]).toEqual({ visitorId: visitorId!, route: '/play', joinedAt: '2026-09-22T00:00:00.000Z' })
    // Payload carries only harmless state — never wallet, IP, or email.
    expect(JSON.stringify(channel.tracks[0])).not.toMatch(/NQ|@|wallet|email|address/i)

    // Same SPA session on two presence keys would double-count; the snapshot
    // must count UNIQUE keys only.
    channel.state = {
      [visitorId as string]: [{ visitorId, route: '/play', joinedAt: 't' }],
      'other-visitor': [{ visitorId: 'other-visitor', route: '/', joinedAt: 't' }],
    }
    channel.emitSync()
    expect(presence.getSnapshot()).toEqual({ status: 'live', online: 2 })

    // Route change retracks the SAME visitor key — no new channel, no new key.
    presence.updateRoute('/play?dev=1')
    await flush()
    expect(channels).toHaveLength(1)
    expect(channel.tracks.at(-1)).toMatchObject({ visitorId, route: '/play' })

    presence.release()
    expect(presence.refCountForTests()).toBe(1)
    expect(client.removed).toHaveLength(0)
    presence.release()
    await flush()
    expect(client.removed).toHaveLength(1)
    expect(channel.unsubscribed).toBe(true)
  })

  it('degrades gracefully when Presence is unavailable', async () => {
    const offline = new SharedSitePresence(async () => null, memoryStorage())
    offline.acquire('/')
    await flush()
    expect(offline.getSnapshot()).toEqual({ status: 'unavailable', online: null })
    offline.release()

    const channels: FakeChannel[] = []
    const failing = createFakeClient(channels)
    const errored = new SharedSitePresence(async () => failing, memoryStorage())
    errored.acquire('/')
    await flush()
    channels[0]?.emitSubscribe('CHANNEL_ERROR')
    expect(errored.getSnapshot()).toEqual({ status: 'unavailable', online: null })
    // Unavailable never claims a number — least of all zero-as-proof.
    expect(errored.getSnapshot().online).toBeNull()
    errored.release()
  })

  it('dedupes multiple tabs of the same browser to one presence key', async () => {
    // Two tabs = two JS contexts sharing localStorage: same visitor id,
    // separate channels, but ONE presence key server-side.
    const shared = memoryStorage()
    const tabAChannels: FakeChannel[] = []
    const tabBChannels: FakeChannel[] = []
    const tabA = new SharedSitePresence(async () => createFakeClient(tabAChannels), shared)
    const tabB = new SharedSitePresence(async () => createFakeClient(tabBChannels), shared)
    tabA.acquire('/')
    tabB.acquire('/play')
    await flush()
    tabAChannels[0]?.emitSubscribe('SUBSCRIBED')
    tabBChannels[0]?.emitSubscribe('SUBSCRIBED')
    await flush()
    const idA = tabAChannels[0]?.tracks[0]?.visitorId
    const idB = tabBChannels[0]?.tracks[0]?.visitorId
    expect(typeof idA).toBe('string')
    expect(idB).toBe(idA)
    // Server-side presence state holds ONE key for both tabs.
    tabAChannels[0]!.state = { [idA as string]: [{ visitorId: idA, route: '/play', joinedAt: 't' }] }
    tabAChannels[0]?.emitSync()
    expect(tabA.getSnapshot()).toEqual({ status: 'live', online: 1 })
    tabA.release()
    tabB.release()
  })

  it('recovers on reconnect by retracking the same visitor key', async () => {
    const channels: FakeChannel[] = []
    const client = createFakeClient(channels)
    const presence = new SharedSitePresence(async () => client, memoryStorage())
    presence.acquire('/')
    await flush()
    channels[0]?.emitSubscribe('SUBSCRIBED')
    await flush()
    const visitorId = channels[0]?.tracks[0]?.visitorId
    expect(channels[0]?.tracks).toHaveLength(1)
    // Drop + resubscribe: status flips unavailable, then retracks same key.
    channels[0]?.emitSubscribe('CLOSED')
    expect(presence.getSnapshot()).toEqual({ status: 'unavailable', online: null })
    channels[0]?.emitSubscribe('SUBSCRIBED')
    await flush()
    expect(channels[0]?.tracks).toHaveLength(2)
    expect(channels[0]?.tracks[1]).toMatchObject({ visitorId })
    expect(channels).toHaveLength(1)
    presence.release()
  })
})
