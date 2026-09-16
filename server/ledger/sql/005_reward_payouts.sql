-- NimHunt reward payouts. One payout per RESERVED claim. Separate from gameplay proof.
-- Reservation remains accounting-only. This table records treasury execution state.

do $$ begin
  create type public.reward_payout_status as enum (
    'PENDING',
    'PROCESSING',
    'SUBMITTED',
    'CONFIRMED',
    'FAILED_RETRYABLE',
    'FAILED_FINAL'
  );
exception
  when duplicate_object then null;
end $$;

create table if not exists public.reward_payouts (
  payout_id uuid primary key,
  claim_id uuid not null unique references public.reward_claims (claim_id),
  run_id uuid not null references public.expedition_runs (id),
  wallet text not null check (pg_catalog.char_length(wallet) between 1 and 80),
  day_key date not null,
  amount_luna bigint not null check (amount_luna > 0),
  network text not null check (network in ('testnet', 'mainnet')),
  status public.reward_payout_status not null,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  tx_hash text check (tx_hash is null or tx_hash ~ '^[0-9a-f]{64}$'),
  failure_code text check (failure_code is null or pg_catalog.char_length(failure_code) between 1 and 64),
  failure_message_safe text check (
    failure_message_safe is null or pg_catalog.char_length(failure_message_safe) between 1 and 280
  ),
  created_at timestamptz not null default pg_catalog.timezone('utc', pg_catalog.now()),
  processing_started_at timestamptz,
  submitted_at timestamptz,
  confirmed_at timestamptz,
  updated_at timestamptz not null default pg_catalog.timezone('utc', pg_catalog.now()),
  check (
    (status in ('PENDING', 'FAILED_RETRYABLE') and tx_hash is null)
    or (status in ('SUBMITTED', 'CONFIRMED') and tx_hash is not null)
    or (status in ('PROCESSING', 'FAILED_FINAL'))
  ),
  check (status <> 'CONFIRMED' or confirmed_at is not null),
  check (status <> 'SUBMITTED' or submitted_at is not null)
);

create index if not exists reward_payouts_status_created_idx
  on public.reward_payouts (status, created_at);

create index if not exists reward_payouts_run_idx
  on public.reward_payouts (run_id);

create or replace function public.reject_reward_payout_mutation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'PAYOUT_IMMUTABLE';
  end if;
  if new.payout_id is distinct from old.payout_id
    or new.claim_id is distinct from old.claim_id
    or new.run_id is distinct from old.run_id
    or new.wallet is distinct from old.wallet
    or new.day_key is distinct from old.day_key
    or new.amount_luna is distinct from old.amount_luna
    or new.network is distinct from old.network
    or new.created_at is distinct from old.created_at then
    raise exception 'PAYOUT_IMMUTABLE';
  end if;
  return new;
end;
$$;

drop trigger if exists reward_payouts_immutable_delete on public.reward_payouts;
create trigger reward_payouts_immutable_delete
before delete on public.reward_payouts
for each row execute function public.reject_reward_payout_mutation();

drop trigger if exists reward_payouts_bind_immutable_update on public.reward_payouts;
create trigger reward_payouts_bind_immutable_update
before update on public.reward_payouts
for each row execute function public.reject_reward_payout_mutation();

alter table public.reward_payouts enable row level security;
alter table public.reward_payouts force row level security;

do $$
begin
  grant select, insert, update, delete on public.reward_payouts to anon, authenticated;
exception
  when undefined_object then null;
  when insufficient_privilege then null;
end $$;

create or replace function public.payout_json(p_payout public.reward_payouts)
returns jsonb
language sql
stable
as $$
  select pg_catalog.jsonb_build_object(
    'payout_id', p_payout.payout_id,
    'claim_id', p_payout.claim_id,
    'run_id', p_payout.run_id,
    'wallet', p_payout.wallet,
    'day_key', p_payout.day_key,
    'amount_luna', p_payout.amount_luna::text,
    'network', p_payout.network,
    'status', p_payout.status,
    'attempt_count', p_payout.attempt_count,
    'tx_hash', p_payout.tx_hash,
    'failure_code', p_payout.failure_code,
    'failure_message_safe', p_payout.failure_message_safe,
    'created_at', p_payout.created_at,
    'processing_started_at', p_payout.processing_started_at,
    'submitted_at', p_payout.submitted_at,
    'confirmed_at', p_payout.confirmed_at,
    'updated_at', p_payout.updated_at
  );
$$;

