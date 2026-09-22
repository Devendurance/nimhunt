// Migration 013 static contract tests: the gamer-count RPC must stay
// narrowly scoped (count only, service_role only, fixed search_path) and the
// partial index must cover exactly the gameplay-started distinct-wallet scan.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const sql = readFileSync(join(root, 'server/ledger/sql/013_public_gamer_count.sql'), 'utf8')

describe('013_public_gamer_count migration', () => {
  it('creates the partial gameplay-wallet index', () => {
    expect(sql).toContain('expedition_runs_gameplay_wallet_idx')
    expect(sql).toContain('on public.expedition_runs (wallet)')
    expect(sql).toContain('where gameplay_started_at is not null')
    expect(sql).toContain('create index if not exists')
  })

  it('defines get_public_gamer_count with DISTINCT wallet semantics', () => {
    expect(sql).toContain('public.get_public_gamer_count()')
    expect(sql).toContain('count(distinct wallet)')
    expect(sql).toContain('from public.expedition_runs')
    expect(sql).toContain('where gameplay_started_at is not null')
  })

  it('locks the function down: definer, fixed path, service_role only', () => {
    expect(sql).toMatch(/security definer/i)
    expect(sql).toContain('set search_path = pg_catalog, public')
    expect(sql).toContain(
      'revoke all on function public.get_public_gamer_count() from public, anon, authenticated',
    )
    expect(sql).toContain('grant execute on function public.get_public_gamer_count() to service_role')
  })

  it('exposes no wallet rows and mutates nothing', () => {
    expect(sql).not.toMatch(/select\s+wallet\b/i)
    expect(sql).not.toMatch(/\binsert\b|\bupdate\b|\bdelete\b/i)
    expect(sql).not.toMatch(/grant execute on function public\.get_public_gamer_count\(\) to (public|anon|authenticated)/)
  })
})
