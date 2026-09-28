-- NimHunt P4 Allies + Safety.
-- Social identity is immutable adventurer_profiles.player_id only. Wallets,
-- display names, reward data, and expedition ownership are not relationship keys.

create table if not exists public.adventurer_ally_requests (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.adventurer_profiles (player_id) on delete cascade,
  receiver_id uuid not null references public.adventurer_profiles (player_id) on delete cascade,
  status text not null default 'PENDING' check (status in ('PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED')),
  created_at timestamptz not null default pg_catalog.timezone('utc', pg_catalog.now()),
  resolved_at timestamptz,
  check (sender_id <> receiver_id),
  check ((status = 'PENDING' and resolved_at is null) or (status <> 'PENDING' and resolved_at is not null))
);

create index if not exists adventurer_ally_requests_receiver_pending_idx
  on public.adventurer_ally_requests (receiver_id, created_at desc)
  where status = 'PENDING';
create index if not exists adventurer_ally_requests_sender_pending_idx
  on public.adventurer_ally_requests (sender_id, created_at desc)
  where status = 'PENDING';
-- One pending row for an unordered pair prevents crossed requests. The RPC
-- reports the direction-specific state to the current player.
create unique index if not exists adventurer_ally_requests_pending_pair_uidx
  on public.adventurer_ally_requests (
    pg_catalog.least(sender_id, receiver_id),
    pg_catalog.greatest(sender_id, receiver_id)
  ) where status = 'PENDING';

create table if not exists public.adventurer_allies (
  adventurer_a_id uuid not null references public.adventurer_profiles (player_id) on delete cascade,
  adventurer_b_id uuid not null references public.adventurer_profiles (player_id) on delete cascade,
  created_at timestamptz not null default pg_catalog.timezone('utc', pg_catalog.now()),
  primary key (adventurer_a_id, adventurer_b_id),
  check (adventurer_a_id <> adventurer_b_id),
  check (adventurer_a_id < adventurer_b_id)
);

create index if not exists adventurer_allies_a_lookup_idx
  on public.adventurer_allies (adventurer_a_id, created_at desc);
create index if not exists adventurer_allies_b_lookup_idx
  on public.adventurer_allies (adventurer_b_id, created_at desc);

