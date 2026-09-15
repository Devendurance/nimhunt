-- NimHunt durable checkpoint, verification, and Vault-seal proof runtime.
-- Extends 002_expedition_proof.sql. No claim, settlement, or transfer state.

alter table public.expedition_runs
  add column if not exists gameplay_started_at timestamptz,
  add column if not exists transcript_hash text,
  add column if not exists state_hash text,
  add column if not exists terminal jsonb,
  add column if not exists trusted_final_summary jsonb,
  add column if not exists verified_at timestamptz;

alter table public.expedition_runs
  drop constraint if exists expedition_runs_transcript_hash_hex;
alter table public.expedition_runs
  add constraint expedition_runs_transcript_hash_hex
  check (transcript_hash is null or transcript_hash ~ '^[0-9a-f]{64}$');

alter table public.expedition_runs
  drop constraint if exists expedition_runs_state_hash_hex;
alter table public.expedition_runs
  add constraint expedition_runs_state_hash_hex
  check (state_hash is null or state_hash ~ '^[0-9a-f]{64}$');

create table if not exists public.expedition_checkpoint_batches (
  run_id uuid not null references public.expedition_runs (id),
  seq_start integer not null check (seq_start >= 1),
  seq_end integer not null check (seq_end >= seq_start),
  previous_checkpoint_hash text not null check (previous_checkpoint_hash ~ '^[0-9a-f]{64}$'),
  actions jsonb not null,
  batch_fingerprint text not null check (batch_fingerprint ~ '^[0-9a-f]{64}$'),
  transcript_hash text not null check (transcript_hash ~ '^[0-9a-f]{64}$'),
  state_hash text not null check (state_hash ~ '^[0-9a-f]{64}$'),
  checkpoint_hash text not null check (checkpoint_hash ~ '^[0-9a-f]{64}$'),
  acknowledgement jsonb not null,
  created_at timestamptz not null default pg_catalog.timezone('utc', pg_catalog.now()),
  primary key (run_id, seq_start),
  unique (run_id, previous_checkpoint_hash),
  unique (run_id, seq_end),
  unique (checkpoint_hash),
  check (seq_end - seq_start + 1 <= 8),
  check (pg_catalog.jsonb_typeof(actions) = 'array'),
  check (pg_catalog.jsonb_array_length(actions) = seq_end - seq_start + 1)
);

create table if not exists public.expedition_vault_seals (
  run_id uuid primary key references public.expedition_runs (id),
  wallet text not null check (pg_catalog.char_length(wallet) between 1 and 80),
  canonical_payload text not null check (pg_catalog.char_length(canonical_payload) between 1 and 4096),
  vault_seal_hash text not null check (vault_seal_hash ~ '^[0-9a-f]{64}$'),
  public_key text not null check (pg_catalog.char_length(public_key) between 1 and 130),
  signature text not null check (pg_catalog.char_length(signature) between 1 and 258),
  vault_checkpoint_hash text not null check (vault_checkpoint_hash ~ '^[0-9a-f]{64}$'),
  verified_at timestamptz not null
);

create or replace function public.reject_immutable_proof_row()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  raise exception 'PROOF_LOST';
end;
$$;

drop trigger if exists expedition_checkpoint_batches_immutable_update on public.expedition_checkpoint_batches;
create trigger expedition_checkpoint_batches_immutable_update
before update on public.expedition_checkpoint_batches
for each row execute function public.reject_immutable_proof_row();

drop trigger if exists expedition_checkpoint_batches_immutable_delete on public.expedition_checkpoint_batches;
create trigger expedition_checkpoint_batches_immutable_delete
before delete on public.expedition_checkpoint_batches
for each row execute function public.reject_immutable_proof_row();

drop trigger if exists expedition_vault_seals_immutable_update on public.expedition_vault_seals;
create trigger expedition_vault_seals_immutable_update
before update on public.expedition_vault_seals
for each row execute function public.reject_immutable_proof_row();

