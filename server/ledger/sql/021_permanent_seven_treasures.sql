-- Permanent scarcity cutover. Apply once in the approved SQL workflow.
-- Existing pool/claim rows are never rewritten. Activation is next UTC midnight;
-- deploy the app with NIMHUNT_PERMANENT_REWARDS_STARTS_AT matching the SELECT below.
begin;
create table if not exists public.permanent_reward_policy (
 singleton boolean primary key default true check(singleton),
 starts_at timestamptz not null check(starts_at = date_trunc('day', starts_at at time zone 'UTC') at time zone 'UTC')
);
alter table public.permanent_reward_policy enable row level security;
revoke all on public.permanent_reward_policy from public, anon, authenticated;
insert into public.permanent_reward_policy(singleton, starts_at)
values(true, public.next_utc_reset_at((now() at time zone 'UTC')::date)) on conflict do nothing;
grant select on public.permanent_reward_policy to service_role;
alter table public.daily_reward_pools drop constraint if exists daily_reward_pools_total_slots_check;
alter table public.daily_reward_pools drop constraint if exists daily_reward_pools_reserved_slots_check;
alter table public.daily_reward_pools alter column total_slots set default 7;
alter table public.daily_reward_pools add constraint daily_reward_pools_total_slots_check check(total_slots in (7,69));
alter table public.daily_reward_pools add constraint daily_reward_pools_reserved_slots_check check(reserved_slots>=0 and reserved_slots<=total_slots);
create or replace function public.reward_slots_for_day(p_day date) returns integer language sql stable security definer set search_path=pg_catalog,public as $$
 select case when p_day >= (select starts_at at time zone 'UTC' from public.permanent_reward_policy where singleton)::date then 7 else 69 end;
$$;
revoke all on function public.reward_slots_for_day(date) from public,anon,authenticated;
grant execute on function public.reward_slots_for_day(date) to service_role;
create or replace function public.assign_reward_pool_policy() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin new.total_slots:=public.reward_slots_for_day(new.day_key);return new;end;
$$;
revoke all on function public.assign_reward_pool_policy() from public,anon,authenticated;
create trigger reward_pool_policy before insert on public.daily_reward_pools for each row execute function public.assign_reward_pool_policy();
create or replace function public.preserve_reward_pool_policy() returns trigger language plpgsql set search_path=pg_catalog,public as $$
begin
 if new.total_slots is distinct from old.total_slots or new.day_key is distinct from old.day_key then
  raise exception 'REWARD_POOL_POLICY_IMMUTABLE';
 end if;
 return new;
end;
$$;
revoke all on function public.preserve_reward_pool_policy() from public,anon,authenticated;
create trigger preserve_reward_pool_policy before update on public.daily_reward_pools for each row execute function public.preserve_reward_pool_policy();
alter table public.reward_claims add column if not exists reservation_number integer check(reservation_number is null or reservation_number>0);
create or replace function public.preserve_reward_reservation_number() returns trigger language plpgsql set search_path=pg_catalog,public as $$
begin
 if new.reservation_number is distinct from old.reservation_number and not
  (old.reservation_number is null and old.status='PREPARED' and new.status='RESERVED') then
  raise exception 'PROOF_LOST';
 end if;
 return new;
end;
$$;
revoke all on function public.preserve_reward_reservation_number() from public,anon,authenticated;
create trigger preserve_reservation_number before update on public.reward_claims for each row execute function public.preserve_reward_reservation_number();
create or replace function public.freeze_prepared_reward_amount() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_total integer;
begin
 select total_slots into v_total from public.daily_reward_pools where day_key=new.day_key;
 if public.reward_slots_for_day(new.day_key)=7 then
  if v_total is distinct from 7 then raise exception 'REWARD_UNAVAILABLE';end if;
  new.reward_amount_luna:=100000000;
 end if;
 return new;
end;
$$;
revoke all on function public.freeze_prepared_reward_amount() from public,anon,authenticated;
create trigger freeze_prepared_amount before insert on public.reward_claims for each row execute function public.freeze_prepared_reward_amount();