create table if not exists public.adventurer_blocks (
  blocker_id uuid not null references public.adventurer_profiles (player_id) on delete cascade,
  blocked_id uuid not null references public.adventurer_profiles (player_id) on delete cascade,
  created_at timestamptz not null default pg_catalog.timezone('utc', pg_catalog.now()),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

create index if not exists adventurer_blocks_blocked_lookup_idx
  on public.adventurer_blocks (blocked_id, blocker_id);

alter table public.adventurer_ally_requests enable row level security;
alter table public.adventurer_ally_requests force row level security;
alter table public.adventurer_allies enable row level security;
alter table public.adventurer_allies force row level security;
alter table public.adventurer_blocks enable row level security;
alter table public.adventurer_blocks force row level security;

revoke all on table public.adventurer_ally_requests from public, anon, authenticated;
revoke all on table public.adventurer_allies from public, anon, authenticated;
revoke all on table public.adventurer_blocks from public, anon, authenticated;
grant all on table public.adventurer_ally_requests to service_role;
grant all on table public.adventurer_allies to service_role;
grant all on table public.adventurer_blocks to service_role;

create or replace function public.adventurer_social_profile_json(p_player_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select pg_catalog.jsonb_build_object(
    'player_id', player_id,
    'display_name', display_name,
    'avatar_id', avatar_id
  )
  from public.adventurer_profiles
  where player_id = p_player_id;
$$;

create or replace function public.get_adventurer_ally_count(p_player_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_count integer;
begin
  if not exists (select 1 from public.adventurer_profiles where player_id = p_player_id) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'SOCIAL_TARGET_UNAVAILABLE');
  end if;
  select count(*)::integer into v_count
  from public.adventurer_allies
  where adventurer_a_id = p_player_id or adventurer_b_id = p_player_id;
  return pg_catalog.jsonb_build_object('ok', true, 'ally_count', v_count);
end;
$$;

create or replace function public.get_adventurer_relationship(p_viewer_id uuid, p_target_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_state text := 'NONE';
  v_request_id uuid;
begin
  if p_viewer_id is null or p_target_id is null then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'SOCIAL_INVALID_PLAYER');
  end if;
  if p_viewer_id = p_target_id then
    return pg_catalog.jsonb_build_object('ok', true, 'state', 'SELF', 'request_id', null);
  end if;
  if not exists (select 1 from public.adventurer_profiles where player_id = p_target_id) then
    return pg_catalog.jsonb_build_object('ok', true, 'state', 'UNAVAILABLE', 'request_id', null);
  end if;
  -- A target's block is intentionally indistinguishable from any unavailable
  -- target. The viewer's own block is the only block state exposed.
  if exists (select 1 from public.adventurer_blocks where blocker_id = p_target_id and blocked_id = p_viewer_id) then
    return pg_catalog.jsonb_build_object('ok', true, 'state', 'UNAVAILABLE', 'request_id', null);
  end if;
  if exists (select 1 from public.adventurer_blocks where blocker_id = p_viewer_id and blocked_id = p_target_id) then
    return pg_catalog.jsonb_build_object('ok', true, 'state', 'BLOCKED_BY_ME', 'request_id', null);
  end if;
  if exists (
    select 1 from public.adventurer_allies
    where (adventurer_a_id = p_viewer_id and adventurer_b_id = p_target_id)
       or (adventurer_a_id = p_target_id and adventurer_b_id = p_viewer_id)
  ) then
    v_state := 'ALLY';
  else
    select id, case when sender_id = p_viewer_id then 'OUTGOING_PENDING' else 'INCOMING_PENDING' end
      into v_request_id, v_state
    from public.adventurer_ally_requests
    where status = 'PENDING'
      and ((sender_id = p_viewer_id and receiver_id = p_target_id)
        or (sender_id = p_target_id and receiver_id = p_viewer_id))
    order by created_at desc
    limit 1;
    if not found then
      v_state := 'NONE';
      v_request_id := null;
    end if;
  end if;
  return pg_catalog.jsonb_build_object('ok', true, 'state', v_state, 'request_id', v_request_id);
end;
$$;

create or replace function public.get_adventurer_social_overview(p_player_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_ally_count integer;
  v_incoming_count integer;
  v_outgoing_count integer;
  v_incoming jsonb;
  v_allies jsonb;
begin
  if not exists (select 1 from public.adventurer_profiles where player_id = p_player_id) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'SOCIAL_TARGET_UNAVAILABLE');
  end if;
  select count(*)::integer into v_ally_count
  from public.adventurer_allies
  where adventurer_a_id = p_player_id or adventurer_b_id = p_player_id;
  select count(*)::integer into v_incoming_count
  from public.adventurer_ally_requests
  where receiver_id = p_player_id and status = 'PENDING';
  select count(*)::integer into v_outgoing_count
  from public.adventurer_ally_requests
  where sender_id = p_player_id and status = 'PENDING';
  select coalesce(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'request_id', r.id,
      'player_id', p.player_id,
      'display_name', p.display_name,
      'avatar_id', p.avatar_id,
      'created_at', r.created_at
    ) order by r.created_at desc
  ), '[]'::jsonb) into v_incoming
  from public.adventurer_ally_requests r
  join public.adventurer_profiles p on p.player_id = r.sender_id
  where r.receiver_id = p_player_id and r.status = 'PENDING';
  select coalesce(pg_catalog.jsonb_agg(
    public.adventurer_social_profile_json(
      case when a.adventurer_a_id = p_player_id then a.adventurer_b_id else a.adventurer_a_id end
    ) order by a.created_at desc
  ), '[]'::jsonb) into v_allies
  from public.adventurer_allies a
  where a.adventurer_a_id = p_player_id or a.adventurer_b_id = p_player_id;
  return pg_catalog.jsonb_build_object(
    'ok', true,
    'ally_count', v_ally_count,
    'incoming_pending_count', v_incoming_count,
    'outgoing_pending_count', v_outgoing_count,
    'incoming_requests', v_incoming,
    'allies', v_allies
  );