drop trigger if exists expedition_vault_seals_immutable_delete on public.expedition_vault_seals;
create trigger expedition_vault_seals_immutable_delete
before delete on public.expedition_vault_seals
for each row execute function public.reject_immutable_proof_row();

alter table public.expedition_checkpoint_batches enable row level security;
alter table public.expedition_vault_seals enable row level security;
alter table public.expedition_runs force row level security;
alter table public.daily_expedition_blueprints force row level security;
alter table public.expedition_start_challenges force row level security;
alter table public.run_sessions force row level security;
alter table public.expedition_checkpoints force row level security;
alter table public.expedition_checkpoint_batches force row level security;
alter table public.expedition_vault_seals force row level security;

do $$
begin
  grant select, insert, update, delete on public.daily_expedition_blueprints to anon, authenticated;
  grant select, insert, update, delete on public.expedition_start_challenges to anon, authenticated;
  grant select, insert, update, delete on public.run_sessions to anon, authenticated;
  grant select, insert, update, delete on public.expedition_checkpoints to anon, authenticated;
  grant select, insert, update, delete on public.expedition_checkpoint_batches to anon, authenticated;
  grant select, insert, update, delete on public.expedition_vault_seals to anon, authenticated;
  grant select, insert, update, delete on public.expedition_runs to anon, authenticated;
exception
  when undefined_object then null;
  when insufficient_privilege then null;
end $$;

drop function if exists public.start_expedition_authorized(text, text, text, text, date, text, text, text, text, text, text, jsonb, timestamptz);

create or replace function public.get_published_blueprint(p_day_key date, p_mission_type text)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_blueprint public.daily_expedition_blueprints%rowtype;
begin
  if p_mission_type is null or p_mission_type not in ('gem-runner', 'chest-hunter', 'vault-breaker') then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'DAILY_BLUEPRINT_UNAVAILABLE');
  end if;

  select * into v_blueprint
  from public.daily_expedition_blueprints
  where day_key = p_day_key
    and mission_type = p_mission_type
    and lifecycle = 'PUBLISHED';

  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'DAILY_BLUEPRINT_UNAVAILABLE');
  end if;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'blueprint', v_blueprint.canonical_blueprint,
    'blueprint_id', v_blueprint.blueprint_id,
    'blueprint_hash', v_blueprint.blueprint_hash,
    'day_key', v_blueprint.day_key,
    'rules_version', v_blueprint.rules_version,
    'room_version', v_blueprint.room_version,
    'blueprint_version', v_blueprint.blueprint_version
  );
end;
$$;

create or replace function public.register_published_blueprint(
  p_day_key date,
  p_mission_type text,
  p_rules_version text,
  p_room_version text,
  p_blueprint_version text,
  p_blueprint_id text,
  p_blueprint_hash text,
  p_canonical_blueprint jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_existing public.daily_expedition_blueprints%rowtype;
  v_id uuid;
begin
  if p_mission_type is null or p_mission_type not in ('gem-runner', 'chest-hunter', 'vault-breaker') then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'BLUEPRINT_INVALID');
  end if;
  if p_blueprint_id is null or pg_catalog.char_length(p_blueprint_id) = 0 or pg_catalog.char_length(p_blueprint_id) > 256 then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'BLUEPRINT_INVALID');
  end if;
  if p_blueprint_hash is null or p_blueprint_hash !~ '^[0-9a-f]{64}$' then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'BLUEPRINT_INVALID');
  end if;
  if p_canonical_blueprint is null
    or p_canonical_blueprint->>'dayKey' is distinct from p_day_key::text
    or p_canonical_blueprint->>'mission' is distinct from p_mission_type
    or p_canonical_blueprint->>'blueprintId' is distinct from p_blueprint_id
    or p_canonical_blueprint->>'blueprintHash' is distinct from p_blueprint_hash then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'BLUEPRINT_INVALID');
  end if;

  begin
    insert into public.daily_expedition_blueprints (
      day_key,
      mission_type,
      lifecycle,
      rules_version,
      room_version,
      blueprint_version,
      blueprint_id,
      canonical_blueprint,
      blueprint_hash,
      published_at
    ) values (
      p_day_key,
      p_mission_type,
      'PUBLISHED',
      p_rules_version,
      p_room_version,
      p_blueprint_version,
      p_blueprint_id,
      p_canonical_blueprint,
      p_blueprint_hash,
      pg_catalog.timezone('utc', pg_catalog.now())
    ) returning id into v_id;
  exception
    when unique_violation then
      select * into v_existing
      from public.daily_expedition_blueprints
      where blueprint_id = p_blueprint_id;
      if found then
        if v_existing.blueprint_hash is distinct from p_blueprint_hash
          or v_existing.canonical_blueprint is distinct from p_canonical_blueprint
          or v_existing.day_key is distinct from p_day_key
          or v_existing.mission_type is distinct from p_mission_type then
          return pg_catalog.jsonb_build_object('ok', false, 'error', 'BLUEPRINT_IMMUTABLE');
        end if;
        return pg_catalog.jsonb_build_object('ok', true, 'blueprint_id', v_existing.blueprint_id, 'existing', true);
      end if;
      return pg_catalog.jsonb_build_object('ok', false, 'error', 'BLUEPRINT_ALREADY_PUBLISHED');
  end;

  return pg_catalog.jsonb_build_object('ok', true, 'blueprint_id', p_blueprint_id, 'existing', false);
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
  p_run_id uuid,
  p_run_challenge text,
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
  v_response jsonb;
  v_session_expires_at timestamptz;