create or replace function public.claim_json(p_claim public.reward_claims, p_reserved integer, p_total integer)
returns jsonb
language sql
stable
as $$
  select pg_catalog.jsonb_build_object(
    'claim_id', p_claim.claim_id,
    'run_id', p_claim.run_id,
    'wallet', p_claim.wallet,
    'mission', p_claim.mission,
    'day_key', p_claim.day_key,
    'canonical_payload', p_claim.canonical_payload,
    'claim_payload_hash', p_claim.claim_payload_hash,
    'status', p_claim.status,
    'public_key', p_claim.public_key,
    'signature', p_claim.signature,
    'created_at', p_claim.created_at,
    'expires_at', p_claim.expires_at,
    'finalized_at', p_claim.finalized_at,
    'reward_amount_luna', p_claim.reward_amount_luna::text,
    'reservation_number', case when p_claim.status = 'RESERVED' then coalesce(p_claim.reservation_number,p_reserved) else null end,
    'remaining_slots', greatest(coalesce((select total_slots from public.daily_reward_pools where day_key=p_claim.day_key),p_total) - coalesce(p_reserved, 0), 0),
    'total_slots', coalesce((select total_slots from public.daily_reward_pools where day_key=p_claim.day_key),p_total)
  );
$$;

create or replace function get_daily_hunt_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_total integer;
  v_day date := (timezone('utc', now()))::date;
  v_reserved integer := 0;
