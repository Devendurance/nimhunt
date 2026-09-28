-- NimHunt P1 wallet-owned Adventurer identity foundation.
-- This migration is additive. Existing expedition, claim, reward, and payout
-- tables remain wallet-authoritative and are not linked to player_id.
-- No user-uploaded avatar storage is created; avatar IDs are a durable
-- catalogue contract for curated artwork that can be bound in a later UI slice.

create extension if not exists pgcrypto;

create table if not exists public.adventurer_avatars (
  avatar_id text primary key check (pg_catalog.char_length(avatar_id) between 1 and 64),
  starter boolean not null default false,
  active boolean not null default true,
  sort_order integer not null check (sort_order > 0),
  created_at timestamptz not null default pg_catalog.timezone('utc', pg_catalog.now())
);

-- Durable IDs only. No image files or arbitrary URL/upload support is implied.
insert into public.adventurer_avatars (avatar_id, starter, active, sort_order)
values
  ('adventurer-01', true, true, 1),
  ('adventurer-02', true, true, 2),
  ('adventurer-03', true, true, 3),
  ('adventurer-04', true, true, 4),
  ('adventurer-05', true, true, 5),
  ('adventurer-06', true, true, 6),
  ('adventurer-07', true, true, 7),
  ('adventurer-08', true, true, 8),
  ('adventurer-09', true, true, 9),
  ('adventurer-10', true, true, 10),
  ('adventurer-11', true, true, 11),
  ('adventurer-12', true, true, 12)
on conflict (avatar_id) do nothing;

create table if not exists public.adventurer_profiles (
  player_id uuid primary key default gen_random_uuid(),
  wallet text not null unique check (pg_catalog.char_length(wallet) between 1 and 80),
  display_name text not null check (pg_catalog.char_length(display_name) between 3 and 20),
  normalized_display_name text not null unique check (pg_catalog.char_length(normalized_display_name) between 3 and 20),
  avatar_id text not null references public.adventurer_avatars (avatar_id),
  display_name_changed_at timestamptz not null,
  created_at timestamptz not null default pg_catalog.timezone('utc', pg_catalog.now()),
  updated_at timestamptz not null default pg_catalog.timezone('utc', pg_catalog.now())
);

create index if not exists adventurer_profiles_wallet_idx
  on public.adventurer_profiles (wallet);
create index if not exists adventurer_profiles_display_name_idx
  on public.adventurer_profiles (normalized_display_name);

create table if not exists public.adventurer_challenges (
  challenge_hash text primary key check (challenge_hash ~ '^[0-9a-f]{64}$'),
  purpose text not null check (purpose in ('CREATE', 'SESSION', 'RENAME')),
  wallet text not null check (pg_catalog.char_length(wallet) between 1 and 80),
  player_id uuid references public.adventurer_profiles (player_id),
  issued_at timestamptz not null,
  expires_at timestamptz not null check (expires_at > issued_at),
  consumed_at timestamptz,
  authorization_fingerprint text check (
    authorization_fingerprint is null or authorization_fingerprint ~ '^[0-9a-f]{64}$'
  ),
  check (
    (consumed_at is null and authorization_fingerprint is null)
    or (consumed_at is not null and authorization_fingerprint is not null)
  )
);

create index if not exists adventurer_challenges_wallet_purpose_idx
  on public.adventurer_challenges (wallet, purpose, issued_at desc);
create index if not exists adventurer_challenges_expiry_idx
  on public.adventurer_challenges (expires_at)
  where consumed_at is null;

create table if not exists public.adventurer_sessions (
  id uuid primary key default gen_random_uuid(),
  session_hash text not null unique check (session_hash ~ '^[0-9a-f]{64}$'),
  player_id uuid not null references public.adventurer_profiles (player_id),
  wallet text not null check (pg_catalog.char_length(wallet) between 1 and 80),
  created_at timestamptz not null,
  expires_at timestamptz not null check (expires_at > created_at),
  revoked_at timestamptz
);

create index if not exists adventurer_sessions_player_idx
  on public.adventurer_sessions (player_id, expires_at desc);
create index if not exists adventurer_sessions_wallet_idx
  on public.adventurer_sessions (wallet, expires_at desc);

-- Identity and capability tables are private. There are intentionally no
-- anon/authenticated policies or table privileges. Only server RPCs execute
-- with service_role, and the service role is the sole authoritative writer.
alter table public.adventurer_avatars enable row level security;
alter table public.adventurer_avatars force row level security;
alter table public.adventurer_profiles enable row level security;
alter table public.adventurer_profiles force row level security;
alter table public.adventurer_challenges enable row level security;
alter table public.adventurer_challenges force row level security;
alter table public.adventurer_sessions enable row level security;
alter table public.adventurer_sessions force row level security;

