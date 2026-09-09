-- NimHunt daily expedition ledger + atomic 69-slot reservation.
-- COMPLETED is accounting state only. No NIM movement in this migration.

create extension if not exists pgcrypto;

do $$ begin
  create type expedition_run_status as enum ('STARTED', 'COMPLETED', 'FAILED', 'ABANDONED');
exception
  when duplicate_object then null;
end $$;

do $$ begin
  create type expedition_reward_status as enum ('NONE', 'ELIGIBLE', 'RESERVED', 'SOLD_OUT', 'ALREADY_REWARDED');
exception
  when duplicate_object then null;
end $$;

create table if not exists daily_reward_pools (
  day_key date primary key,
  total_slots integer not null default 69 check (total_slots = 69),
  reserved_slots integer not null default 0 check (reserved_slots >= 0 and reserved_slots <= 69),
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists daily_wallet_state (
  day_key date not null references daily_reward_pools (day_key),
  wallet text not null check (char_length(wallet) > 0 and char_length(wallet) <= 80),
  expeditions_started integer not null default 0 check (expeditions_started >= 0 and expeditions_started <= 3),
  rewards_reserved integer not null default 0 check (rewards_reserved >= 0 and rewards_reserved <= 1),
  primary key (day_key, wallet)
);

create table if not exists expedition_runs (
  id uuid primary key default gen_random_uuid(),
  day_key date not null,
  wallet text not null check (char_length(wallet) > 0 and char_length(wallet) <= 80),
  mission_type text not null check (mission_type in ('gem-runner', 'chest-hunter', 'vault-breaker')),
  status expedition_run_status not null,
  started_at timestamptz not null default timezone('utc', now()),
  ended_at timestamptz,
  reward_status expedition_reward_status not null default 'NONE',
  reservation_number integer check (
    reservation_number is null
    or (reservation_number >= 1 and reservation_number <= 69)
  )
);

create index if not exists expedition_runs_day_wallet_idx on expedition_runs (day_key, wallet);

alter table daily_reward_pools enable row level security;
alter table daily_wallet_state enable row level security;
alter table expedition_runs enable row level security;

-- No anon/authenticated policies. Clients never write these tables.
-- service_role bypasses RLS for the server adapter.

create or replace function next_utc_reset_at(p_day date)
returns timestamptz
language sql
immutable
as $$
  select ((p_day + 1)::timestamp without time zone at time zone 'utc');
$$;

create or replace function get_daily_hunt_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_day date := (timezone('utc', now()))::date;
  v_reserved integer := 0;
begin
  select reserved_slots into v_reserved
  from public.daily_reward_pools
  where day_key = v_day;

  if v_reserved is null then
    v_reserved := 0;
  end if;

  return jsonb_build_object(
    'ok', true,
    'total_slots', 69,
    'reserved_slots', v_reserved,
    'remaining_slots', 69 - v_reserved,
    'day_key', v_day,
    'next_reset_at', public.next_utc_reset_at(v_day)
  );
end;
$$;

create or replace function get_wallet_daily_status(p_wallet text)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_day date := (timezone('utc', now()))::date;
  v_started integer := 0;
  v_reserved integer := 0;
begin
  if p_wallet is null or char_length(p_wallet) = 0 or char_length(p_wallet) > 80 then
    return jsonb_build_object('ok', false, 'error', 'INVALID_WALLET');
  end if;

  select expeditions_started, rewards_reserved
  into v_started, v_reserved
   from public.daily_wallet_state
  where day_key = v_day and wallet = p_wallet;

  v_started := coalesce(v_started, 0);
  v_reserved := coalesce(v_reserved, 0);

  return jsonb_build_object(
    'ok', true,
    'day_key', v_day,
    'expeditions_started', v_started,
    'expeditions_remaining', 3 - v_started,
    'reward_already_reserved', v_reserved >= 1,
     'next_reset_at', public.next_utc_reset_at(v_day)
  );
end;
$$;

create or replace function start_expedition(p_wallet text, p_mission_type text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_now timestamptz := timezone('utc', now());
  v_day date := v_now::date;
  v_started integer;
  v_run_id uuid;
begin
  if p_mission_type is null or p_mission_type not in ('gem-runner', 'chest-hunter', 'vault-breaker') then
    return jsonb_build_object('ok', false, 'error', 'UNKNOWN_MISSION_TYPE');
  end if;
  if p_wallet is null or char_length(p_wallet) = 0 or char_length(p_wallet) > 80 then
    return jsonb_build_object('ok', false, 'error', 'INVALID_WALLET');
  end if;

  insert into public.daily_reward_pools (day_key) values (v_day)
  on conflict (day_key) do nothing;

  insert into public.daily_wallet_state (day_key, wallet)
  values (v_day, p_wallet)
  on conflict (day_key, wallet) do nothing;

  select expeditions_started into v_started
  from public.daily_wallet_state
  where day_key = v_day and wallet = p_wallet
  for update;

  update public.daily_wallet_state
  set expeditions_started = expeditions_started + 1
  where day_key = v_day
    and wallet = p_wallet
    and expeditions_started < 3
  returning expeditions_started into v_started;

  if v_started is null then
    return jsonb_build_object('ok', false, 'error', 'DAILY_EXPEDITION_LIMIT_REACHED');
  end if;

  insert into public.expedition_runs (day_key, wallet, mission_type, status, reward_status, started_at)
  values (v_day, p_wallet, p_mission_type, 'STARTED', 'NONE', v_now)
  returning id into v_run_id;

  return jsonb_build_object(
    'ok', true,
    'run_id', v_run_id,
    'expeditions_started', v_started,
    'day_key', v_day,
    'next_reset_at', public.next_utc_reset_at(v_day)
  );
end;
$$;

create or replace function transition_expedition_run(p_run_id uuid, p_wallet text, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_run expedition_runs%rowtype;
  v_now timestamptz := timezone('utc', now());
begin
  if p_status not in ('COMPLETED', 'FAILED', 'ABANDONED') then
    return jsonb_build_object('ok', false, 'error', 'INVALID_RUN_TRANSITION');
  end if;
  if p_wallet is null or char_length(p_wallet) = 0 or char_length(p_wallet) > 80 then
    return jsonb_build_object('ok', false, 'error', 'INVALID_WALLET');
  end if;

  select * into v_run
   from public.expedition_runs
  where id = p_run_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'RUN_NOT_FOUND');
  end if;
  if v_run.wallet <> p_wallet then
    return jsonb_build_object('ok', false, 'error', 'WALLET_MISMATCH');
  end if;
  if v_run.status = p_status then
    return jsonb_build_object(
      'ok', true,
      'id', v_run.id,
      'day_key', v_run.day_key,
      'wallet', v_run.wallet,
      'mission_type', v_run.mission_type,
      'status', v_run.status,
      'started_at', v_run.started_at,
      'ended_at', v_run.ended_at,
      'reward_status', v_run.reward_status,
      'reservation_number', v_run.reservation_number
    );
  end if;
  if v_run.status <> 'STARTED' then
    return jsonb_build_object('ok', false, 'error', 'INVALID_RUN_TRANSITION');
  end if;

  update public.expedition_runs
  set
    status = p_status::public.expedition_run_status,
    ended_at = v_now,
    reward_status = case
      when p_status = 'COMPLETED' and reward_status = 'NONE' then 'ELIGIBLE'::expedition_reward_status
      else reward_status
    end
  where id = p_run_id
  returning * into v_run;

  return jsonb_build_object(
    'ok', true,
    'id', v_run.id,
    'day_key', v_run.day_key,
    'wallet', v_run.wallet,
    'mission_type', v_run.mission_type,
    'status', v_run.status,
    'started_at', v_run.started_at,
    'ended_at', v_run.ended_at,
    'reward_status', v_run.reward_status,
    'reservation_number', v_run.reservation_number
  );
end;
$$;

create or replace function reserve_daily_reward(p_run_id uuid, p_wallet text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_run expedition_runs%rowtype;
  v_rewards_reserved integer;
  v_number integer;
begin
  if p_wallet is null or char_length(p_wallet) = 0 or char_length(p_wallet) > 80 then
    return jsonb_build_object('ok', false, 'error', 'INVALID_WALLET');
  end if;

  select * into v_run from public.expedition_runs where id = p_run_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'RUN_NOT_FOUND');
  end if;
  if v_run.wallet <> p_wallet then
    return jsonb_build_object('ok', false, 'error', 'WALLET_MISMATCH');
  end if;

  perform 1 from public.daily_reward_pools where day_key = v_run.day_key for update;

  select rewards_reserved into v_rewards_reserved
   from public.daily_wallet_state
  where day_key = v_run.day_key and wallet = p_wallet
  for update;

  select * into v_run
   from public.expedition_runs
  where id = p_run_id
  for update;

  if v_run.status <> 'COMPLETED' then
    return jsonb_build_object('ok', false, 'error', 'RUN_NOT_COMPLETED');
  end if;

  if v_run.reward_status = 'RESERVED' or coalesce(v_rewards_reserved, 0) >= 1 then
    return jsonb_build_object('ok', false, 'error', 'ALREADY_REWARDED');
  end if;

   update public.daily_reward_pools
  set reserved_slots = reserved_slots + 1
  where day_key = v_run.day_key
    and reserved_slots < 69
  returning reserved_slots into v_number;

  if v_number is null then
     update public.expedition_runs
    set reward_status = 'SOLD_OUT'
    where id = p_run_id;
    return jsonb_build_object(
      'ok', false,
      'error', 'SOLD_OUT',
      'remaining_slots', 0,
      'total_slots', 69
    );
  end if;

   update public.daily_wallet_state
  set rewards_reserved = 1
  where day_key = v_run.day_key
    and wallet = p_wallet
    and rewards_reserved = 0;

   update public.expedition_runs
  set reward_status = 'RESERVED', reservation_number = v_number
  where id = p_run_id;

  return jsonb_build_object(
    'ok', true,
    'reserved', true,
    'reservation_number', v_number,
    'remaining_slots', 69 - v_number,
    'total_slots', 69
  );
end;
$$;

revoke all on function public.get_daily_hunt_status() from public, anon, authenticated;
revoke all on function public.get_wallet_daily_status(text) from public, anon, authenticated;
revoke all on function public.start_expedition(text, text) from public, anon, authenticated;
revoke all on function public.transition_expedition_run(uuid, text, text) from public, anon, authenticated;
revoke all on function public.reserve_daily_reward(uuid, text) from public, anon, authenticated;

do $$
begin
  grant execute on function public.get_daily_hunt_status() to service_role;
  grant execute on function public.get_wallet_daily_status(text) to service_role;
  grant execute on function public.start_expedition(text, text) to service_role;
  grant execute on function public.transition_expedition_run(uuid, text, text) to service_role;
  grant execute on function public.reserve_daily_reward(uuid, text) to service_role;
exception
  when undefined_object then null;
end $$;