create or replace function public.create_reward_payout(
  p_claim_id uuid,
  p_payout_id uuid,
  p_amount_luna bigint,
  p_network text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_now timestamptz := pg_catalog.timezone('utc', pg_catalog.now());
  v_claim public.reward_claims%rowtype;
  v_payout public.reward_payouts%rowtype;
begin
  if p_claim_id is null or p_payout_id is null then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'MALFORMED_REQUEST');
  end if;
  if p_amount_luna is null or p_amount_luna <= 0 then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'PAYOUT_AMOUNT_INVALID');
  end if;
  if p_network is null or p_network not in ('testnet', 'mainnet') then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'PAYOUT_NETWORK_INVALID');
  end if;

  select * into v_claim
  from public.reward_claims
  where claim_id = p_claim_id
  for update;

  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'CLAIM_NOT_FOUND');
  end if;

  select * into v_payout
  from public.reward_payouts
  where claim_id = v_claim.claim_id
  for update;

  if found then
    return pg_catalog.jsonb_build_object(
      'ok', true,
      'existing', true,
      'payout', public.payout_json(v_payout)
    );
  end if;

  if v_claim.status <> 'RESERVED'
    or v_claim.public_key is null
    or v_claim.signature is null
    or v_claim.finalized_at is null then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'CLAIM_NOT_ELIGIBLE');
  end if;

  begin
    insert into public.reward_payouts (
      payout_id,
      claim_id,
      run_id,
      wallet,
      day_key,
      amount_luna,
      network,
      status,
      attempt_count,
      tx_hash,
      failure_code,
      failure_message_safe,
      created_at,
      processing_started_at,
      submitted_at,
      confirmed_at,
      updated_at
    ) values (
      p_payout_id,
      v_claim.claim_id,
      v_claim.run_id,
      v_claim.wallet,
      v_claim.day_key,
      p_amount_luna,
      p_network,
      'PENDING',
      0,
      null,
      null,
      null,
      v_now,
      null,
      null,
      null,
      v_now
    ) returning * into v_payout;
  exception
    when unique_violation then
      select * into v_payout from public.reward_payouts where claim_id = v_claim.claim_id;
      if not found then
        return pg_catalog.jsonb_build_object('ok', false, 'error', 'PAYOUT_NOT_FOUND');
      end if;
      return pg_catalog.jsonb_build_object(
        'ok', true,
        'existing', true,
        'payout', public.payout_json(v_payout)
      );
  end;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'existing', false,
    'payout', public.payout_json(v_payout)
  );
end;
$$;

create or replace function public.acquire_reward_payout()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_now timestamptz := pg_catalog.timezone('utc', pg_catalog.now());
  v_payout public.reward_payouts%rowtype;
begin
  with next as (
    select payout_id
    from public.reward_payouts
    where status in ('PENDING', 'FAILED_RETRYABLE')
      and tx_hash is null
    order by created_at
    for update skip locked
    limit 1
  )
  update public.reward_payouts p
  set status = 'PROCESSING',
      processing_started_at = v_now,
      attempt_count = p.attempt_count + 1,
      failure_code = null,
      failure_message_safe = null,
      updated_at = v_now
  from next
  where p.payout_id = next.payout_id
  returning p.* into v_payout;

  if not found then
    return pg_catalog.jsonb_build_object('ok', true, 'payout', null);
  end if;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'payout', public.payout_json(v_payout)
  );
end;
$$;

create or replace function public.mark_reward_payout_submitted(
  p_payout_id uuid,
  p_tx_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_now timestamptz := pg_catalog.timezone('utc', pg_catalog.now());
  v_payout public.reward_payouts%rowtype;
begin
  if p_payout_id is null then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'PAYOUT_NOT_FOUND');
  end if;
  if p_tx_hash is null or p_tx_hash !~ '^[0-9a-f]{64}$' then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'PAYOUT_TX_INVALID');
  end if;

  select * into v_payout
  from public.reward_payouts
  where payout_id = p_payout_id
  for update;

  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'PAYOUT_NOT_FOUND');
  end if;

  if v_payout.status in ('SUBMITTED', 'CONFIRMED') then
    if v_payout.tx_hash is distinct from p_tx_hash then
      return pg_catalog.jsonb_build_object('ok', false, 'error', 'PAYOUT_TX_MISMATCH');
    end if;
    return pg_catalog.jsonb_build_object(
      'ok', true,
      'existing', true,
      'payout', public.payout_json(v_payout)
    );
  end if;

  if v_payout.status <> 'PROCESSING' then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'PAYOUT_STATUS_INVALID');
  end if;
  if v_payout.tx_hash is not null and v_payout.tx_hash is distinct from p_tx_hash then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'PAYOUT_TX_MISMATCH');
  end if;

  update public.reward_payouts
  set status = 'SUBMITTED',
      tx_hash = p_tx_hash,
      submitted_at = coalesce(submitted_at, v_now),
      failure_code = null,
      failure_message_safe = null,
      updated_at = v_now
  where payout_id = v_payout.payout_id
  returning * into v_payout;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'existing', false,
    'payout', public.payout_json(v_payout)
  );