revoke all on table public.adventurer_avatars from public, anon, authenticated;
revoke all on table public.adventurer_profiles from public, anon, authenticated;
revoke all on table public.adventurer_challenges from public, anon, authenticated;
revoke all on table public.adventurer_sessions from public, anon, authenticated;
grant all on table public.adventurer_avatars to service_role;
grant all on table public.adventurer_profiles to service_role;
grant all on table public.adventurer_challenges to service_role;
grant all on table public.adventurer_sessions to service_role;

create or replace function public.adventurer_name_validation_error(
  p_display_name text,
  p_normalized_name text
)
returns text
language plpgsql
immutable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_compact text;
begin
  if p_display_name is null or p_normalized_name is null then
    return 'DISPLAY_NAME_INVALID';
  end if;
  if p_display_name <> pg_catalog.btrim(p_display_name)
    or pg_catalog.char_length(p_display_name) < 3
    or pg_catalog.char_length(p_display_name) > 20
    or p_display_name !~ '^[A-Za-z0-9_]+( [A-Za-z0-9_]+)*$'
    or p_normalized_name is distinct from pg_catalog.lower(p_display_name) then
    return 'DISPLAY_NAME_INVALID';
  end if;

  if p_normalized_name in (
    'nimhunt', 'nimiq', 'admin', 'administrator', 'moderator',
    'treasury', 'support', 'official', 'system'
  ) then
    return 'DISPLAY_NAME_RESERVED';
  end if;

  v_compact := replace(p_normalized_name, ' ', '');
  if v_compact like '%fuck%'
    or v_compact like '%shit%'
    or v_compact like '%bitch%'
    or v_compact like '%cunt%'
    or v_compact like '%asshole%'
    or v_compact like '%nigger%'
    or v_compact like '%faggot%' then
    return 'DISPLAY_NAME_INVALID';
  end if;
  return null;
end;
$$;

create or replace function public.adventurer_avatar_is_available(p_avatar_id text)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.adventurer_avatars
    where avatar_id = p_avatar_id
      and starter is true
      and active is true
  );
$$;

create or replace function public.reject_adventurer_profile_mutation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_name_error text;
begin
  if tg_op = 'UPDATE' and (
    new.player_id is distinct from old.player_id
    or new.wallet is distinct from old.wallet
    or new.created_at is distinct from old.created_at
  ) then
    raise exception 'ADVENTURER_IDENTITY_IMMUTABLE';
  end if;

  v_name_error := public.adventurer_name_validation_error(new.display_name, pg_catalog.lower(new.display_name));
  if v_name_error is not null then
    raise exception '%', v_name_error;
  end if;
  if not public.adventurer_avatar_is_available(new.avatar_id) then
    raise exception 'AVATAR_UNAVAILABLE';
  end if;
  if tg_op = 'UPDATE' and new.display_name is distinct from old.display_name
    and pg_catalog.timezone('utc', pg_catalog.now()) < old.display_name_changed_at + pg_catalog.interval '30 days' then
    raise exception 'DISPLAY_NAME_COOLDOWN';
  end if;

  new.normalized_display_name := pg_catalog.lower(new.display_name);
  if tg_op = 'UPDATE' and new.display_name is distinct from old.display_name then
    new.display_name_changed_at := pg_catalog.timezone('utc', pg_catalog.now());
  end if;
  new.updated_at := pg_catalog.timezone('utc', pg_catalog.now());
  return new;
end;
$$;

drop trigger if exists adventurer_profiles_guard on public.adventurer_profiles;
create trigger adventurer_profiles_guard
before insert or update on public.adventurer_profiles
for each row execute function public.reject_adventurer_profile_mutation();

create or replace function public.adventurer_profile_json(p_profile public.adventurer_profiles)
returns jsonb
language sql
stable
as $$
  select pg_catalog.jsonb_build_object(
    'player_id', p_profile.player_id,
    'wallet', p_profile.wallet,
    'display_name', p_profile.display_name,
    'normalized_display_name', p_profile.normalized_display_name,
    'avatar_id', p_profile.avatar_id,
    'display_name_changed_at', p_profile.display_name_changed_at,
    'created_at', p_profile.created_at,
    'updated_at', p_profile.updated_at
  );
$$;