end;
$$;

create or replace function public.adventurer_social_request(p_sender_id uuid, p_receiver_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_request_id uuid;
  v_existing_sender uuid;
  v_outgoing integer;
  v_incoming integer;
begin
  if p_sender_id is null or p_receiver_id is null or p_sender_id = p_receiver_id then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'SOCIAL_SELF_ACTION');
  end if;
  if not exists (select 1 from public.adventurer_profiles where player_id = p_sender_id)
    or not exists (select 1 from public.adventurer_profiles where player_id = p_receiver_id) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'SOCIAL_TARGET_UNAVAILABLE');
  end if;
  -- Every mutating operation locks both profile rows in deterministic order.
  -- This serializes cap checks and opposite-direction actions for a pair.
  perform 1
  from public.adventurer_profiles
  where player_id in (p_sender_id, p_receiver_id)
  order by player_id
  for update;
  if exists (select 1 from public.adventurer_blocks where blocker_id = p_sender_id and blocked_id = p_receiver_id)
    or exists (select 1 from public.adventurer_blocks where blocker_id = p_receiver_id and blocked_id = p_sender_id) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'SOCIAL_TARGET_UNAVAILABLE');
  end if;
  if exists (
    select 1 from public.adventurer_allies
    where (adventurer_a_id = p_sender_id and adventurer_b_id = p_receiver_id)
       or (adventurer_a_id = p_receiver_id and adventurer_b_id = p_sender_id)
  ) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'SOCIAL_ALREADY_ALLY');
  end if;
  select id, sender_id into v_request_id, v_existing_sender
  from public.adventurer_ally_requests
  where status = 'PENDING'
    and ((sender_id = p_sender_id and receiver_id = p_receiver_id)
      or (sender_id = p_receiver_id and receiver_id = p_sender_id))
  order by created_at desc
  limit 1;
  if v_request_id is not null then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'error', case when v_existing_sender = p_sender_id then 'SOCIAL_REQUEST_PENDING' else 'SOCIAL_INCOMING_REQUEST_EXISTS' end
    );
  end if;
  select count(*)::integer into v_outgoing
  from public.adventurer_ally_requests
  where sender_id = p_sender_id and status = 'PENDING';
  if v_outgoing >= 25 then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'SOCIAL_OUTGOING_CAP_REACHED');
  end if;
  select count(*)::integer into v_incoming
  from public.adventurer_ally_requests
  where receiver_id = p_receiver_id and status = 'PENDING';
  if v_incoming >= 25 then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'SOCIAL_INCOMING_CAP_REACHED');
  end if;
  insert into public.adventurer_ally_requests (sender_id, receiver_id)
  values (p_sender_id, p_receiver_id)
  returning id into v_request_id;
  return pg_catalog.jsonb_build_object('ok', true, 'request_id', v_request_id);
end;
$$;