begin
  select reserved_slots into v_reserved
  from public.daily_reward_pools
  where day_key = v_day;

  if v_reserved is null then
    v_reserved := 0;
  end if;

  select total_slots into v_total from public.daily_reward_pools where day_key=v_day;
  v_total:=coalesce(v_total,public.reward_slots_for_day(v_day));
  return jsonb_build_object(
    'ok', true,
    'total_slots', v_total,
    'reserved_slots', v_reserved,
    'remaining_slots', v_total - v_reserved,
    'day_key', v_day,
    'next_reset_at', public.next_utc_reset_at(v_day)
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
  v_total integer;
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

   select total_slots into v_total from public.daily_reward_pools where day_key=v_run.day_key;
  update public.daily_reward_pools
  set reserved_slots = reserved_slots + 1
  where day_key = v_run.day_key
    and reserved_slots < total_slots
  returning reserved_slots into v_number;

  if v_number is null then
     update public.expedition_runs
    set reward_status = 'SOLD_OUT'
    where id = p_run_id;
    return jsonb_build_object(
      'ok', false,
      'error', 'SOLD_OUT',
      'remaining_slots', 0,
      'total_slots', v_total
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
    'remaining_slots', v_total - v_number,
    'total_slots', v_total
  );
end;
$$;

create or replace function public.prepare_reward_claim(
  p_run_id uuid,
  p_run_session_hash text,
  p_wallet text,
  p_mission text,
  p_day_key date,
  p_claim_id uuid,
  p_canonical_payload text,
  p_claim_payload_hash text,
  p_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_total integer;
  v_now timestamptz := pg_catalog.timezone('utc', pg_catalog.now());
  v_session public.run_sessions%rowtype;
  v_run public.expedition_runs%rowtype;
  v_claim public.reward_claims%rowtype;
  v_reserved integer := 0;
  v_wallet_reserved integer := 0;
  v_expires timestamptz;
  v_status public.reward_claim_status;
begin
  if p_run_id is null or p_claim_id is null then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'MALFORMED_REQUEST');
  end if;
  if p_wallet is null or pg_catalog.char_length(p_wallet) = 0 or pg_catalog.char_length(p_wallet) > 80 then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'INVALID_WALLET');
  end if;
  if p_mission is null or p_mission not in ('gem-runner', 'chest-hunter', 'vault-breaker') then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'CLAIM_MISMATCH');
  end if;
  if p_canonical_payload is null or pg_catalog.char_length(p_canonical_payload) = 0 or pg_catalog.char_length(p_canonical_payload) > 4096 then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'CLAIM_MISMATCH');
  end if;
  if p_claim_payload_hash is null or p_claim_payload_hash !~ '^[0-9a-f]{64}$' then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'CLAIM_MISMATCH');
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

  if not found or v_run.wallet <> v_session.wallet or v_run.wallet <> p_wallet then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'WALLET_MISMATCH');
  end if;
  if v_run.mission_type <> p_mission or v_run.day_key <> p_day_key then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'CLAIM_MISMATCH');
  end if;

  v_expires := public.next_utc_reset_at(v_run.day_key);
  if p_expires_at is not null and p_expires_at is distinct from v_expires then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'CLAIM_MISMATCH');
  end if;
  if v_now >= v_expires then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'CLAIM_WINDOW_EXPIRED');
  end if;

  insert into public.daily_reward_pools (day_key) values (v_run.day_key)
  on conflict (day_key) do nothing;
  insert into public.daily_wallet_state (day_key, wallet)
  values (v_run.day_key, v_run.wallet)
  on conflict (day_key, wallet) do nothing;

  perform 1 from public.daily_reward_pools where day_key = v_run.day_key for update;

  select rewards_reserved into v_wallet_reserved
  from public.daily_wallet_state
  where day_key = v_run.day_key and wallet = v_run.wallet
  for update;
  v_wallet_reserved := coalesce(v_wallet_reserved, 0);

  select total_slots into v_total from public.daily_reward_pools where day_key=v_run.day_key;

  select reserved_slots into v_reserved
  from public.daily_reward_pools
  where day_key = v_run.day_key;
  v_reserved := coalesce(v_reserved, 0);

  select * into v_claim
  from public.reward_claims
  where run_id = p_run_id
  for update;

  if found then
    if v_claim.status = 'PREPARED' and v_now >= v_claim.expires_at then
      update public.reward_claims
      set status = 'EXPIRED'
      where claim_id = v_claim.claim_id
      returning * into v_claim;
      return pg_catalog.jsonb_build_object('ok', false, 'error', 'CLAIM_WINDOW_EXPIRED');
    end if;
    return pg_catalog.jsonb_build_object(
      'ok', true,
      'outcome', v_claim.status::text,
      'existing', true,
      'claim', public.claim_json(v_claim, v_reserved, v_total)
    );
  end if;

  if v_wallet_reserved >= 1 then
    v_status := 'ALREADY_REWARDED';
  elsif v_reserved >= v_total then
    v_status := 'SOLD_OUT';
  else
    v_status := 'PREPARED';
  end if;

  begin
    insert into public.reward_claims (
      claim_id,
      run_id,
      wallet,
      mission,
      day_key,
      canonical_payload,
      claim_payload_hash,
      status,
      public_key,
      signature,
      created_at,
      expires_at,
      finalized_at
    ) values (
      p_claim_id,
      p_run_id,
      v_run.wallet,
      v_run.mission_type,
      v_run.day_key,
      p_canonical_payload,
      p_claim_payload_hash,
      v_status,
      null,
      null,
      v_now,
      v_expires,
      case when v_status = 'PREPARED' then null else v_now end
    ) returning * into v_claim;
  exception
    when unique_violation then
      select * into v_claim from public.reward_claims where run_id = p_run_id;
      if not found then
        return pg_catalog.jsonb_build_object('ok', false, 'error', 'CLAIM_NOT_FOUND');
      end if;
      return pg_catalog.jsonb_build_object(
        'ok', true,
        'outcome', v_claim.status::text,
        'existing', true,
        'claim', public.claim_json(v_claim, v_reserved, v_total)
      );
  end;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'outcome', v_claim.status::text,
    'existing', false,
    'claim', public.claim_json(v_claim, v_reserved, v_total)
  );
end;
$$;

