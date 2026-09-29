import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import { AdventurerUnavailableError } from './errors.js'
import { createSupabaseAdventurerSocialStore } from './socialPostgresStore.js'
import { parseAdventurerSocialOverview } from '../../src/domain/adventurerSocial.js'

const playerId = '00000000-0000-4000-8000-000000000001'
const requestId = '00000000-0000-4000-8000-000000000002'
const senderId = '00000000-0000-4000-8000-000000000003'

function fakeClient(data: unknown): SupabaseClient {
  return {
    rpc: async () => ({ data, error: null }),
  } as unknown as SupabaseClient
}

function incomingOverview(createdAt: string): Record<string, unknown> {
  return {
    ok: true,
    ally_count: 0,
    incoming_pending_count: 1,
    outgoing_pending_count: 0,
    incoming_requests: [{
      request_id: requestId,
      player_id: senderId,
      display_name: 'Ruin Fox',
      avatar_id: 'common-02',
      created_at: createdAt,
    }],
    allies: [],
  }
}

describe('Postgres social timestamp boundary', () => {
  it('normalizes a Supabase timestamptz offset before the strict client parser receives it', async () => {
    const store = createSupabaseAdventurerSocialStore(fakeClient(incomingOverview('2026-09-28T23:20:41.123+00:00')))
    const overview = await store.getOverview(playerId)

    expect(overview.incomingRequests[0]?.createdAt).toBe('2026-09-28T23:20:41.123Z')
    expect(parseAdventurerSocialOverview(overview)).toEqual(overview)
    expect(overview.incomingRequests).toHaveLength(1)
    expect(overview.incomingRequests[0]).toMatchObject({ requestId, playerId: senderId, displayName: 'Ruin Fox' })
  })

  it('fails safely for malformed database timestamps instead of returning an unavailable overview', async () => {
    const store = createSupabaseAdventurerSocialStore(fakeClient(incomingOverview('not-a-timestamp')))

    await expect(store.getOverview(playerId)).rejects.toBeInstanceOf(AdventurerUnavailableError)
  })
})