end;
$$;

create or replace function public.mark_reward_payout_confirmed(
  p_payout_id uuid,
  p_tx_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_now timestamptz := pg_catalog.timezone('utc', pg_catalog.now());
  v_payout public.reward_payouts%rowtype;
begin
  if p_payout_id is null then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'PAYOUT_NOT_FOUND');
  end if;
  if p_tx_hash is null or p_tx_hash !~ '^[0-9a-f]{64}$' then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'PAYOUT_TX_INVALID');
  end if;

  select * into v_payout
  from public.reward_payouts
  where payout_id = p_payout_id
  for update;

  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'PAYOUT_NOT_FOUND');
  end if;

  if v_payout.status = 'CONFIRMED' then
    if v_payout.tx_hash is distinct from p_tx_hash then
      return pg_catalog.jsonb_build_object('ok', false, 'error', 'PAYOUT_TX_MISMATCH');
    end if;
    return pg_catalog.jsonb_build_object(
      'ok', true,
      'existing', true,
      'payout', public.payout_json(v_payout)
    );
  end if;

  if v_payout.status <> 'SUBMITTED' or v_payout.tx_hash is null then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'PAYOUT_STATUS_INVALID');
  end if;
  if v_payout.tx_hash is distinct from p_tx_hash then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'PAYOUT_TX_MISMATCH');
  end if;

  update public.reward_payouts
  set status = 'CONFIRMED',
      confirmed_at = coalesce(confirmed_at, v_now),
      failure_code = null,
      failure_message_safe = null,
      updated_at = v_now
  where payout_id = v_payout.payout_id
  returning * into v_payout;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'existing', false,
    'payout', public.payout_json(v_payout)
  );
end;
$$;

create or replace function public.mark_reward_payout_failed(
  p_payout_id uuid,
  p_status text,
  p_failure_code text,
  p_failure_message_safe text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_now timestamptz := pg_catalog.timezone('utc', pg_catalog.now());
  v_payout public.reward_payouts%rowtype;
  v_status public.reward_payout_status;
begin
  if p_payout_id is null then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'PAYOUT_NOT_FOUND');
  end if;
  if p_status is null or p_status not in ('FAILED_RETRYABLE', 'FAILED_FINAL') then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'PAYOUT_STATUS_INVALID');
  end if;
  v_status := p_status::public.reward_payout_status;
  if p_failure_code is null or pg_catalog.char_length(p_failure_code) = 0 or pg_catalog.char_length(p_failure_code) > 64 then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'MALFORMED_REQUEST');
  end if;
  if p_failure_message_safe is not null and pg_catalog.char_length(p_failure_message_safe) > 280 then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'MALFORMED_REQUEST');
  end if;

  select * into v_payout
  from public.reward_payouts
  where payout_id = p_payout_id
  for update;

  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'PAYOUT_NOT_FOUND');
  end if;
  if v_payout.status in ('CONFIRMED') then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'PAYOUT_STATUS_INVALID');
  end if;
  if v_status = 'FAILED_RETRYABLE' and v_payout.tx_hash is not null then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'PAYOUT_RESEND_UNSAFE');
  end if;
  if v_payout.status in ('FAILED_RETRYABLE', 'FAILED_FINAL') and v_payout.status = v_status then
    return pg_catalog.jsonb_build_object(
      'ok', true,
      'existing', true,
      'payout', public.payout_json(v_payout)
    );
  end if;

  update public.reward_payouts
  set status = v_status,
      failure_code = p_failure_code,
      failure_message_safe = p_failure_message_safe,
      updated_at = v_now
  where payout_id = v_payout.payout_id
  returning * into v_payout;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'existing', false,
    'payout', public.payout_json(v_payout)
  );
end;
$$;

create or replace function public.get_reward_payout_by_claim(
  p_claim_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_payout public.reward_payouts%rowtype;
begin
  if p_claim_id is null then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'CLAIM_NOT_FOUND');
  end if;
  select * into v_payout from public.reward_payouts where claim_id = p_claim_id;
  if not found then
    return pg_catalog.jsonb_build_object('ok', true, 'payout', null);
  end if;
  return pg_catalog.jsonb_build_object('ok', true, 'payout', public.payout_json(v_payout));
end;
$$;