begin
  if p_run_id is null
    or p_run_challenge is null or p_run_challenge !~ '^[0-9a-f]{64}$'
    or p_run_session_hash is null or p_run_session_hash !~ '^[0-9a-f]{64}$'
    or p_initial_state_hash is null or p_initial_state_hash !~ '^[0-9a-f]{64}$'
    or p_initial_transcript_hash is null or p_initial_transcript_hash !~ '^[0-9a-f]{64}$'
    or p_initial_checkpoint_hash is null or p_initial_checkpoint_hash !~ '^[0-9a-f]{64}$'
    or p_authorization_fingerprint is null or p_authorization_fingerprint !~ '^[0-9a-f]{64}$'
    or p_initial_state is null then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'START_CHALLENGE_INVALID');
  end if;

  select * into v_challenge
  from public.expedition_start_challenges
  where challenge_hash = p_challenge_hash
  for update;

  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'START_CHALLENGE_INVALID');
  end if;

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

  v_session_expires_at := least(p_session_expires_at, public.next_utc_reset_at(v_challenge.day_key));
  insert into public.expedition_runs (
    id,
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
    transcript_hash,
    state_hash,
    last_checkpoint_at
  ) values (
    p_run_id,
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
    p_run_challenge,
    p_initial_state_hash,
    p_initial_transcript_hash,
    p_initial_checkpoint_hash,
    p_initial_checkpoint_hash,
    0,
    p_initial_state,
    p_initial_transcript_hash,
    p_initial_state_hash,
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
    p_run_challenge,
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
    'runChallenge', p_run_challenge,
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

create or replace function public.bind_run_session(
  p_run_id uuid,
  p_wallet text,
  p_run_session_hash text,
  p_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_now timestamptz := pg_catalog.timezone('utc', pg_catalog.now());
  v_run public.expedition_runs%rowtype;
  v_expires_at timestamptz;
begin
  if p_run_session_hash is null or p_run_session_hash !~ '^[0-9a-f]{64}$' then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'RUN_SESSION_INVALID');
  end if;

  select * into v_run
  from public.expedition_runs
  where id = p_run_id
  for update;

  if not found or v_run.wallet <> p_wallet then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'RUN_SESSION_INVALID');
  end if;

  v_expires_at := least(p_expires_at, public.next_utc_reset_at(v_run.day_key));
  insert into public.run_sessions (run_session_hash, run_id, wallet, created_at, expires_at)
  values (p_run_session_hash, v_run.id, p_wallet, v_now, v_expires_at);

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'session_hash', p_run_session_hash,
    'run_id', v_run.id,
    'wallet', p_wallet,
    'created_at', v_now,
    'expires_at', v_expires_at
  );
