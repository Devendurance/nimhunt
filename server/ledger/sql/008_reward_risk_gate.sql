-- NimHunt privacy-light pre-reservation abuse gate.
-- Stores hashed install IDs and server-authored risk assessments only.
-- Does not collect hardware fingerprints, raw IP, or client-controlled results.

do $$ begin
  create type public.reward_risk_result as enum ('PASS', 'REVIEW', 'BLOCK');
exception
  when duplicate_object then null;
end $$;

create table if not exists public.reward_risk_signals (
  signal_id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('START_CHALLENGE', 'START', 'RECOVERY_CHALLENGE', 'CLAIM')),
  wallet text not null check (pg_catalog.char_length(wallet) between 1 and 80),
  day_key date not null,
  install_id_hash text check (install_id_hash is null or install_id_hash ~ '^[0-9a-f]{64}$'),
  run_id uuid references public.expedition_runs (id),
  pattern_hash text check (pattern_hash is null or pattern_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default pg_catalog.timezone('utc', pg_catalog.now())
);

create index if not exists reward_risk_signals_install_day_idx
  on public.reward_risk_signals (day_key, install_id_hash);

create index if not exists reward_risk_signals_wallet_day_idx
  on public.reward_risk_signals (day_key, wallet);

create table if not exists public.reward_risk_assessments (
  assessment_id uuid primary key default gen_random_uuid(),
  run_id uuid not null unique references public.expedition_runs (id),
  wallet text not null check (pg_catalog.char_length(wallet) between 1 and 80),
  day_key date not null,
  install_id_hash text check (install_id_hash is null or install_id_hash ~ '^[0-9a-f]{64}$'),
  result public.reward_risk_result not null,
  reason_codes text[] not null default '{}',
  created_at timestamptz not null default pg_catalog.timezone('utc', pg_catalog.now()),
  updated_at timestamptz not null default pg_catalog.timezone('utc', pg_catalog.now()),
  check (
    pg_catalog.array_length(reason_codes, 1) is null
    or pg_catalog.array_length(reason_codes, 1) <= 16
  )
);

create index if not exists reward_risk_assessments_wallet_day_idx
  on public.reward_risk_assessments (day_key, wallet);

create or replace function public.reject_reward_risk_mutation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'PROOF_LOST';
  end if;
  if tg_table_name = 'reward_risk_signals' then
    raise exception 'PROOF_LOST';
  end if;
  if new.assessment_id is distinct from old.assessment_id
    or new.run_id is distinct from old.run_id
    or new.wallet is distinct from old.wallet
    or new.day_key is distinct from old.day_key
    or new.created_at is distinct from old.created_at then
    raise exception 'PROOF_LOST';
  end if;
  return new;
end;
$$;

drop trigger if exists reward_risk_signals_immutable_delete on public.reward_risk_signals;
create trigger reward_risk_signals_immutable_delete
before delete on public.reward_risk_signals
for each row execute function public.reject_reward_risk_mutation();

drop trigger if exists reward_risk_signals_immutable_update on public.reward_risk_signals;
create trigger reward_risk_signals_immutable_update
before update on public.reward_risk_signals
for each row execute function public.reject_reward_risk_mutation();

drop trigger if exists reward_risk_assessments_immutable_delete on public.reward_risk_assessments;
create trigger reward_risk_assessments_immutable_delete
before delete on public.reward_risk_assessments
for each row execute function public.reject_reward_risk_mutation();

drop trigger if exists reward_risk_assessments_bind_immutable_update on public.reward_risk_assessments;
create trigger reward_risk_assessments_bind_immutable_update
before update on public.reward_risk_assessments
for each row execute function public.reject_reward_risk_mutation();

alter table public.reward_risk_signals enable row level security;
alter table public.reward_risk_signals force row level security;
alter table public.reward_risk_assessments enable row level security;
alter table public.reward_risk_assessments force row level security;

do $$
begin
  grant select, insert, update, delete on public.reward_risk_signals to anon, authenticated;
  grant select, insert, update, delete on public.reward_risk_assessments to anon, authenticated;
exception
  when undefined_object then null;
  when insufficient_privilege then null;
end $$;

create or replace function public.record_reward_risk_signal(
  p_kind text,
  p_wallet text,
  p_day_key date,
  p_install_id_hash text,
  p_run_id uuid,
  p_pattern_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if p_kind is null or p_kind not in ('START_CHALLENGE', 'START', 'RECOVERY_CHALLENGE', 'CLAIM') then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'MALFORMED_REQUEST');
  end if;
  if p_wallet is null or pg_catalog.char_length(p_wallet) = 0 or pg_catalog.char_length(p_wallet) > 80 then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'INVALID_WALLET');
  end if;
  if p_day_key is null then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'MALFORMED_REQUEST');
  end if;
  if p_install_id_hash is not null and p_install_id_hash !~ '^[0-9a-f]{64}$' then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'MALFORMED_REQUEST');
  end if;
  if p_pattern_hash is not null and p_pattern_hash !~ '^[0-9a-f]{64}$' then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'MALFORMED_REQUEST');
  end if;

  insert into public.reward_risk_signals (
    kind, wallet, day_key, install_id_hash, run_id, pattern_hash
  ) values (
    p_kind, p_wallet, p_day_key, p_install_id_hash, p_run_id, p_pattern_hash
  );

  return pg_catalog.jsonb_build_object('ok', true);