create or replace function public.finalize_reward_claim(
  p_claim_id uuid,
  p_run_id uuid,
  p_run_session_hash text,
  p_wallet text,
  p_canonical_payload text,
  p_claim_payload_hash text,
  p_public_key text,
  p_signature text,
  p_reward_amount_luna bigint
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_total integer;
  v_now timestamptz := pg_catalog.timezone('utc', pg_catalog.now());
  v_session public.run_sessions%rowtype;
  v_run public.expedition_runs%rowtype;
  v_claim public.reward_claims%rowtype;
  v_reserved integer := 0;
  v_wallet_reserved integer := 0;
  v_number integer;
begin
  if p_claim_id is null or p_run_id is null then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'MALFORMED_REQUEST');
  end if;
  if p_wallet is null or pg_catalog.char_length(p_wallet) = 0 or pg_catalog.char_length(p_wallet) > 80 then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'INVALID_WALLET');
  end if;
  if p_canonical_payload is null or pg_catalog.char_length(p_canonical_payload) = 0 or pg_catalog.char_length(p_canonical_payload) > 4096 then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'CLAIM_MISMATCH');
  end if;
  if p_claim_payload_hash is null or p_claim_payload_hash !~ '^[0-9a-f]{64}$' then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'CLAIM_MISMATCH');
  end if;
  if p_public_key is null or pg_catalog.char_length(p_public_key) = 0 or pg_catalog.char_length(p_public_key) > 130 then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'INVALID_SIGNATURE');
  end if;
  if p_signature is null or pg_catalog.char_length(p_signature) = 0 or pg_catalog.char_length(p_signature) > 258 then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'INVALID_SIGNATURE');
  end if;
  if p_reward_amount_luna is null or p_reward_amount_luna <= 0 then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'REWARD_UNAVAILABLE');
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

  if not found or v_run.wallet <> v_session.wallet or v_run.wallet <> p_wallet then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'WALLET_MISMATCH');
  end if;

  insert into public.daily_reward_pools (day_key) values (v_run.day_key)
  on conflict (day_key) do nothing;
  insert into public.daily_wallet_state (day_key, wallet)
  values (v_run.day_key, v_run.wallet)
  on conflict (day_key, wallet) do nothing;

  perform 1
  from public.daily_reward_pools
  where day_key = v_run.day_key
  for update;

  select rewards_reserved into v_wallet_reserved
  from public.daily_wallet_state
  where day_key = v_run.day_key and wallet = v_run.wallet
  for update;
  v_wallet_reserved := coalesce(v_wallet_reserved, 0);

  select * into v_claim
  from public.reward_claims
  where claim_id = p_claim_id
  for update;

  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'CLAIM_NOT_FOUND');
  end if;
  if v_claim.run_id <> p_run_id or v_claim.wallet <> v_run.wallet then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'CLAIM_MISMATCH');
  end if;

  select total_slots into v_total from public.daily_reward_pools where day_key=v_run.day_key;

  select reserved_slots into v_reserved
  from public.daily_reward_pools
  where day_key = v_claim.day_key;
  v_reserved := coalesce(v_reserved, 0);

  if v_claim.status in ('RESERVED', 'SOLD_OUT', 'ALREADY_REWARDED') then
    if v_claim.canonical_payload is distinct from p_canonical_payload
      or v_claim.claim_payload_hash is distinct from p_claim_payload_hash then
      return pg_catalog.jsonb_build_object('ok', false, 'error', 'CLAIM_MISMATCH');
    end if;
    return pg_catalog.jsonb_build_object(
      'ok', true,
      'outcome', v_claim.status::text,
      'existing', true,
      'claim', public.claim_json(v_claim, v_reserved, v_total)
    );
  end if;

  if (v_claim.reward_amount_luna is not null and v_claim.reward_amount_luna <> p_reward_amount_luna)
    or (public.reward_slots_for_day(v_claim.day_key)=7 and (v_total<>7 or p_reward_amount_luna<>100000000)) then
    return pg_catalog.jsonb_build_object('ok',false,'error','REWARD_UNAVAILABLE');
  end if;

  if v_claim.status = 'EXPIRED' or v_now >= v_claim.expires_at then
    if v_claim.status <> 'EXPIRED' then
      update public.reward_claims
      set status = 'EXPIRED'
      where claim_id = v_claim.claim_id
      returning * into v_claim;
    end if;
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'CLAIM_WINDOW_EXPIRED');
  end if;

  if v_claim.status <> 'PREPARED' then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'CLAIM_NOT_ELIGIBLE');
  end if;
  if v_claim.canonical_payload is distinct from p_canonical_payload
    or v_claim.claim_payload_hash is distinct from p_claim_payload_hash then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'CLAIM_MISMATCH');
  end if;

  if v_wallet_reserved >= 1 then
    update public.reward_claims
    set status = 'ALREADY_REWARDED',
        public_key = p_public_key,
        signature = p_signature,
        finalized_at = v_now
    where claim_id = v_claim.claim_id
    returning * into v_claim;
    return pg_catalog.jsonb_build_object(
      'ok', true,
      'outcome', 'ALREADY_REWARDED',
      'existing', false,
      'claim', public.claim_json(v_claim, v_reserved, v_total)
    );
  end if;

  update public.daily_reward_pools
  set reserved_slots = reserved_slots + 1
  where day_key = v_claim.day_key
    and reserved_slots < total_slots
  returning reserved_slots into v_number;

  if v_number is null then
    update public.reward_claims
    set status = 'SOLD_OUT',
        public_key = p_public_key,
        signature = p_signature,
        finalized_at = v_now
    where claim_id = v_claim.claim_id
    returning * into v_claim;
    return pg_catalog.jsonb_build_object(
      'ok', true,
      'outcome', 'SOLD_OUT',
      'existing', false,
      'claim', public.claim_json(v_claim, v_reserved, v_total)
    );
  end if;

  update public.daily_wallet_state
  set rewards_reserved = 1
  where day_key = v_claim.day_key
    and wallet = v_claim.wallet
    and rewards_reserved = 0;

  if not found then
    raise exception 'ALREADY_REWARDED';
  end if;

  update public.reward_claims
  set status = 'RESERVED',
      public_key = p_public_key,
      signature = p_signature,
      finalized_at = v_now,
      reward_amount_luna = coalesce(v_claim.reward_amount_luna, p_reward_amount_luna),
      reservation_number = v_number
  where claim_id = v_claim.claim_id
  returning * into v_claim;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'outcome', 'RESERVED',
    'existing', false,
    'claim', public.claim_json(v_claim, v_number, v_total)
  );
