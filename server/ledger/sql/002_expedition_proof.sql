-- NimHunt durable blueprint and authenticated expedition-start infrastructure.
-- This migration does not create claim, settlement, or transfer state.

do $$ begin
  create type public.blueprint_lifecycle as enum ('DRAFT', 'VALIDATED', 'PUBLISHED', 'RETIRED');
exception
  when duplicate_object then null;
end $$;

create table if not exists public.daily_expedition_blueprints (
  id uuid primary key default gen_random_uuid(),
  day_key date not null,
  mission_type text not null check (mission_type in ('gem-runner', 'chest-hunter', 'vault-breaker')),
  lifecycle public.blueprint_lifecycle not null default 'DRAFT',
  rules_version text not null,
  room_version text not null,
  blueprint_version text not null,
  blueprint_id text not null unique check (char_length(blueprint_id) between 1 and 256),
  canonical_blueprint jsonb not null,
  blueprint_hash text not null check (blueprint_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default timezone('utc', now()),
  published_at timestamptz,
  retired_at timestamptz,
  unique (blueprint_id, blueprint_hash)
);

create unique index if not exists daily_expedition_blueprints_active_idx
  on public.daily_expedition_blueprints (day_key, mission_type)
  where lifecycle = 'PUBLISHED';

create or replace function public.enforce_blueprint_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if old.lifecycle in ('PUBLISHED', 'RETIRED') and (
    new.day_key is distinct from old.day_key
    or new.mission_type is distinct from old.mission_type
    or new.rules_version is distinct from old.rules_version
    or new.room_version is distinct from old.room_version
    or new.blueprint_version is distinct from old.blueprint_version
    or new.blueprint_id is distinct from old.blueprint_id
    or new.canonical_blueprint is distinct from old.canonical_blueprint
    or new.blueprint_hash is distinct from old.blueprint_hash
    or new.created_at is distinct from old.created_at
    or new.published_at is distinct from old.published_at
    or new.retired_at is distinct from old.retired_at
  ) then
    raise exception 'PUBLISHED_BLUEPRINT_IMMUTABLE';
  end if;

  if old.lifecycle = 'DRAFT' and new.lifecycle not in ('DRAFT', 'VALIDATED') then
    raise exception 'INVALID_BLUEPRINT_LIFECYCLE';
  end if;
  if old.lifecycle = 'VALIDATED' and new.lifecycle not in ('VALIDATED', 'PUBLISHED') then
    raise exception 'INVALID_BLUEPRINT_LIFECYCLE';
  end if;
  if old.lifecycle = 'PUBLISHED' and new.lifecycle not in ('PUBLISHED', 'RETIRED') then
    raise exception 'INVALID_BLUEPRINT_LIFECYCLE';
  end if;
  if old.lifecycle = 'RETIRED' and new.lifecycle <> 'RETIRED' then
    raise exception 'INVALID_BLUEPRINT_LIFECYCLE';
  end if;

  if new.lifecycle = 'PUBLISHED' and old.lifecycle = 'VALIDATED' then
    new.published_at := coalesce(new.published_at, pg_catalog.timezone('utc', pg_catalog.now()));
    new.retired_at := null;
  elsif new.lifecycle = 'RETIRED' and old.lifecycle = 'PUBLISHED' then
    new.retired_at := coalesce(new.retired_at, pg_catalog.timezone('utc', pg_catalog.now()));
  end if;
  return new;
end;
$$;

drop trigger if exists daily_expedition_blueprints_lifecycle_trigger on public.daily_expedition_blueprints;
create trigger daily_expedition_blueprints_lifecycle_trigger
before update on public.daily_expedition_blueprints
for each row execute function public.enforce_blueprint_lifecycle();

alter table public.expedition_runs
  add column if not exists rules_version text,
  add column if not exists room_version text,
  add column if not exists blueprint_version text,
  add column if not exists blueprint_id text,
  add column if not exists blueprint_hash text,
  add column if not exists canonical_blueprint jsonb,
  add column if not exists run_challenge text,
  add column if not exists initial_state_hash text,
  add column if not exists initial_transcript_hash text,
  add column if not exists initial_checkpoint_hash text,
  add column if not exists checkpoint_hash text,
  add column if not exists checkpoint_seq integer not null default 0,
  add column if not exists replay_snapshot jsonb,
  add column if not exists last_checkpoint_at timestamptz;

alter table public.expedition_runs
  add constraint expedition_runs_blueprint_binding_fk
  foreign key (blueprint_id) references public.daily_expedition_blueprints (blueprint_id);

create unique index if not exists expedition_runs_run_challenge_idx
  on public.expedition_runs (run_challenge)
  where run_challenge is not null;

create table if not exists public.expedition_start_challenges (
  challenge_hash text primary key check (challenge_hash ~ '^[0-9a-f]{64}$'),
  wallet text not null check (char_length(wallet) between 1 and 80),
  mission_type text not null check (mission_type in ('gem-runner', 'chest-hunter', 'vault-breaker')),
  day_key date not null,
  blueprint_id text not null references public.daily_expedition_blueprints (blueprint_id),
  blueprint_hash text not null check (blueprint_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null,
  expires_at timestamptz not null check (expires_at > created_at),
  consumed_at timestamptz,
  run_id uuid references public.expedition_runs (id),
  authorization_fingerprint text check (authorization_fingerprint is null or authorization_fingerprint ~ '^[0-9a-f]{64}$'),
  canonical_response jsonb,
  check (
    (consumed_at is null and run_id is null and authorization_fingerprint is null and canonical_response is null)
    or (consumed_at is not null and run_id is not null and authorization_fingerprint is not null and canonical_response is not null)
  )
);

create index if not exists expedition_start_challenges_wallet_day_idx
  on public.expedition_start_challenges (day_key, wallet);

create table if not exists public.run_sessions (
  id uuid primary key default gen_random_uuid(),
  run_session_hash text not null unique check (run_session_hash ~ '^[0-9a-f]{64}$'),
  run_id uuid not null references public.expedition_runs (id),
  wallet text not null check (char_length(wallet) between 1 and 80),
  created_at timestamptz not null,
  expires_at timestamptz not null check (expires_at > created_at),
  revoked_at timestamptz
);

create index if not exists run_sessions_run_idx on public.run_sessions (run_id, wallet);

create table if not exists public.expedition_checkpoints (
  run_id uuid not null references public.expedition_runs (id),
  seq integer not null check (seq = 0),
  run_challenge text not null,
  previous_checkpoint_hash text,
  state_hash text not null check (state_hash ~ '^[0-9a-f]{64}$'),
  transcript_hash text not null check (transcript_hash ~ '^[0-9a-f]{64}$'),
  checkpoint_hash text not null check (checkpoint_hash ~ '^[0-9a-f]{64}$'),
  replay_snapshot jsonb not null,
  created_at timestamptz not null,
  primary key (run_id, seq),
  unique (checkpoint_hash)
);

alter table public.daily_expedition_blueprints enable row level security;
alter table public.expedition_start_challenges enable row level security;
alter table public.run_sessions enable row level security;
alter table public.expedition_checkpoints enable row level security;

create or replace function public.create_start_challenge(
  p_wallet text,
  p_mission_type text,
  p_challenge_hash text,
  p_blueprint_id text,
  p_blueprint_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_now timestamptz := pg_catalog.timezone('utc', pg_catalog.now());
  v_day date := v_now::date;
  v_blueprint public.daily_expedition_blueprints%rowtype;
  v_expires_at timestamptz;
begin
  if p_wallet is null or pg_catalog.char_length(p_wallet) = 0 or pg_catalog.char_length(p_wallet) > 80 then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'START_CHALLENGE_INVALID');
  end if;
  if p_mission_type is null or p_mission_type not in ('gem-runner', 'chest-hunter', 'vault-breaker') then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'START_CHALLENGE_INVALID');
  end if;

  select * into v_blueprint
  from public.daily_expedition_blueprints
  where day_key = v_day
    and mission_type = p_mission_type
    and lifecycle = 'PUBLISHED'
    and blueprint_id = p_blueprint_id
    and blueprint_hash = p_blueprint_hash
  for update;

  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'DAILY_BLUEPRINT_UNAVAILABLE');
  end if;

  v_expires_at := least(v_now + pg_catalog.interval '5 minutes', public.next_utc_reset_at(v_day));
  insert into public.expedition_start_challenges (
    challenge_hash,
    wallet,
    mission_type,
    day_key,
    blueprint_id,
    blueprint_hash,
    created_at,
    expires_at
  ) values (
    p_challenge_hash,
    p_wallet,
    p_mission_type,
    v_day,
    v_blueprint.blueprint_id,
    v_blueprint.blueprint_hash,
    v_now,
    v_expires_at
  );

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'challenge_hash', p_challenge_hash,
    'blueprint_id', v_blueprint.blueprint_id,
    'blueprint_hash', v_blueprint.blueprint_hash,
    'day_key', v_day,
    'created_at', v_now,
    'expires_at', v_expires_at
  );
