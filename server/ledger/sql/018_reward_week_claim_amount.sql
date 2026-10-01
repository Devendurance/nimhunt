-- Reward Week claim economics.
-- Freezes the server-selected reward amount on a RESERVED claim so payout
-- execution and Treasure Bank reads never depend on worker-time configuration.
-- Historical claims remain readable with NULL and are resolved by their
-- immutable reservation day using the server policy fallback.

alter table public.reward_claims
  add column if not exists reward_amount_luna bigint;

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.reward_claims'::pg_catalog.regclass
      and conname = 'reward_claims_reward_amount_positive'
  ) then
    alter table public.reward_claims
      add constraint reward_claims_reward_amount_positive
      check (reward_amount_luna is null or reward_amount_luna > 0);
  end if;
end $$;

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
  if new.reward_amount_luna is distinct from old.reward_amount_luna
    and not (
      old.reward_amount_luna is null
      and new.reward_amount_luna is not null
      and old.status = 'PREPARED'
      and new.status = 'RESERVED'
    ) then
    raise exception 'PROOF_LOST';
  end if;
  return new;
end;
$$;

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
    'reservation_number', case when p_claim.status = 'RESERVED' then p_reserved else null end,
    'remaining_slots', greatest(p_total - coalesce(p_reserved, 0), 0),
    'total_slots', p_total
  );
$$;

create or replace function public.list_unpaid_reserved_claims(p_limit integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 10), 1), 69);
begin
  return pg_catalog.jsonb_build_object(
    'ok', true,
    'claims', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'claim_id', c.claim_id,
        'run_id', c.run_id,
        'wallet', c.wallet,
        'day_key', c.day_key,
        'reward_amount_luna', c.reward_amount_luna::text,
        'finalized_at', c.finalized_at
      ) order by c.finalized_at, c.claim_id)
      from (
        select rc.claim_id, rc.run_id, rc.wallet, rc.day_key, rc.reward_amount_luna, rc.finalized_at
        from public.reward_claims rc
        inner join public.reward_risk_assessments a
          on a.run_id = rc.run_id
         and a.result = 'PASS'
        where rc.status = 'RESERVED'
          and rc.public_key is not null
          and rc.signature is not null
          and rc.finalized_at is not null
          and not exists (
            select 1 from public.reward_payouts p where p.claim_id = rc.claim_id
          )
        order by rc.finalized_at, rc.claim_id
        limit v_limit
      ) c
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.list_unpaid_reserved_claims(integer) from public, anon, authenticated;
do $$
begin
  grant execute on function public.list_unpaid_reserved_claims(integer) to service_role;
exception
  when undefined_object then null;
end $$;

-- Keep the legacy service-role-only overload during the compatibility window.
-- Migration 019 removes it only after the amount-aware application is live.
do $$
begin
  revoke all on function public.finalize_reward_claim(uuid, uuid, text, text, text, text, text, text) from public, anon, authenticated;
  grant execute on function public.finalize_reward_claim(uuid, uuid, text, text, text, text, text, text) to service_role;
exception
  when undefined_object then null;
end $$;

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
      finalized_at = v_now,
      reward_amount_luna = p_reward_amount_luna
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

revoke all on function public.finalize_reward_claim(uuid, uuid, text, text, text, text, text, text, bigint) from public, anon, authenticated;
do $$
begin
  grant execute on function public.finalize_reward_claim(uuid, uuid, text, text, text, text, text, text, bigint) to service_role;
exception
  when undefined_object then null;
end $$;