end;
$$;

create or replace function public.get_run_session(p_run_session_hash text)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_session public.run_sessions%rowtype;
begin
  if p_run_session_hash is null or p_run_session_hash !~ '^[0-9a-f]{64}$' then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'INVALID_SESSION');
  end if;

  select * into v_session
  from public.run_sessions
  where run_session_hash = p_run_session_hash;

  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'INVALID_SESSION');
  end if;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'session_hash', v_session.run_session_hash,
    'run_id', v_session.run_id,
    'wallet', v_session.wallet,
    'created_at', v_session.created_at,
    'expires_at', v_session.expires_at,
    'revoked_at', v_session.revoked_at
  );
end;
$$;

create or replace function public.load_expedition_run(p_run_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_run public.expedition_runs%rowtype;
  v_batches jsonb;
  v_seal public.expedition_vault_seals%rowtype;
begin
  if p_run_id is null then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'RUN_NOT_FOUND');
  end if;

  select * into v_run from public.expedition_runs where id = p_run_id;
  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'RUN_NOT_FOUND');
  end if;

  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'previous_checkpoint_hash', b.previous_checkpoint_hash,
    'seq_start', b.seq_start,
    'seq_end', b.seq_end,
    'actions', b.actions,
    'batch_fingerprint', b.batch_fingerprint,
    'transcript_hash', b.transcript_hash,
    'state_hash', b.state_hash,
    'checkpoint_hash', b.checkpoint_hash,
    'acknowledgement', b.acknowledgement
  ) order by b.seq_start), '[]'::jsonb)
  into v_batches
  from public.expedition_checkpoint_batches b
  where b.run_id = p_run_id;

  select * into v_seal from public.expedition_vault_seals where run_id = p_run_id;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'run', pg_catalog.jsonb_build_object(
      'id', v_run.id,
      'day_key', v_run.day_key,
      'wallet', v_run.wallet,
      'mission_type', v_run.mission_type,
      'status', v_run.status,
      'reward_status', v_run.reward_status,
      'started_at', v_run.started_at,
      'gameplay_started_at', v_run.gameplay_started_at,
      'run_challenge', v_run.run_challenge,
      'canonical_blueprint', v_run.canonical_blueprint,
      'replay_snapshot', v_run.replay_snapshot,
      'initial_state_hash', v_run.initial_state_hash,
      'initial_transcript_hash', v_run.initial_transcript_hash,
      'initial_checkpoint_hash', v_run.initial_checkpoint_hash,
      'checkpoint_hash', v_run.checkpoint_hash,
      'checkpoint_seq', v_run.checkpoint_seq,
      'transcript_hash', v_run.transcript_hash,
      'state_hash', v_run.state_hash,
      'terminal', v_run.terminal,
      'trusted_final_summary', v_run.trusted_final_summary,
      'verified_at', v_run.verified_at
    ),
    'batches', v_batches,
    'vault_seal', case when v_seal.run_id is null then null else pg_catalog.jsonb_build_object(
      'run_id', v_seal.run_id,
      'wallet', v_seal.wallet,
      'canonical_payload', v_seal.canonical_payload,
      'vault_seal_hash', v_seal.vault_seal_hash,
      'public_key', v_seal.public_key,
      'signature', v_seal.signature,
      'vault_checkpoint_hash', v_seal.vault_checkpoint_hash,
      'verified_at', v_seal.verified_at
    ) end
  );
end;
$$;

create or replace function public.load_proof_snapshot()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_blueprints jsonb;
  v_challenges jsonb;
  v_runs jsonb;
  v_sessions jsonb;
