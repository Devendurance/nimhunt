-- NimHunt public usage-proof gamer count.
-- Production-grade COUNT(DISTINCT wallet) over expedition_runs rows that
-- actually entered gameplay (gameplay_started_at IS NOT NULL). Signed Starts
-- that never entered gameplay never count; repeated runs by one wallet
-- count once. Returns a count only — no wallet rows ever leave the server.
-- Read-only: no gameplay, reward, payout, or scheduler mutation in this file.

-- Partial index so the distinct-wallet scan touches only gameplay rows.
create index if not exists expedition_runs_gameplay_wallet_idx
  on public.expedition_runs (wallet)
  where gameplay_started_at is not null;

create or replace function public.get_public_gamer_count()
returns bigint
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select count(distinct wallet)
  from public.expedition_runs
  where gameplay_started_at is not null;
$$;

revoke all on function public.get_public_gamer_count() from public, anon, authenticated;
grant execute on function public.get_public_gamer_count() to service_role;
