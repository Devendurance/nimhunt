import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(join(process.cwd(), 'server/ledger/sql/016_adventurer_social.sql'), 'utf8')

describe('016 Adventurer social migration contract', () => {
  it('creates only the private player_id social tables with deterministic pair safety', () => {
    expect(sql).toContain('create table if not exists public.adventurer_ally_requests')
    expect(sql).toContain('create table if not exists public.adventurer_allies')
    expect(sql).toContain('create table if not exists public.adventurer_blocks')
    expect(sql).toMatch(/sender_id uuid not null references public\.adventurer_profiles \(player_id\)/i)
    expect(sql).toMatch(/receiver_id uuid not null references public\.adventurer_profiles \(player_id\)/i)
    expect(sql).toMatch(/status text not null default 'PENDING'.*PENDING.*ACCEPTED.*DECLINED.*CANCELLED/s)
    expect(sql).toContain('check (sender_id <> receiver_id)')
    expect(sql).toContain('check (adventurer_a_id < adventurer_b_id)')
    expect(sql).toContain('check (blocker_id <> blocked_id)')
    expect(sql).toContain('adventurer_ally_requests_pending_pair_uidx')
    expect(sql).toContain('least(sender_id, receiver_id)')
    expect(sql).toContain('greatest(sender_id, receiver_id)')
    expect(sql).not.toMatch(/\bpg_catalog\.(least|greatest|substring|coalesce|nullif)\s*\(/i)
    expect(sql).not.toMatch(/\bpg_catalog\.(case|when)\b/i)
  })

  it('does not schema-qualify PostgreSQL special SQL expressions', () => {
    expect(sql).not.toMatch(/\bpg_catalog\.least\s*\(/i)
    expect(sql).not.toMatch(/\bpg_catalog\.greatest\s*\(/i)
    expect(sql).not.toMatch(/\bpg_catalog\.substring\s*\(/i)
    expect(sql).not.toMatch(/\bpg_catalog\.(coalesce|nullif)\s*\(/i)
    expect(sql).toContain('pg_catalog.timezone')
    expect(sql).toContain('pg_catalog.jsonb_build_object')
    expect(sql).toContain('pg_catalog.jsonb_agg')
  })

  it('has pending/cap lookup indexes and forces service-only RLS', () => {
    for (const expected of [
      'adventurer_ally_requests_receiver_pending_idx',
      'adventurer_ally_requests_sender_pending_idx',
      'adventurer_allies_a_lookup_idx',
      'adventurer_allies_b_lookup_idx',
      'adventurer_blocks_blocked_lookup_idx',
    ]) expect(sql).toContain(expected)
    for (const table of ['adventurer_ally_requests', 'adventurer_allies', 'adventurer_blocks']) {
      expect(sql).toMatch(new RegExp(`alter table public\\.${table} enable row level security`, 'i'))
      expect(sql).toMatch(new RegExp(`alter table public\\.${table} force row level security`, 'i'))
      expect(sql).toMatch(new RegExp(`revoke all on table public\\.${table} from public, anon, authenticated`, 'i'))
    }
    expect(sql).toMatch(/grant execute on function public\.adventurer_social_accept\(uuid, uuid\) to service_role/i)
    expect(sql).toMatch(/grant execute on function public\.adventurer_social_block\(uuid, uuid\) to service_role/i)
  })

  it('keeps DDL rerunnable and has no one-shot enum or trigger creation', () => {
    for (const table of ['adventurer_ally_requests', 'adventurer_allies', 'adventurer_blocks']) {
      expect(sql).toContain(`create table if not exists public.${table}`)
    }
    for (const index of [
      'adventurer_ally_requests_receiver_pending_idx',
      'adventurer_ally_requests_sender_pending_idx',
      'adventurer_ally_requests_pending_pair_uidx',
      'adventurer_allies_a_lookup_idx',
      'adventurer_allies_b_lookup_idx',
      'adventurer_blocks_blocked_lookup_idx',
    ]) expect(sql).toMatch(new RegExp(`create (?:unique )?index if not exists ${index}`, 'i'))
    expect(sql).not.toMatch(/create\s+type\b/i)
    expect(sql).not.toMatch(/create\s+trigger\b/i)
    expect(sql.match(/create or replace function public\./gi)).toHaveLength(11)
  })

  it('freezes atomic operations and never exposes wallet/profile-private fields in social JSON', () => {
    for (const fn of [
      'adventurer_social_request',
      'adventurer_social_accept',
      'adventurer_social_decline',
      'adventurer_social_cancel',
      'adventurer_social_remove',
      'adventurer_social_block',
      'adventurer_social_unblock',
    ]) expect(sql).toContain(`create or replace function public.${fn}`)
    expect(sql).toContain('order by player_id\n  for update')
    expect(sql).toContain("return pg_catalog.jsonb_build_object('ok', false, 'error', 'SOCIAL_TARGET_UNAVAILABLE')")
    expect(sql).not.toMatch(/'wallet'\s*,/i)
    expect(sql).not.toMatch(/'session_hash'\s*,/i)
    expect(sql).not.toMatch(/'reward|payout|claim|treasury/i)
  })
})
