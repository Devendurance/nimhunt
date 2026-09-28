import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createSupabasePublicAdventurerProfileResolver } from './publicProfiles.ts'

function query(data: unknown) {
  const builder = {
    select: () => builder,
    in: () => builder,
    order: () => builder,
    range: () => builder,
    then: (resolve: (value: { data: unknown; error: null }) => unknown) => Promise.resolve(resolve({ data, error: null })),
  }
  return builder
}

describe('batched public Adventurer profile resolution', () => {
  it('resolves claimed profiles and lifetime stats with one profile query and one run query', async () => {
    const queriedTables: string[] = []
    const client = {
      from(table: string) {
        queriedTables.push(table)
        if (table === 'adventurer_profiles') {
          return query([{
            player_id: '00000000-0000-4000-8000-000000000001',
            wallet: 'NQ32 PROFILE WALLET',
            display_name: 'Endy',
            avatar_id: 'common-01',
          }])
        }
        return query([{
          id: 'run-1',
          day_key: '2026-09-10',
          wallet: 'NQ32 PROFILE WALLET',
          mission_type: 'gem-runner',
          started_at: '2026-09-10T10:00:00.000Z',
          ended_at: '2026-09-10T10:05:00.000Z',
          gameplay_started_at: '2026-09-10T10:00:00.000Z',
          terminal: {
            type: 'VERIFIED',
            result: {
              outcome: 'VERIFIED_ELIGIBLE',
              gemsCollected: 6,
              chestsOpened: 0,
              objectiveReached: false,
              missionSatisfied: true,
              finalHp: 3,
            },
          },
        }])
      },
    } as unknown as SupabaseClient

    const resolve = createSupabasePublicAdventurerProfileResolver(client)
    const profiles = await resolve(['NQ32 PROFILE WALLET', 'NQ32 UNCLAIMED WALLET'])
    const profile = profiles.get('NQ32 PROFILE WALLET')

    expect(queriedTables).toEqual(['adventurer_profiles', 'expedition_runs'])
    expect(profile).toEqual({
      playerId: '00000000-0000-4000-8000-000000000001',
      displayName: 'Endy',
      avatarId: 'common-01',
      lifetimeGems: 6,
      expeditionsCompleted: 1,
      bestStreak: 1,
    })
    expect(profiles.has('NQ32 UNCLAIMED WALLET')).toBe(false)
    expect(JSON.stringify(profile)).not.toContain('wallet')
  })
})