begin
  select coalesce(pg_catalog.jsonb_agg(canonical_blueprint), '[]'::jsonb)
  into v_blueprints
  from public.daily_expedition_blueprints;

  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'challenge_hash', challenge_hash,
    'wallet', wallet,
    'mission_type', mission_type,
    'day_key', day_key,
    'blueprint_id', blueprint_id,
    'blueprint_hash', blueprint_hash,
    'created_at', created_at,
    'expires_at', expires_at,
    'consumed_at', consumed_at,
    'run_id', run_id,
    'authorization_fingerprint', authorization_fingerprint,
    'canonical_response', canonical_response
  )), '[]'::jsonb)
  into v_challenges
  from public.expedition_start_challenges;

  select coalesce(pg_catalog.jsonb_agg(id::text), '[]'::jsonb)
  into v_runs
  from public.expedition_runs;

  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'session_hash', run_session_hash,
    'run_id', run_id,
    'wallet', wallet,
    'created_at', created_at,
    'expires_at', expires_at,
    'revoked_at', revoked_at
  )), '[]'::jsonb)
  into v_sessions
  from public.run_sessions;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'blueprints', v_blueprints,
    'challenges', v_challenges,
    'run_ids', v_runs,
    'sessions', v_sessions
  );
end;
$$;

create or replace function public.mark_gameplay_started(p_run_id uuid, p_run_session_hash text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_now timestamptz := pg_catalog.timezone('utc', pg_catalog.now());
  v_run public.expedition_runs%rowtype;
  v_session public.run_sessions%rowtype;
begin
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
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'RUN_SESSION_INVALID');
  end if;
  if v_run.status <> 'STARTED' or v_now >= public.next_utc_reset_at(v_run.day_key) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'RUN_SESSION_INVALID');
  end if;
  if v_run.gameplay_started_at is not null then
    return pg_catalog.jsonb_build_object('ok', true, 'run_id', v_run.id, 'outcome', 'GAMEPLAY_ALREADY_STARTED');
  end if;
  if v_run.checkpoint_seq <> 0 or v_run.terminal is not null then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'ACTIVE_RUN_UNAVAILABLE');
  end if;

  update public.expedition_runs
  set gameplay_started_at = v_now
  where id = p_run_id;

  return pg_catalog.jsonb_build_object('ok', true, 'run_id', p_run_id, 'outcome', 'GAMEPLAY_STARTED');
end;
$$;

create or replace function public.append_checkpoint_batch(
  p_run_id uuid,
  p_run_session_hash text,
  p_previous_checkpoint_hash text,
  p_actions jsonb,
  p_seq_start integer,
  p_seq_end integer,
  p_batch_fingerprint text,
  p_transcript_hash text,
  p_state_hash text,
  p_checkpoint_hash text,
  p_replay_snapshot jsonb,
  p_acknowledgement jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_now timestamptz := pg_catalog.timezone('utc', pg_catalog.now());
  v_run public.expedition_runs%rowtype;
  v_session public.run_sessions%rowtype;
  v_existing public.expedition_checkpoint_batches%rowtype;
  v_action_count integer;
begin
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
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'RUN_SESSION_INVALID');
  end if;

  if v_run.gameplay_started_at is null
    or v_run.status <> 'STARTED'
    or v_run.terminal is not null
    or v_now >= public.next_utc_reset_at(v_run.day_key) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'RUN_NOT_ACTIVE');
  end if;

  select * into v_existing
  from public.expedition_checkpoint_batches
  where run_id = p_run_id
    and previous_checkpoint_hash = p_previous_checkpoint_hash;

  if found then
    if v_existing.actions = p_actions and v_existing.batch_fingerprint = p_batch_fingerprint then
      return pg_catalog.jsonb_build_object('ok', true, 'acknowledgement', v_existing.acknowledgement, 'existing', true);
    end if;
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'CHECKPOINT_MISMATCH');
  end if;

  if p_previous_checkpoint_hash is distinct from v_run.checkpoint_hash then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'CHECKPOINT_MISMATCH');
  end if;

  if p_actions is null or pg_catalog.jsonb_typeof(p_actions) <> 'array' then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'MALFORMED_REQUEST');
  end if;
  v_action_count := pg_catalog.jsonb_array_length(p_actions);
  if v_action_count < 1 or v_action_count > 8 then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'MALFORMED_REQUEST');
  end if;
  if p_seq_start <> v_run.checkpoint_seq + 1 or p_seq_end <> p_seq_start + v_action_count - 1 then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'INVALID_SEQUENCE');
  end if;
  if v_run.checkpoint_seq + v_action_count > 256 then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'ACTION_LIMIT_EXCEEDED');
  end if;

  insert into public.expedition_checkpoint_batches (
    run_id,
    seq_start,
    seq_end,
    previous_checkpoint_hash,
    actions,
    batch_fingerprint,
    transcript_hash,
    state_hash,
    checkpoint_hash,
    acknowledgement,
    created_at
  ) values (
    p_run_id,
    p_seq_start,
    p_seq_end,
    p_previous_checkpoint_hash,
    p_actions,
    p_batch_fingerprint,
    p_transcript_hash,
    p_state_hash,
    p_checkpoint_hash,
    p_acknowledgement,
    v_now
  );

  update public.expedition_runs
  set checkpoint_hash = p_checkpoint_hash,
      checkpoint_seq = p_seq_end,
      replay_snapshot = p_replay_snapshot,
      transcript_hash = p_transcript_hash,
      state_hash = p_state_hash,
      last_checkpoint_at = v_now
  where id = p_run_id;

  return pg_catalog.jsonb_build_object('ok', true, 'acknowledgement', p_acknowledgement, 'existing', false);