create or replace function public.adventurer_session_json(p_session public.adventurer_sessions)
returns jsonb
language sql
stable
as $$
  select pg_catalog.jsonb_build_object(
    'session_hash', p_session.session_hash,
    'player_id', p_session.player_id,
    'wallet', p_session.wallet,
    'created_at', p_session.created_at,
    'expires_at', p_session.expires_at,
    'revoked_at', p_session.revoked_at
  );
$$;

create or replace function public.create_adventurer_challenge(
  p_wallet text,
  p_purpose text,
  p_challenge_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_now timestamptz := pg_catalog.date_trunc('milliseconds', pg_catalog.timezone('utc', pg_catalog.now()));
  v_expires_at timestamptz := v_now + pg_catalog.interval '5 minutes';
  v_profile public.adventurer_profiles%rowtype;
begin
  if p_wallet is null or pg_catalog.char_length(p_wallet) = 0 or pg_catalog.char_length(p_wallet) > 80
    or p_purpose is null or p_purpose not in ('CREATE', 'SESSION')
    or p_challenge_hash is null or p_challenge_hash !~ '^[0-9a-f]{64}$' then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'CHALLENGE_INVALID');
  end if;

  select * into v_profile
  from public.adventurer_profiles
  where wallet = p_wallet;

  if p_purpose = 'CREATE' and found then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'PROFILE_ALREADY_EXISTS');
  end if;
  if p_purpose = 'SESSION' and not found then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'PROFILE_NOT_FOUND');
  end if;

  insert into public.adventurer_challenges (
    challenge_hash, purpose, wallet, player_id, issued_at, expires_at
  ) values (
    p_challenge_hash, p_purpose, p_wallet,
    case when p_purpose = 'SESSION' then v_profile.player_id else null end,
    v_now, v_expires_at
  );

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'wallet', p_wallet,
    'player_id', case when p_purpose = 'SESSION' then v_profile.player_id else null end,
    'issued_at', v_now,
    'expires_at', v_expires_at
  );
exception
  when unique_violation then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'CHALLENGE_INVALID');
end;
$$;

create or replace function public.consume_create_adventurer_challenge(
  p_challenge_hash text,
  p_authorization_fingerprint text,
  p_wallet text,
  p_issued_at timestamptz,
  p_expires_at timestamptz,
  p_display_name text,
  p_normalized_name text,
  p_avatar_id text,
  p_session_hash text,
  p_session_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_now timestamptz := pg_catalog.timezone('utc', pg_catalog.now());
  v_challenge public.adventurer_challenges%rowtype;
  v_profile public.adventurer_profiles%rowtype;
  v_session public.adventurer_sessions%rowtype;
  v_name_error text;
begin
  if p_challenge_hash is null or p_challenge_hash !~ '^[0-9a-f]{64}$'
    or p_authorization_fingerprint is null or p_authorization_fingerprint !~ '^[0-9a-f]{64}$'
    or p_wallet is null or p_issued_at is null or p_expires_at is null
    or p_session_hash is null or p_session_hash !~ '^[0-9a-f]{64}$'
    or p_session_expires_at is null
    or p_session_expires_at <= v_now
    or p_session_expires_at > v_now + pg_catalog.interval '30 days' then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'CHALLENGE_INVALID');
  end if;

  select * into v_challenge
  from public.adventurer_challenges
  where challenge_hash = p_challenge_hash
  for update;

  if not found or v_challenge.purpose <> 'CREATE' or v_challenge.consumed_at is not null then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'CHALLENGE_INVALID');
  end if;
  if v_now >= v_challenge.expires_at then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'CHALLENGE_EXPIRED');
  end if;
  if v_challenge.wallet is distinct from p_wallet
    or pg_catalog.date_trunc('milliseconds', v_challenge.issued_at) is distinct from pg_catalog.date_trunc('milliseconds', p_issued_at)
    or pg_catalog.date_trunc('milliseconds', v_challenge.expires_at) is distinct from pg_catalog.date_trunc('milliseconds', p_expires_at) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'CHALLENGE_INVALID');
  end if;

  v_name_error := public.adventurer_name_validation_error(p_display_name, p_normalized_name);
  if v_name_error = 'DISPLAY_NAME_RESERVED' then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'DISPLAY_NAME_RESERVED');
  end if;
  if v_name_error is not null then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'DISPLAY_NAME_INVALID');
  end if;
  if not public.adventurer_avatar_is_available(p_avatar_id) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'AVATAR_UNAVAILABLE');
  end if;

  if exists (select 1 from public.adventurer_profiles where wallet = p_wallet) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'PROFILE_ALREADY_EXISTS');
  end if;
  if exists (select 1 from public.adventurer_profiles where normalized_display_name = p_normalized_name) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'DISPLAY_NAME_TAKEN');
  end if;

  insert into public.adventurer_profiles (
    wallet, display_name, normalized_display_name, avatar_id,
    display_name_changed_at, created_at, updated_at
  ) values (
    p_wallet, p_display_name, p_normalized_name, p_avatar_id,
    v_now, v_now, v_now
  ) returning * into v_profile;

  insert into public.adventurer_sessions (
    session_hash, player_id, wallet, created_at, expires_at
  ) values (
    p_session_hash, v_profile.player_id, v_profile.wallet, v_now, p_session_expires_at
  ) returning * into v_session;

  update public.adventurer_challenges
  set consumed_at = v_now,
      authorization_fingerprint = p_authorization_fingerprint,
      player_id = v_profile.player_id
  where challenge_hash = p_challenge_hash;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'profile', public.adventurer_profile_json(v_profile),
    'session', public.adventurer_session_json(v_session)
  );