end;
$$;

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
    and id <> v_run.id;

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

create or replace function public.upsert_reward_risk_assessment(
  p_run_id uuid,
  p_run_session_hash text,
  p_install_id_hash text,
  p_result text,
  p_reason_codes jsonb
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
  v_row public.reward_risk_assessments%rowtype;
  v_result public.reward_risk_result;
begin
  if p_run_id is null then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'MALFORMED_REQUEST');
  end if;
  if p_result is null or p_result not in ('PASS', 'REVIEW', 'BLOCK') then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'MALFORMED_REQUEST');
  end if;
  if p_install_id_hash is not null and p_install_id_hash !~ '^[0-9a-f]{64}$' then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'MALFORMED_REQUEST');
  end if;
  if p_reason_codes is not null and pg_catalog.jsonb_typeof(p_reason_codes) <> 'array' then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'MALFORMED_REQUEST');
  end if;
  if p_reason_codes is not null and pg_catalog.jsonb_array_length(p_reason_codes) > 16 then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'MALFORMED_REQUEST');
  end if;

  select * into v_session
  from public.run_sessions
  where run_session_hash = p_run_session_hash
  for update;

  if not found
    or v_session.run_id <> p_run_id
    or v_session.revoked_at is not null
    or v_now >= v_session.expires_at then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'RUN_SESSION_INVALID');
  end if;

  select * into v_run
  from public.expedition_runs
  where id = p_run_id
  for update;

  if not found or v_run.wallet <> v_session.wallet then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'WALLET_MISMATCH');
  end if;

  v_result := p_result::public.reward_risk_result;

  insert into public.reward_risk_assessments (
    run_id, wallet, day_key, install_id_hash, result, reason_codes, created_at, updated_at
  ) values (
    v_run.id,
    v_run.wallet,
    v_run.day_key,
    p_install_id_hash,
    v_result,
    coalesce((
      select pg_catalog.array_agg(value)
      from pg_catalog.jsonb_array_elements_text(coalesce(p_reason_codes, '[]'::jsonb)) as value
    ), '{}'),
    v_now,
    v_now
  )
  on conflict (run_id) do update
    set install_id_hash = excluded.install_id_hash,
        result = excluded.result,
        reason_codes = excluded.reason_codes,
        updated_at = v_now
  returning * into v_row;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'assessment_id', v_row.assessment_id,
    'run_id', v_row.run_id,
    'wallet', v_row.wallet,
    'day_key', v_row.day_key,
    'install_id_hash', v_row.install_id_hash,
    'result', v_row.result,
    'reason_codes', to_jsonb(v_row.reason_codes),
    'created_at', v_row.created_at,
    'updated_at', v_row.updated_at
  );
end;
$$;

create or replace function public.get_reward_risk_assessment(
  p_run_id uuid,
  p_run_session_hash text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_now timestamptz := pg_catalog.timezone('utc', pg_catalog.now());
  v_session public.run_sessions%rowtype;
  v_row public.reward_risk_assessments%rowtype;
begin
  if p_run_id is null then
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

  select * into v_row
  from public.reward_risk_assessments
  where run_id = p_run_id
    and wallet = v_session.wallet;

  if not found then
    return pg_catalog.jsonb_build_object('ok', true, 'assessment', null);
  end if;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'assessment', pg_catalog.jsonb_build_object(
      'assessment_id', v_row.assessment_id,
      'run_id', v_row.run_id,
      'wallet', v_row.wallet,
      'day_key', v_row.day_key,
      'install_id_hash', v_row.install_id_hash,
      'result', v_row.result,
      'reason_codes', to_jsonb(v_row.reason_codes),
      'created_at', v_row.created_at,
      'updated_at', v_row.updated_at
    )
  );
end;
$$;

revoke all on function public.reject_reward_risk_mutation() from public, anon, authenticated;
revoke all on function public.record_reward_risk_signal(text, text, date, text, uuid, text) from public, anon, authenticated;
revoke all on function public.load_reward_risk_context(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.upsert_reward_risk_assessment(uuid, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.get_reward_risk_assessment(uuid, text) from public, anon, authenticated;

do $$
begin
  grant execute on function public.record_reward_risk_signal(text, text, date, text, uuid, text) to service_role;
  grant execute on function public.load_reward_risk_context(uuid, text, text, text) to service_role;
  grant execute on function public.upsert_reward_risk_assessment(uuid, text, text, text, jsonb) to service_role;
  grant execute on function public.get_reward_risk_assessment(uuid, text) to service_role;
exception
  when undefined_object then null;
end $$;
