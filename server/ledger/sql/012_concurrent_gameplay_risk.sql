-- NimHunt concurrent-gameplay risk precision fix.
-- Narrows ONLY the concurrent_active_runs predicate inside
-- load_reward_risk_context: a signed Start that never entered gameplay
-- (gameplay_started_at IS NULL), a terminal run, or an expired run is NOT a
-- concurrent gameplay run. A genuinely gameplay-started, non-terminal,
-- unexpired STARTED run still counts and still BLOCKS.
-- No threshold, reason-code, category, or other risk logic changes.
-- Run expiry is derived from next_utc_reset_at(day_key); expedition_runs has
-- no expires_at column.

create or replace function public.load_reward_risk_context(
  p_run_id uuid,
  p_run_session_hash text,
  p_install_id_hash text,
  p_pattern_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_now timestamptz := pg_catalog.timezone('utc', pg_catalog.now());
  v_session public.run_sessions%rowtype;
  v_run public.expedition_runs%rowtype;
  v_concurrent integer := 0;
  v_wallets integer := 0;
  v_starts integer := 0;
  v_recoveries integer := 0;
  v_pattern_wallets integer := 0;
  v_claim_status text;
  v_wallet_reserved integer := 0;
  v_reserved_slots integer := 0;
begin
  if p_run_id is null then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'MALFORMED_REQUEST');
  end if;
  if p_install_id_hash is not null and p_install_id_hash !~ '^[0-9a-f]{64}$' then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'MALFORMED_REQUEST');
  end if;
  if p_pattern_hash is not null and p_pattern_hash !~ '^[0-9a-f]{64}$' then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'MALFORMED_REQUEST');
  end if;

  select * into v_session
  from public.run_sessions
  where run_session_hash = p_run_session_hash;

  if not found
    or v_session.run_id <> p_run_id
    or v_session.revoked_at is not null
    or v_now >= v_session.expires_at then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'RUN_SESSION_INVALID');
  end if;

  select * into v_run
  from public.expedition_runs
  where id = p_run_id;

  if not found or v_run.wallet <> v_session.wallet then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'WALLET_MISMATCH');
  end if;

  select count(*)::integer into v_concurrent
  from public.expedition_runs
  where wallet = v_run.wallet
    and day_key = v_run.day_key
    and status = 'STARTED'
    and id <> v_run.id
    and gameplay_started_at is not null
    and terminal is null
    and public.next_utc_reset_at(day_key) > v_now;

  select status::text into v_claim_status
  from public.reward_claims
  where run_id = v_run.id;

  select rewards_reserved into v_wallet_reserved
  from public.daily_wallet_state
  where day_key = v_run.day_key and wallet = v_run.wallet;
  v_wallet_reserved := coalesce(v_wallet_reserved, 0);

  select reserved_slots into v_reserved_slots
  from public.daily_reward_pools
  where day_key = v_run.day_key;
  v_reserved_slots := coalesce(v_reserved_slots, 0);

  if p_install_id_hash is not null then
    select count(distinct wallet)::integer into v_wallets
    from public.reward_risk_signals
    where day_key = v_run.day_key
      and install_id_hash = p_install_id_hash;

    select count(*)::integer into v_starts
    from public.reward_risk_signals
    where day_key = v_run.day_key
      and install_id_hash = p_install_id_hash
      and kind in ('START_CHALLENGE', 'START');

    select count(*)::integer into v_recoveries
    from public.reward_risk_signals
    where day_key = v_run.day_key
      and install_id_hash = p_install_id_hash
      and kind = 'RECOVERY_CHALLENGE';

    if p_pattern_hash is not null then
      select count(distinct wallet)::integer into v_pattern_wallets
      from public.reward_risk_signals
      where day_key = v_run.day_key
        and install_id_hash = p_install_id_hash
        and pattern_hash = p_pattern_hash;
    end if;
  end if;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'wallet', v_run.wallet,
    'day_key', v_run.day_key,
    'concurrent_active_runs', coalesce(v_concurrent, 0),
    'install_wallet_count', coalesce(v_wallets, 0),
    'install_start_count', coalesce(v_starts, 0),
    'install_recovery_count', coalesce(v_recoveries, 0),
    'install_pattern_wallet_count', coalesce(v_pattern_wallets, 0),
    'existing_claim_status', v_claim_status,
    'wallet_rewards_reserved', v_wallet_reserved,
    'reserved_slots', v_reserved_slots
  );
end;
$$;