exception
  when unique_violation then
    if exists (select 1 from public.adventurer_profiles where wallet = p_wallet) then
      return pg_catalog.jsonb_build_object('ok', false, 'error', 'PROFILE_ALREADY_EXISTS');
    end if;
    if exists (select 1 from public.adventurer_profiles where normalized_display_name = p_normalized_name) then
      return pg_catalog.jsonb_build_object('ok', false, 'error', 'DISPLAY_NAME_TAKEN');
    end if;
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'CHALLENGE_INVALID');
end;
$$;

create or replace function public.consume_adventurer_session_challenge(
  p_challenge_hash text,
  p_authorization_fingerprint text,
  p_wallet text,
  p_issued_at timestamptz,
  p_expires_at timestamptz,
  p_session_hash text,
  p_session_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_now timestamptz := pg_catalog.timezone('utc', pg_catalog.now());
  v_challenge public.adventurer_challenges%rowtype;
  v_profile public.adventurer_profiles%rowtype;
  v_session public.adventurer_sessions%rowtype;
begin
  if p_challenge_hash is null or p_challenge_hash !~ '^[0-9a-f]{64}$'
    or p_authorization_fingerprint is null or p_authorization_fingerprint !~ '^[0-9a-f]{64}$'
    or p_wallet is null or p_issued_at is null or p_expires_at is null
    or p_session_hash is null or p_session_hash !~ '^[0-9a-f]{64}$'
    or p_session_expires_at is null
    or p_session_expires_at <= v_now
    or p_session_expires_at > v_now + pg_catalog.interval '30 days' then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'CHALLENGE_INVALID');
  end if;

  select * into v_challenge
  from public.adventurer_challenges
  where challenge_hash = p_challenge_hash
  for update;

  if not found or v_challenge.purpose <> 'SESSION' or v_challenge.consumed_at is not null then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'CHALLENGE_INVALID');
  end if;
  if v_now >= v_challenge.expires_at then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'CHALLENGE_EXPIRED');
  end if;
  if v_challenge.wallet is distinct from p_wallet
    or pg_catalog.date_trunc('milliseconds', v_challenge.issued_at) is distinct from pg_catalog.date_trunc('milliseconds', p_issued_at)
    or pg_catalog.date_trunc('milliseconds', v_challenge.expires_at) is distinct from pg_catalog.date_trunc('milliseconds', p_expires_at) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'CHALLENGE_INVALID');
  end if;

  select * into v_profile
  from public.adventurer_profiles
  where wallet = p_wallet
  for update;
  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'PROFILE_NOT_FOUND');
  end if;

  insert into public.adventurer_sessions (
    session_hash, player_id, wallet, created_at, expires_at
  ) values (
    p_session_hash, v_profile.player_id, v_profile.wallet, v_now, p_session_expires_at
  ) returning * into v_session;

  update public.adventurer_challenges
  set consumed_at = v_now,
      authorization_fingerprint = p_authorization_fingerprint,
      player_id = v_profile.player_id
  where challenge_hash = p_challenge_hash;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'profile', public.adventurer_profile_json(v_profile),
    'session', public.adventurer_session_json(v_session)
  );
exception
  when unique_violation then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'CHALLENGE_INVALID');
end;
$$;

create or replace function public.get_adventurer_session(p_session_hash text)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_session public.adventurer_sessions%rowtype;
begin
  if p_session_hash is null or p_session_hash !~ '^[0-9a-f]{64}$' then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'ADVENTURER_SESSION_INVALID');
  end if;
  select * into v_session
  from public.adventurer_sessions
  where session_hash = p_session_hash;
  if not found or v_session.revoked_at is not null or pg_catalog.timezone('utc', pg_catalog.now()) >= v_session.expires_at then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'ADVENTURER_SESSION_INVALID');
  end if;
  return pg_catalog.jsonb_build_object('ok', true, 'session', public.adventurer_session_json(v_session));
