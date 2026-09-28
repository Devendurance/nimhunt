import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(join(process.cwd(), 'server/ledger/sql/014_adventurer_identity.sql'), 'utf8')

describe('014 Adventurer identity migration contract', () => {
  it('is the next additive migration and never links runs/rewards to player_id', () => {
    expect(sql).toContain('adventurer_profiles')
    expect(sql).toContain('adventurer_avatars')
    expect(sql).toContain('adventurer_challenges')
    expect(sql).toContain('adventurer_sessions')
    expect(sql).not.toMatch(/alter table public\.expedition_runs[\s\S]*player_id/i)
    expect(sql).not.toMatch(/alter table public\.(reward_claims|reward_payouts)[\s\S]*player_id/i)
  })

  it('hardens identity tables with immutable ownership, unique normalized names, RLS, and service-only functions', () => {
    expect(sql).toMatch(/player_id uuid primary key/i)
    expect(sql).toMatch(/wallet text not null unique/i)
    expect(sql).toMatch(/normalized_display_name text not null unique/i)
    expect(sql).toMatch(/alter table public\.adventurer_profiles force row level security/i)
    expect(sql).toMatch(/alter table public\.adventurer_challenges force row level security/i)
    expect(sql).toMatch(/alter table public\.adventurer_sessions force row level security/i)
    expect(sql).toMatch(/revoke all on table public\.adventurer_profiles from public, anon, authenticated/i)
    expect(sql).toMatch(/grant execute on function public\.consume_create_adventurer_challenge[\s\S]*to service_role/i)
    expect(sql).toMatch(/reject_adventurer_profile_mutation/i)
  })

  it('freezes name policy, curated avatar IDs, challenge replay prevention, and 30-day sessions', () => {
    for (const name of ['NimHunt', 'Nimiq', 'Admin', 'Administrator', 'Moderator', 'Treasury', 'Support', 'Official', 'System']) {
      expect(sql.toLowerCase()).toContain(`'${name.toLowerCase()}'`)
    }
    expect(sql).toContain("p_display_name !~ '^[A-Za-z0-9_]+( [A-Za-z0-9_]+)*$'")
    expect(sql).toContain('consumed_at is null')
    expect(sql).toContain("p_session_expires_at > v_now + pg_catalog.interval '30 days'")
    expect(sql).toContain('display_name_changed_at')
    expect(sql).toContain("old.display_name_changed_at + pg_catalog.interval '30 days'")
    expect(sql).toContain('adventurer-12')
  })

  it('stores only session_hash, never a raw capability', () => {
    expect(sql).toContain('session_hash text not null unique')
    expect(sql).not.toMatch(/session_capability text/i)
    expect(sql).not.toMatch(/raw_session/i)
  })
})
