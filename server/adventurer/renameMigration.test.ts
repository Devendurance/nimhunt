import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const migration = readFileSync(join(root, 'server/ledger/sql/017_adventurer_rename.sql'), 'utf8')

describe('P5 migration 017 contract', () => {
  it('adds only the rename challenge/consume RPCs and private blocked read RPC', () => {
    expect(migration).toContain('create or replace function public.create_adventurer_rename_challenge')
    expect(migration).toContain('create or replace function public.consume_adventurer_rename_challenge')
    expect(migration).toContain('create or replace function public.get_adventurer_blocked_profiles')
    expect(migration).toContain("v_challenge.purpose <> 'RENAME'")
    expect(migration).toContain('v_challenge.player_id is distinct from p_player_id')
    expect(migration).toContain('v_profile.display_name is distinct from p_current_name')
    expect(migration).toContain("pg_catalog.interval '30 days'")
    expect(migration).toContain('authorization_fingerprint = p_authorization_fingerprint')
  })

  it('keeps all new functions service-role-only and returns no wallet fields in blocked rows', () => {
    expect(migration).toMatch(/revoke all on function public\.create_adventurer_rename_challenge\([^;]+from public, anon, authenticated;/i)
    expect(migration).toMatch(/grant execute on function public\.consume_adventurer_rename_challenge\([^;]+to service_role;/i)
    expect(migration).toMatch(/grant execute on function public\.get_adventurer_blocked_profiles\([^;]+to service_role;/i)
    expect(migration).toContain("'player_id', p.player_id")
    expect(migration).toContain("'display_name', p.display_name")
    expect(migration).toContain("'avatar_id', p.avatar_id")
    expect(migration).not.toContain("'wallet', p.wallet")
  })
})