end;
$$;

create or replace function public.persist_run_terminal(
  p_run_id uuid,
  p_run_session_hash text,
  p_checkpoint_hash text,
  p_status text,
  p_reward_status text,
  p_terminal jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_now timestamptz := pg_catalog.timezone('utc', pg_catalog.now());
  v_run public.expedition_runs%rowtype;
  v_session public.run_sessions%rowtype;
  v_ended_at timestamptz;
  v_verified_at timestamptz;
begin
  if p_status not in ('STARTED', 'COMPLETED', 'FAILED', 'ABANDONED')
    or p_reward_status not in ('NONE', 'ELIGIBLE')
    or p_terminal is null then
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
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'RUN_SESSION_INVALID');
  end if;

  if v_run.terminal is not null then
    if p_checkpoint_hash is distinct from v_run.checkpoint_hash then
      return pg_catalog.jsonb_build_object('ok', false, 'error', 'CHECKPOINT_MISMATCH');
    end if;
    return pg_catalog.jsonb_build_object(
      'ok', true,
      'existing', true,
      'status', v_run.status,
      'reward_status', v_run.reward_status,
      'terminal', v_run.terminal
    );
  end if;

  if p_checkpoint_hash is distinct from v_run.checkpoint_hash then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'CHECKPOINT_MISMATCH');
  end if;

  v_ended_at := case when p_status = 'STARTED' then null else v_now end;
  v_verified_at := case
    when p_terminal->>'type' = 'VERIFIED' then coalesce((p_terminal->'result'->>'verifiedAt')::timestamptz, v_now)
    else null
  end;

  update public.expedition_runs
  set status = p_status::public.expedition_run_status,
      reward_status = p_reward_status::public.expedition_reward_status,
      terminal = p_terminal,
      trusted_final_summary = case when p_terminal->>'type' = 'VERIFIED' then p_terminal->'result' else trusted_final_summary end,
      verified_at = v_verified_at,
      ended_at = v_ended_at
  where id = p_run_id
  returning * into v_run;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'existing', false,
    'status', v_run.status,
    'reward_status', v_run.reward_status,
    'terminal', v_run.terminal
  );
end;
$$;

