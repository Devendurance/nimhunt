import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(join(process.cwd(), 'server/ledger/sql/015_adventurer_avatar_catalogue.sql'), 'utf8')

describe('015 final Adventurer avatar catalogue migration', () => {
  it('is additive, registers 20 final IDs, and leaves old IDs readable', () => {
    expect(sql).toContain('add column if not exists rarity')
    for (const id of [
      'common-01', 'common-02', 'common-03', 'common-04', 'common-05',
      'uncommon-01', 'uncommon-02', 'uncommon-03', 'uncommon-04', 'uncommon-05',
      'rare-01', 'rare-02', 'rare-03',
      'legendary-01', 'legendary-02', 'legendary-03',
      'mythic-01', 'mythic-02', 'mythic-03', 'mythic-04',
    ]) expect(sql).toContain(`'${id}'`)
    expect(sql).toContain("rarity = 'LEGACY'")
    expect(sql).toContain("starter = false")
    expect(sql).toContain("pg_catalog.substring(avatar_id, '[0-9]+')")
    expect(sql).not.toContain("pg_catalog.substring(avatar_id from '[0-9]+')")
    expect(sql).toContain('new.avatar_id is distinct from old.avatar_id')
    expect(sql).not.toMatch(/alter table public\.(expedition_runs|reward_claims|reward_payouts)[\s\S]*player_id/i)
  })

  it('is safe to rerun after any statement boundary has already committed', () => {
    expect(sql).toContain('add column if not exists rarity')
    expect(sql).toContain("conname = 'adventurer_avatars_rarity_check'")
    expect(sql).toContain('on conflict (avatar_id) do update')
    expect(sql).toContain('create or replace function public.reject_adventurer_profile_mutation()')
    expect(sql).toContain('revoke all on function public.reject_adventurer_profile_mutation()')
  })

  it('marks only Common final avatars as starter and keeps higher tiers active but locked', () => {
    expect(sql).toMatch(/\('common-01', 'COMMON', true, true, 1\)/)
    expect(sql).toMatch(/\('common-05', 'COMMON', true, true, 5\)/)
    expect(sql).toMatch(/\('uncommon-01', 'UNCOMMON', false, true, 6\)/)
    expect(sql).toMatch(/\('rare-01', 'RARE', false, true, 11\)/)
    expect(sql).toMatch(/\('legendary-01', 'LEGENDARY', false, true, 14\)/)
    expect(sql).toMatch(/\('mythic-01', 'MYTHIC', false, true, 17\)/)
  })
})