create or replace function public.adventurer_social_accept(p_receiver_id uuid, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_request public.adventurer_ally_requests%rowtype;
  v_ally_count_a integer;
  v_ally_count_b integer;
  v_a uuid;
  v_b uuid;
begin
  -- Read without locking to learn the pair, lock both profiles in the same
  -- order as request/block/remove, then lock and re-read the request.
  select * into v_request from public.adventurer_ally_requests where id = p_request_id;
  if not found then return pg_catalog.jsonb_build_object('ok', false, 'error', 'SOCIAL_REQUEST_NOT_FOUND'); end if;
  perform 1
  from public.adventurer_profiles
  where player_id in (v_request.sender_id, v_request.receiver_id)
  order by player_id
  for update;
  select * into v_request from public.adventurer_ally_requests where id = p_request_id for update;
  if not found or v_request.status <> 'PENDING' then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'SOCIAL_REQUEST_STALE');
  end if;
  if v_request.receiver_id <> p_receiver_id then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'SOCIAL_UNAUTHORIZED_ACTION');
  end if;
  if exists (select 1 from public.adventurer_blocks where blocker_id = v_request.sender_id and blocked_id = v_request.receiver_id)
    or exists (select 1 from public.adventurer_blocks where blocker_id = v_request.receiver_id and blocked_id = v_request.sender_id) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'SOCIAL_TARGET_UNAVAILABLE');
  end if;
  select count(*)::integer into v_ally_count_a from public.adventurer_allies where adventurer_a_id = v_request.sender_id or adventurer_b_id = v_request.sender_id;
  select count(*)::integer into v_ally_count_b from public.adventurer_allies where adventurer_a_id = v_request.receiver_id or adventurer_b_id = v_request.receiver_id;
  if v_ally_count_a >= 100 or v_ally_count_b >= 100 then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'SOCIAL_ALLY_CAP_REACHED');
  end if;
  if v_request.sender_id < v_request.receiver_id then v_a := v_request.sender_id; v_b := v_request.receiver_id;
  else v_a := v_request.receiver_id; v_b := v_request.sender_id;
  end if;
  insert into public.adventurer_allies (adventurer_a_id, adventurer_b_id)
  values (v_a, v_b)
  on conflict (adventurer_a_id, adventurer_b_id) do nothing;
  update public.adventurer_ally_requests
  set status = 'ACCEPTED', resolved_at = pg_catalog.timezone('utc', pg_catalog.now())
  where id = p_request_id and status = 'PENDING';
  return pg_catalog.jsonb_build_object('ok', true);
end;
$$;