end;
$$;

create or replace function public.get_reward_claim(
  p_claim_id uuid,
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
  v_claim public.reward_claims%rowtype;
  v_reserved integer := 0;
begin
  if p_claim_id is null then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'CLAIM_NOT_FOUND');
  end if;

  select * into v_session
  from public.run_sessions
  where run_session_hash = p_run_session_hash;

  if not found
    or v_session.revoked_at is not null
    or v_now >= v_session.expires_at then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'RUN_SESSION_INVALID');
  end if;

  select * into v_claim
  from public.reward_claims
  where claim_id = p_claim_id;

  if not found or v_claim.run_id <> v_session.run_id then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'CLAIM_NOT_FOUND');
  end if;

  select reserved_slots into v_reserved
  from public.daily_reward_pools
  where day_key = v_claim.day_key;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'outcome', v_claim.status::text,
    'claim', public.claim_json(v_claim, coalesce(v_reserved, 0), (select total_slots from public.daily_reward_pools where day_key=v_claim.day_key))
  );
end;
$$;
create or replace function public.get_reserved_reward_claim_for_session(
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
  v_claim public.reward_claims%rowtype;
  v_reserved integer := 0;
begin
  if p_run_session_hash is null or pg_catalog.char_length(p_run_session_hash) = 0 then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'RUN_SESSION_INVALID');
  end if;

  select * into v_session
  from public.run_sessions
  where run_session_hash = p_run_session_hash;

  if not found
    or v_session.revoked_at is not null
    or v_now >= v_session.expires_at then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'RUN_SESSION_INVALID');
  end if;

  select * into v_claim
  from public.reward_claims
  where run_id = v_session.run_id
    and status = 'RESERVED';

  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'CLAIM_NOT_FOUND');
  end if;

  select reserved_slots into v_reserved
  from public.daily_reward_pools
  where day_key = v_claim.day_key;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'outcome', v_claim.status::text,
    'claim', public.claim_json(v_claim, coalesce(v_reserved, 0), (select total_slots from public.daily_reward_pools where day_key=v_claim.day_key))
  );
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
    'reserved_slots', v_reserved_slots, 'total_slots', coalesce((select total_slots from public.daily_reward_pools where day_key=v_run.day_key),public.reward_slots_for_day(v_run.day_key))
  );
end;
$$;
commit;
select starts_at from public.permanent_reward_policy where singleton;