create or replace function public.get_reward_payout(
  p_payout_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_payout public.reward_payouts%rowtype;
begin
  if p_payout_id is null then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'PAYOUT_NOT_FOUND');
  end if;
  select * into v_payout from public.reward_payouts where payout_id = p_payout_id;
  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'PAYOUT_NOT_FOUND');
  end if;
  return pg_catalog.jsonb_build_object('ok', true, 'payout', public.payout_json(v_payout));
end;
$$;

create or replace function public.get_reward_payout_for_session(
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
  v_payout public.reward_payouts%rowtype;
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
  if v_claim.status <> 'RESERVED' then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'CLAIM_NOT_ELIGIBLE');
  end if;

  select * into v_payout
  from public.reward_payouts
  where claim_id = v_claim.claim_id;

  if not found then
    return pg_catalog.jsonb_build_object(
      'ok', true,
      'claim_id', v_claim.claim_id,
      'payout', null
    );
  end if;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'claim_id', v_claim.claim_id,
    'payout', public.payout_public_json(v_payout)
  );
end;
$$;

create or replace function public.payout_public_json(p_payout public.reward_payouts)
returns jsonb
language sql
stable
as $$
  select pg_catalog.jsonb_build_object(
    'payout_id', p_payout.payout_id,
    'claim_id', p_payout.claim_id,
    'status', p_payout.status,
    'amount_luna', p_payout.amount_luna::text,
    'network', p_payout.network,
    'tx_hash_safe', p_payout.tx_hash,
    'submitted_at', p_payout.submitted_at,
    'confirmed_at', p_payout.confirmed_at
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
        'day_key', c.day_key
      ) order by c.finalized_at)
      from (
        select claim_id, run_id, wallet, day_key, finalized_at
        from public.reward_claims
        where status = 'RESERVED'
          and public_key is not null
          and signature is not null
          and finalized_at is not null
          and not exists (
            select 1 from public.reward_payouts p where p.claim_id = reward_claims.claim_id
          )
        order by finalized_at
        limit v_limit
      ) c
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.list_reward_payouts(
  p_status text,
  p_limit integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 10), 1), 69);
  v_status public.reward_payout_status;
begin
  if p_status is null or p_status not in (
    'PENDING', 'PROCESSING', 'SUBMITTED', 'CONFIRMED', 'FAILED_RETRYABLE', 'FAILED_FINAL'
  ) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'PAYOUT_STATUS_INVALID');
  end if;
  v_status := p_status::public.reward_payout_status;
  return pg_catalog.jsonb_build_object(
    'ok', true,
    'payouts', coalesce((
      select pg_catalog.jsonb_agg(public.payout_json(p) order by p.created_at)
      from (
        select *
        from public.reward_payouts
        where status = v_status
        order by created_at
        limit v_limit
      ) p
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.payout_json(public.reward_payouts) from public, anon, authenticated;
revoke all on function public.payout_public_json(public.reward_payouts) from public, anon, authenticated;
revoke all on function public.reject_reward_payout_mutation() from public, anon, authenticated;
revoke all on function public.create_reward_payout(uuid, uuid, bigint, text) from public, anon, authenticated;
revoke all on function public.acquire_reward_payout() from public, anon, authenticated;
revoke all on function public.mark_reward_payout_submitted(uuid, text) from public, anon, authenticated;
revoke all on function public.mark_reward_payout_confirmed(uuid, text) from public, anon, authenticated;
revoke all on function public.mark_reward_payout_failed(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.get_reward_payout(uuid) from public, anon, authenticated;
revoke all on function public.get_reward_payout_by_claim(uuid) from public, anon, authenticated;
revoke all on function public.get_reward_payout_for_session(uuid, text) from public, anon, authenticated;
revoke all on function public.list_unpaid_reserved_claims(integer) from public, anon, authenticated;
revoke all on function public.list_reward_payouts(text, integer) from public, anon, authenticated;

do $$
begin
  grant execute on function public.create_reward_payout(uuid, uuid, bigint, text) to service_role;
  grant execute on function public.acquire_reward_payout() to service_role;
  grant execute on function public.mark_reward_payout_submitted(uuid, text) to service_role;
  grant execute on function public.mark_reward_payout_confirmed(uuid, text) to service_role;
  grant execute on function public.mark_reward_payout_failed(uuid, text, text, text) to service_role;
  grant execute on function public.get_reward_payout(uuid) to service_role;
  grant execute on function public.get_reward_payout_by_claim(uuid) to service_role;
  grant execute on function public.get_reward_payout_for_session(uuid, text) to service_role;
  grant execute on function public.list_unpaid_reserved_claims(integer) to service_role;
  grant execute on function public.list_reward_payouts(text, integer) to service_role;
exception
  when undefined_object then null;
end $$;