create or replace function public.adventurer_social_decline(p_receiver_id uuid, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_request public.adventurer_ally_requests%rowtype;
begin
  select * into v_request from public.adventurer_ally_requests where id = p_request_id for update;
  if not found or v_request.status <> 'PENDING' then return pg_catalog.jsonb_build_object('ok', false, 'error', 'SOCIAL_REQUEST_STALE'); end if;
  if v_request.receiver_id <> p_receiver_id then return pg_catalog.jsonb_build_object('ok', false, 'error', 'SOCIAL_UNAUTHORIZED_ACTION'); end if;
  update public.adventurer_ally_requests set status = 'DECLINED', resolved_at = pg_catalog.timezone('utc', pg_catalog.now()) where id = p_request_id;
  return pg_catalog.jsonb_build_object('ok', true);
end;
$$;

create or replace function public.adventurer_social_cancel(p_sender_id uuid, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_request public.adventurer_ally_requests%rowtype;
begin
  select * into v_request from public.adventurer_ally_requests where id = p_request_id for update;
  if not found or v_request.status <> 'PENDING' then return pg_catalog.jsonb_build_object('ok', false, 'error', 'SOCIAL_REQUEST_STALE'); end if;
  if v_request.sender_id <> p_sender_id then return pg_catalog.jsonb_build_object('ok', false, 'error', 'SOCIAL_UNAUTHORIZED_ACTION'); end if;
  update public.adventurer_ally_requests set status = 'CANCELLED', resolved_at = pg_catalog.timezone('utc', pg_catalog.now()) where id = p_request_id;
  return pg_catalog.jsonb_build_object('ok', true);
end;
$$;

create or replace function public.adventurer_social_remove(p_player_id uuid, p_other_player_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_deleted integer;
begin
  if p_player_id is null or p_other_player_id is null or p_player_id = p_other_player_id then return pg_catalog.jsonb_build_object('ok', false, 'error', 'SOCIAL_SELF_ACTION'); end if;
  perform 1 from public.adventurer_profiles where player_id in (p_player_id, p_other_player_id) order by player_id for update;
  delete from public.adventurer_allies
  where (adventurer_a_id = p_player_id and adventurer_b_id = p_other_player_id)
     or (adventurer_a_id = p_other_player_id and adventurer_b_id = p_player_id);
  get diagnostics v_deleted = row_count;
  if v_deleted = 0 then return pg_catalog.jsonb_build_object('ok', false, 'error', 'SOCIAL_NOT_ALLY'); end if;
  return pg_catalog.jsonb_build_object('ok', true);
end;
$$;

create or replace function public.adventurer_social_block(p_blocker_id uuid, p_blocked_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if p_blocker_id is null or p_blocked_id is null or p_blocker_id = p_blocked_id then return pg_catalog.jsonb_build_object('ok', false, 'error', 'SOCIAL_SELF_ACTION'); end if;
  if not exists (select 1 from public.adventurer_profiles where player_id = p_blocked_id) then return pg_catalog.jsonb_build_object('ok', false, 'error', 'SOCIAL_TARGET_UNAVAILABLE'); end if;
  perform 1 from public.adventurer_profiles where player_id in (p_blocker_id, p_blocked_id) order by player_id for update;
  delete from public.adventurer_allies
  where (adventurer_a_id = p_blocker_id and adventurer_b_id = p_blocked_id)
     or (adventurer_a_id = p_blocked_id and adventurer_b_id = p_blocker_id);
  update public.adventurer_ally_requests
  set status = 'CANCELLED', resolved_at = pg_catalog.timezone('utc', pg_catalog.now())
  where status = 'PENDING'
    and ((sender_id = p_blocker_id and receiver_id = p_blocked_id)
      or (sender_id = p_blocked_id and receiver_id = p_blocker_id));
  insert into public.adventurer_blocks (blocker_id, blocked_id)
  values (p_blocker_id, p_blocked_id)
  on conflict (blocker_id, blocked_id) do nothing;
  return pg_catalog.jsonb_build_object('ok', true);
end;
$$;

create or replace function public.adventurer_social_unblock(p_blocker_id uuid, p_blocked_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_deleted integer;
begin
  delete from public.adventurer_blocks where blocker_id = p_blocker_id and blocked_id = p_blocked_id;
  get diagnostics v_deleted = row_count;
  if v_deleted = 0 then return pg_catalog.jsonb_build_object('ok', false, 'error', 'SOCIAL_NOT_BLOCKER'); end if;
  return pg_catalog.jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.adventurer_social_profile_json(uuid) from public, anon, authenticated;
revoke all on function public.get_adventurer_ally_count(uuid) from public, anon, authenticated;
revoke all on function public.get_adventurer_relationship(uuid, uuid) from public, anon, authenticated;
revoke all on function public.get_adventurer_social_overview(uuid) from public, anon, authenticated;
revoke all on function public.adventurer_social_request(uuid, uuid) from public, anon, authenticated;
revoke all on function public.adventurer_social_accept(uuid, uuid) from public, anon, authenticated;
revoke all on function public.adventurer_social_decline(uuid, uuid) from public, anon, authenticated;
revoke all on function public.adventurer_social_cancel(uuid, uuid) from public, anon, authenticated;
revoke all on function public.adventurer_social_remove(uuid, uuid) from public, anon, authenticated;
revoke all on function public.adventurer_social_block(uuid, uuid) from public, anon, authenticated;
revoke all on function public.adventurer_social_unblock(uuid, uuid) from public, anon, authenticated;
grant execute on function public.adventurer_social_profile_json(uuid) to service_role;
grant execute on function public.get_adventurer_ally_count(uuid) to service_role;
grant execute on function public.get_adventurer_relationship(uuid, uuid) to service_role;
grant execute on function public.get_adventurer_social_overview(uuid) to service_role;
grant execute on function public.adventurer_social_request(uuid, uuid) to service_role;
grant execute on function public.adventurer_social_accept(uuid, uuid) to service_role;
grant execute on function public.adventurer_social_decline(uuid, uuid) to service_role;
grant execute on function public.adventurer_social_cancel(uuid, uuid) to service_role;
grant execute on function public.adventurer_social_remove(uuid, uuid) to service_role;
grant execute on function public.adventurer_social_block(uuid, uuid) to service_role;
grant execute on function public.adventurer_social_unblock(uuid, uuid) to service_role;
