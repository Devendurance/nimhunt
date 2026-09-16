-- NimHunt signed reward claims + atomic 69-slot reservation.
-- Reservation is accounting only. No NIM movement, treasury, or payout.

do $$ begin
  create type public.reward_claim_status as enum (
    'PREPARED',
    'RESERVED',
    'SOLD_OUT',
    'ALREADY_REWARDED',
    'EXPIRED'
  );
exception
  when duplicate_object then null;
end $$;

create table if not exists public.reward_claims (
  claim_id uuid primary key,
  run_id uuid not null unique references public.expedition_runs (id),
  wallet text not null check (pg_catalog.char_length(wallet) between 1 and 80),
  mission text not null check (mission in ('gem-runner', 'chest-hunter', 'vault-breaker')),
  day_key date not null,
  canonical_payload text not null check (pg_catalog.char_length(canonical_payload) between 1 and 4096),
  claim_payload_hash text not null check (claim_payload_hash ~ '^[0-9a-f]{64}$'),
  status public.reward_claim_status not null,
  public_key text check (public_key is null or pg_catalog.char_length(public_key) between 1 and 130),
  signature text check (signature is null or pg_catalog.char_length(signature) between 1 and 258),
  created_at timestamptz not null default pg_catalog.timezone('utc', pg_catalog.now()),
  expires_at timestamptz not null,
  finalized_at timestamptz,
  check (
    (status = 'PREPARED' and public_key is null and signature is null and finalized_at is null)
    or (status <> 'PREPARED')
  )
);

create index if not exists reward_claims_wallet_day_idx
  on public.reward_claims (day_key, wallet);

create unique index if not exists reward_claims_one_reserved_per_wallet_day
  on public.reward_claims (day_key, wallet)
  where status = 'RESERVED';

create or replace function public.reject_reward_claim_mutation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'PROOF_LOST';
  end if;
  if new.claim_id is distinct from old.claim_id
    or new.run_id is distinct from old.run_id
    or new.wallet is distinct from old.wallet
    or new.mission is distinct from old.mission
    or new.day_key is distinct from old.day_key
    or new.canonical_payload is distinct from old.canonical_payload
    or new.claim_payload_hash is distinct from old.claim_payload_hash
    or new.created_at is distinct from old.created_at
    or new.expires_at is distinct from old.expires_at then
    raise exception 'PROOF_LOST';
  end if;
  return new;
end;
$$;

drop trigger if exists reward_claims_immutable_delete on public.reward_claims;
create trigger reward_claims_immutable_delete
before delete on public.reward_claims
for each row execute function public.reject_reward_claim_mutation();

drop trigger if exists reward_claims_bind_immutable_update on public.reward_claims;
create trigger reward_claims_bind_immutable_update
before update on public.reward_claims
for each row execute function public.reject_reward_claim_mutation();

alter table public.reward_claims enable row level security;
alter table public.reward_claims force row level security;

do $$
begin
  grant select, insert, update, delete on public.reward_claims to anon, authenticated;
exception
  when undefined_object then null;
  when insufficient_privilege then null;
end $$;

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
    'reservation_number', case when p_claim.status = 'RESERVED' then p_reserved else null end,
    'remaining_slots', greatest(p_total - coalesce(p_reserved, 0), 0),
    'total_slots', p_total
  );
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
      'claim', public.claim_json(v_claim, v_reserved, 69)
    );
  end if;

  if v_wallet_reserved >= 1 then
    v_status := 'ALREADY_REWARDED';
  elsif v_reserved >= 69 then
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
        'claim', public.claim_json(v_claim, v_reserved, 69)
      );
  end;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'outcome', v_claim.status::text,
    'existing', false,
    'claim', public.claim_json(v_claim, v_reserved, 69)
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
  p_signature text
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
      'claim', public.claim_json(v_claim, v_reserved, 69)
    );
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
      'claim', public.claim_json(v_claim, v_reserved, 69)
    );
  end if;

  update public.daily_reward_pools
  set reserved_slots = reserved_slots + 1
  where day_key = v_claim.day_key
    and reserved_slots < 69
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
      'claim', public.claim_json(v_claim, 69, 69)
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
      finalized_at = v_now
  where claim_id = v_claim.claim_id
  returning * into v_claim;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'outcome', 'RESERVED',
    'existing', false,
    'claim', public.claim_json(v_claim, v_number, 69)
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
    'claim', public.claim_json(v_claim, coalesce(v_reserved, 0), 69)
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
    'claim', public.claim_json(v_claim, coalesce(v_reserved, 0), 69)
  );
end;
$$;

revoke all on function public.claim_json(public.reward_claims, integer, integer) from public, anon, authenticated;
revoke all on function public.reject_reward_claim_mutation() from public, anon, authenticated;
revoke all on function public.prepare_reward_claim(uuid, text, text, text, date, uuid, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.finalize_reward_claim(uuid, uuid, text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.get_reward_claim(uuid, text) from public, anon, authenticated;
revoke all on function public.get_reserved_reward_claim_for_session(text) from public, anon, authenticated;

do $$
begin
  grant execute on function public.prepare_reward_claim(uuid, text, text, text, date, uuid, text, text, timestamptz) to service_role;
  grant execute on function public.finalize_reward_claim(uuid, uuid, text, text, text, text, text, text) to service_role;
  grant execute on function public.get_reward_claim(uuid, text) to service_role;
  grant execute on function public.get_reserved_reward_claim_for_session(text) to service_role;
exception
  when undefined_object then null;
end $$;
