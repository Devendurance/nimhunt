-- NimHunt P5 Adventurer rename + private blocked-list read path.
-- Additive only: proof, reward, claim, payout, scheduler, treasury, and social
-- relationship semantics remain unchanged. Apply only after local verification.

create or replace function public.create_adventurer_rename_challenge(
  p_player_id uuid,
  p_wallet text,
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
  if p_player_id is null
    or p_wallet is null or pg_catalog.char_length(p_wallet) = 0 or pg_catalog.char_length(p_wallet) > 80
    or p_challenge_hash is null or p_challenge_hash !~ '^[0-9a-f]{64}$' then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'CHALLENGE_INVALID');
  end if;

  select * into v_profile
  from public.adventurer_profiles
  where player_id = p_player_id and wallet = p_wallet
  for update;
  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'ADVENTURER_SESSION_INVALID');
  end if;

  insert into public.adventurer_challenges (
    challenge_hash, purpose, wallet, player_id, issued_at, expires_at
  ) values (
    p_challenge_hash, 'RENAME', p_wallet, p_player_id, v_now, v_expires_at
  );

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'wallet', p_wallet,
    'player_id', p_player_id,
    'issued_at', v_now,
    'expires_at', v_expires_at
  );
exception
  when unique_violation then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'CHALLENGE_INVALID');
end;
$$;

create or replace function public.consume_adventurer_rename_challenge(
  p_challenge_hash text,
  p_authorization_fingerprint text,
  p_player_id uuid,
  p_wallet text,
  p_issued_at timestamptz,
  p_expires_at timestamptz,
  p_current_name text,
  p_new_name text,
  p_normalized_name text
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
  v_name_error text;
begin
  if p_challenge_hash is null or p_challenge_hash !~ '^[0-9a-f]{64}$'
    or p_authorization_fingerprint is null or p_authorization_fingerprint !~ '^[0-9a-f]{64}$'
    or p_player_id is null
    or p_wallet is null or p_issued_at is null or p_expires_at is null
    or p_current_name is null or p_new_name is null or p_normalized_name is null then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'CHALLENGE_INVALID');
  end if;

  select * into v_challenge
  from public.adventurer_challenges
  where challenge_hash = p_challenge_hash
  for update;
  if not found or v_challenge.purpose <> 'RENAME' or v_challenge.consumed_at is not null then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'CHALLENGE_INVALID');
  end if;
  if v_now >= v_challenge.expires_at then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'CHALLENGE_EXPIRED');
  end if;
  if v_challenge.wallet is distinct from p_wallet
    or v_challenge.player_id is distinct from p_player_id
    or pg_catalog.date_trunc('milliseconds', v_challenge.issued_at) is distinct from pg_catalog.date_trunc('milliseconds', p_issued_at)
    or pg_catalog.date_trunc('milliseconds', v_challenge.expires_at) is distinct from pg_catalog.date_trunc('milliseconds', p_expires_at) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'CHALLENGE_INVALID');
  end if;

  select * into v_profile
  from public.adventurer_profiles
  where player_id = p_player_id
  for update;
  if not found or v_profile.wallet is distinct from p_wallet then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'ADVENTURER_SESSION_INVALID');
  end if;
  if v_profile.display_name is distinct from p_current_name then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'DISPLAY_NAME_INVALID');
  end if;

  v_name_error := public.adventurer_name_validation_error(p_new_name, p_normalized_name);
  if v_name_error = 'DISPLAY_NAME_RESERVED' then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'DISPLAY_NAME_RESERVED');
  end if;
  if v_name_error is not null then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'DISPLAY_NAME_INVALID');
  end if;
  if p_normalized_name = v_profile.normalized_display_name then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'DISPLAY_NAME_INVALID');
  end if;
  if v_now < v_profile.display_name_changed_at + pg_catalog.interval '30 days' then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'DISPLAY_NAME_COOLDOWN');
  end if;
  if exists (
    select 1 from public.adventurer_profiles
    where normalized_display_name = p_normalized_name
  ) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'DISPLAY_NAME_TAKEN');
  end if;

  update public.adventurer_profiles
  set display_name = p_new_name
  where player_id = p_player_id
  returning * into v_profile;

  update public.adventurer_challenges
  set consumed_at = v_now,
      authorization_fingerprint = p_authorization_fingerprint
  where challenge_hash = p_challenge_hash;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'profile', public.adventurer_profile_json(v_profile)
  );
exception
  when unique_violation then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'DISPLAY_NAME_TAKEN');
end;
$$;

-- This RPC is reachable only through the authenticated Adventurer service. The
-- service supplies the session's player_id, so it never becomes a public block
-- directory or a block-source disclosure.
create or replace function public.get_adventurer_blocked_profiles(p_blocker_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_blocked jsonb;
begin
  if p_blocker_id is null then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'SOCIAL_INVALID_PLAYER');
  end if;
  if not exists (select 1 from public.adventurer_profiles where player_id = p_blocker_id) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'SOCIAL_TARGET_UNAVAILABLE');
  end if;

  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'player_id', p.player_id,
        'display_name', p.display_name,
        'avatar_id', p.avatar_id,
        'blocked_at', b.created_at
      ) order by b.created_at desc
    ),
    '[]'::jsonb
  ) into v_blocked
  from public.adventurer_blocks b
  join public.adventurer_profiles p on p.player_id = b.blocked_id
  where b.blocker_id = p_blocker_id;

  return pg_catalog.jsonb_build_object('ok', true, 'blocked', v_blocked);
end;
$$;

revoke all on function public.create_adventurer_rename_challenge(uuid, text, text) from public, anon, authenticated;
revoke all on function public.consume_adventurer_rename_challenge(text, text, uuid, text, timestamptz, timestamptz, text, text, text) from public, anon, authenticated;
revoke all on function public.get_adventurer_blocked_profiles(uuid) from public, anon, authenticated;
grant execute on function public.create_adventurer_rename_challenge(uuid, text, text) to service_role;
grant execute on function public.consume_adventurer_rename_challenge(text, text, uuid, text, timestamptz, timestamptz, text, text, text) to service_role;
grant execute on function public.get_adventurer_blocked_profiles(uuid) to service_role;