end;
$$;

create or replace function public.start_expedition_authorized(
  p_challenge_hash text,
  p_authorization_fingerprint text,
  p_wallet text,
  p_mission_type text,
  p_day_key date,
  p_blueprint_id text,
  p_blueprint_hash text,
  p_run_session_hash text,
  p_initial_state_hash text,
  p_initial_transcript_hash text,
  p_initial_checkpoint_hash text,
  p_initial_state jsonb,
  p_session_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_now timestamptz := pg_catalog.timezone('utc', pg_catalog.now());
  v_day date := v_now::date;
  v_challenge public.expedition_start_challenges%rowtype;
  v_blueprint public.daily_expedition_blueprints%rowtype;
  v_run public.expedition_runs%rowtype;
  v_started integer;
  v_run_challenge text;
  v_response jsonb;
  v_session_expires_at timestamptz;
begin
  select * into v_challenge
  from public.expedition_start_challenges
  where challenge_hash = p_challenge_hash
  for update;

  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'START_CHALLENGE_INVALID');
  end if;

  -- Idempotency is checked before current-day or expiry checks.
  if v_challenge.consumed_at is not null then
    if v_challenge.authorization_fingerprint = p_authorization_fingerprint
      and v_challenge.canonical_response is not null then
      return pg_catalog.jsonb_build_object(
        'ok', true,
        'outcome', 'START_ALREADY_CREATED',
        'response', v_challenge.canonical_response
      );
    end if;
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'START_CHALLENGE_INVALID');
  end if;

  if v_day <> v_challenge.day_key or p_day_key <> v_challenge.day_key then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'START_CHALLENGE_DAY_EXPIRED');
  end if;
  if v_now >= v_challenge.expires_at then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'START_CHALLENGE_EXPIRED');
  end if;
  if v_challenge.wallet <> p_wallet
    or v_challenge.mission_type <> p_mission_type
    or v_challenge.blueprint_id <> p_blueprint_id
    or v_challenge.blueprint_hash <> p_blueprint_hash then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'START_CHALLENGE_INVALID');
  end if;

  select * into v_blueprint
  from public.daily_expedition_blueprints
  where day_key = v_challenge.day_key
    and mission_type = v_challenge.mission_type
    and lifecycle = 'PUBLISHED'
    and blueprint_id = v_challenge.blueprint_id
    and blueprint_hash = v_challenge.blueprint_hash
  for update;

  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'START_CHALLENGE_INVALID');
  end if;

  insert into public.daily_reward_pools (day_key) values (v_challenge.day_key)
  on conflict (day_key) do nothing;
  insert into public.daily_wallet_state (day_key, wallet)
  values (v_challenge.day_key, p_wallet)
  on conflict (day_key, wallet) do nothing;

  select expeditions_started into v_started
  from public.daily_wallet_state
  where day_key = v_challenge.day_key and wallet = p_wallet
  for update;

  update public.daily_wallet_state
  set expeditions_started = expeditions_started + 1
  where day_key = v_challenge.day_key
    and wallet = p_wallet
    and expeditions_started < 3
  returning expeditions_started into v_started;

  if v_started is null then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'DAILY_EXPEDITION_LIMIT_REACHED');
  end if;

  v_run_challenge := pg_catalog.encode(public.gen_random_bytes(32), 'hex');
  v_session_expires_at := least(p_session_expires_at, public.next_utc_reset_at(v_challenge.day_key));
  insert into public.expedition_runs (
    day_key,
    wallet,
    mission_type,
    status,
    reward_status,
    started_at,
    rules_version,
    room_version,
    blueprint_version,
    blueprint_id,
    blueprint_hash,
    canonical_blueprint,
    run_challenge,
    initial_state_hash,
    initial_transcript_hash,
    initial_checkpoint_hash,
    checkpoint_hash,
    checkpoint_seq,
    replay_snapshot,
    last_checkpoint_at
  ) values (
    v_challenge.day_key,
    p_wallet,
    p_mission_type,
    'STARTED',
    'NONE',
    v_now,
    v_blueprint.rules_version,
    v_blueprint.room_version,
    v_blueprint.blueprint_version,
    v_blueprint.blueprint_id,
    v_blueprint.blueprint_hash,
    v_blueprint.canonical_blueprint,
    v_run_challenge,
    p_initial_state_hash,
    p_initial_transcript_hash,
    p_initial_checkpoint_hash,
    p_initial_checkpoint_hash,
    0,
    p_initial_state,
    v_now
  ) returning * into v_run;

  insert into public.expedition_checkpoints (
    run_id,
    seq,
    run_challenge,
    previous_checkpoint_hash,
    state_hash,
    transcript_hash,
    checkpoint_hash,
    replay_snapshot,
    created_at
  ) values (
    v_run.id,
    0,
    v_run_challenge,
    null,
    p_initial_state_hash,
    p_initial_transcript_hash,
    p_initial_checkpoint_hash,
    p_initial_state,
    v_now
  );

  insert into public.run_sessions (run_session_hash, run_id, wallet, created_at, expires_at)
  values (p_run_session_hash, v_run.id, p_wallet, v_now, v_session_expires_at);

  v_response := pg_catalog.jsonb_build_object(
    'runId', v_run.id,
    'runChallenge', v_run_challenge,
    'attemptsRemaining', 3 - v_started,
    'rulesVersion', v_blueprint.rules_version,
    'roomVersion', v_blueprint.room_version,
    'blueprintVersion', v_blueprint.blueprint_version,
    'blueprintId', v_blueprint.blueprint_id,
    'blueprintHash', v_blueprint.blueprint_hash,
    'blueprint', v_blueprint.canonical_blueprint,
    'dayKey', v_challenge.day_key,
    'nextResetAt', public.next_utc_reset_at(v_challenge.day_key)
  );

  update public.expedition_start_challenges
  set consumed_at = v_now,
      run_id = v_run.id,
      authorization_fingerprint = p_authorization_fingerprint,
      canonical_response = v_response
  where challenge_hash = p_challenge_hash;

  return pg_catalog.jsonb_build_object('ok', true, 'outcome', 'START_CREATED', 'response', v_response);
end;
$$;

revoke all on function public.enforce_blueprint_lifecycle() from public, anon, authenticated;
revoke all on function public.create_start_challenge(text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.start_expedition_authorized(text, text, text, text, date, text, text, text, text, text, text, jsonb, timestamptz) from public, anon, authenticated;

grant execute on function public.create_start_challenge(text, text, text, text, text) to service_role;
grant execute on function public.start_expedition_authorized(text, text, text, text, date, text, text, text, text, text, text, jsonb, timestamptz) to service_role;