end;
$$;

create or replace function public.get_adventurer_profile_by_wallet(p_wallet text)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_profile public.adventurer_profiles%rowtype;
begin
  select * into v_profile from public.adventurer_profiles where wallet = p_wallet;
  if not found then return pg_catalog.jsonb_build_object('ok', false, 'error', 'PROFILE_NOT_FOUND'); end if;
  return pg_catalog.jsonb_build_object('ok', true, 'profile', public.adventurer_profile_json(v_profile));
end;
$$;

create or replace function public.get_adventurer_profile_by_player_id(p_player_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_profile public.adventurer_profiles%rowtype;
begin
  if p_player_id is null then return pg_catalog.jsonb_build_object('ok', false, 'error', 'PROFILE_NOT_FOUND'); end if;
  select * into v_profile from public.adventurer_profiles where player_id = p_player_id;
  if not found then return pg_catalog.jsonb_build_object('ok', false, 'error', 'PROFILE_NOT_FOUND'); end if;
  return pg_catalog.jsonb_build_object('ok', true, 'profile', public.adventurer_profile_json(v_profile));
end;
$$;

create or replace function public.check_adventurer_name_availability(p_normalized_name text)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_name_error text;
begin
  if p_normalized_name is null or p_normalized_name <> pg_catalog.lower(p_normalized_name) then
    return pg_catalog.jsonb_build_object('ok', true, 'available', false, 'normalized_name', null, 'error', 'DISPLAY_NAME_INVALID');
  end if;
  v_name_error := public.adventurer_name_validation_error(p_normalized_name, p_normalized_name);
  if v_name_error is not null then
    return pg_catalog.jsonb_build_object('ok', true, 'available', false, 'normalized_name', p_normalized_name, 'error', v_name_error);
  end if;
  return pg_catalog.jsonb_build_object(
    'ok', true,
    'available', not exists (select 1 from public.adventurer_profiles where normalized_display_name = p_normalized_name),
    'normalized_name', p_normalized_name,
    'error', case when exists (select 1 from public.adventurer_profiles where normalized_display_name = p_normalized_name) then 'DISPLAY_NAME_TAKEN' else null end
  );
end;
$$;

revoke all on function public.adventurer_name_validation_error(text, text) from public, anon, authenticated;
revoke all on function public.adventurer_avatar_is_available(text) from public, anon, authenticated;
revoke all on function public.reject_adventurer_profile_mutation() from public, anon, authenticated;
revoke all on function public.adventurer_profile_json(public.adventurer_profiles) from public, anon, authenticated;
revoke all on function public.adventurer_session_json(public.adventurer_sessions) from public, anon, authenticated;
revoke all on function public.create_adventurer_challenge(text, text, text) from public, anon, authenticated;
revoke all on function public.consume_create_adventurer_challenge(text, text, text, timestamptz, timestamptz, text, text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.consume_adventurer_session_challenge(text, text, text, timestamptz, timestamptz, text, timestamptz) from public, anon, authenticated;
revoke all on function public.get_adventurer_session(text) from public, anon, authenticated;
revoke all on function public.get_adventurer_profile_by_wallet(text) from public, anon, authenticated;
revoke all on function public.get_adventurer_profile_by_player_id(uuid) from public, anon, authenticated;
revoke all on function public.check_adventurer_name_availability(text) from public, anon, authenticated;

grant execute on function public.create_adventurer_challenge(text, text, text) to service_role;
grant execute on function public.consume_create_adventurer_challenge(text, text, text, timestamptz, timestamptz, text, text, text, text, timestamptz) to service_role;
grant execute on function public.consume_adventurer_session_challenge(text, text, text, timestamptz, timestamptz, text, timestamptz) to service_role;
grant execute on function public.get_adventurer_session(text) to service_role;
grant execute on function public.get_adventurer_profile_by_wallet(text) to service_role;
grant execute on function public.get_adventurer_profile_by_player_id(uuid) to service_role;
grant execute on function public.check_adventurer_name_availability(text) to service_role;

-- Wallet-scoped lifetime profile reads use the existing wallet column without
-- changing or migrating expedition/reward ownership.
create index if not exists expedition_runs_wallet_day_started_idx
  on public.expedition_runs (wallet, day_key, started_at);