create or replace function public.persist_vault_seal(
  p_run_id uuid,
  p_run_session_hash text,
  p_wallet text,
  p_canonical_payload text,
  p_vault_seal_hash text,
  p_public_key text,
  p_signature text,
  p_vault_checkpoint_hash text,
  p_verified_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_now timestamptz := pg_catalog.timezone('utc', pg_catalog.now());
  v_run public.expedition_runs%rowtype;
  v_session public.run_sessions%rowtype;
  v_seal public.expedition_vault_seals%rowtype;
begin
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

  if not found or v_run.wallet <> v_session.wallet or v_run.wallet <> p_wallet then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'RUN_SESSION_INVALID');
  end if;

  select * into v_seal from public.expedition_vault_seals where run_id = p_run_id;
  if found then
    if v_seal.canonical_payload is distinct from p_canonical_payload
      or v_seal.run_id is distinct from p_run_id then
      return pg_catalog.jsonb_build_object('ok', false, 'error', 'VAULT_SEAL_MISMATCH');
    end if;
    return pg_catalog.jsonb_build_object(
      'ok', true,
      'existing', true,
      'seal', pg_catalog.jsonb_build_object(
        'run_id', v_seal.run_id,
        'wallet', v_seal.wallet,
        'canonical_payload', v_seal.canonical_payload,
        'vault_seal_hash', v_seal.vault_seal_hash,
        'public_key', v_seal.public_key,
        'signature', v_seal.signature,
        'vault_checkpoint_hash', v_seal.vault_checkpoint_hash,
        'verified_at', v_seal.verified_at
      )
    );
  end if;

  insert into public.expedition_vault_seals (
    run_id,
    wallet,
    canonical_payload,
    vault_seal_hash,
    public_key,
    signature,
    vault_checkpoint_hash,
    verified_at
  ) values (
    p_run_id,
    p_wallet,
    p_canonical_payload,
    p_vault_seal_hash,
    p_public_key,
    p_signature,
    p_vault_checkpoint_hash,
    coalesce(p_verified_at, v_now)
  ) returning * into v_seal;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'existing', false,
    'seal', pg_catalog.jsonb_build_object(
      'run_id', v_seal.run_id,
      'wallet', v_seal.wallet,
      'canonical_payload', v_seal.canonical_payload,
      'vault_seal_hash', v_seal.vault_seal_hash,
      'public_key', v_seal.public_key,
      'signature', v_seal.signature,
      'vault_checkpoint_hash', v_seal.vault_checkpoint_hash,
      'verified_at', v_seal.verified_at
    )
  );
end;
$$;

revoke all on function public.reject_immutable_proof_row() from public, anon, authenticated;
revoke all on function public.get_published_blueprint(date, text) from public, anon, authenticated;
revoke all on function public.register_published_blueprint(date, text, text, text, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.start_expedition_authorized(text, text, text, text, date, text, text, uuid, text, text, text, text, text, jsonb, timestamptz) from public, anon, authenticated;
revoke all on function public.bind_run_session(uuid, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.get_run_session(text) from public, anon, authenticated;
revoke all on function public.load_expedition_run(uuid) from public, anon, authenticated;
revoke all on function public.load_proof_snapshot() from public, anon, authenticated;
revoke all on function public.mark_gameplay_started(uuid, text) from public, anon, authenticated;
revoke all on function public.append_checkpoint_batch(uuid, text, text, jsonb, integer, integer, text, text, text, text, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.persist_run_terminal(uuid, text, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.persist_vault_seal(uuid, text, text, text, text, text, text, text, timestamptz) from public, anon, authenticated;

do $$
begin
  grant execute on function public.get_published_blueprint(date, text) to service_role;
  grant execute on function public.register_published_blueprint(date, text, text, text, text, text, text, jsonb) to service_role;
  grant execute on function public.start_expedition_authorized(text, text, text, text, date, text, text, uuid, text, text, text, text, text, jsonb, timestamptz) to service_role;
  grant execute on function public.bind_run_session(uuid, text, text, timestamptz) to service_role;
  grant execute on function public.get_run_session(text) to service_role;
  grant execute on function public.load_expedition_run(uuid) to service_role;
  grant execute on function public.load_proof_snapshot() to service_role;
  grant execute on function public.mark_gameplay_started(uuid, text) to service_role;
  grant execute on function public.append_checkpoint_batch(uuid, text, text, jsonb, integer, integer, text, text, text, text, jsonb, jsonb) to service_role;
  grant execute on function public.persist_run_terminal(uuid, text, text, text, text, jsonb) to service_role;
  grant execute on function public.persist_vault_seal(uuid, text, text, text, text, text, text, text, timestamptz) to service_role;
exception
  when undefined_object then null;
end $$;
