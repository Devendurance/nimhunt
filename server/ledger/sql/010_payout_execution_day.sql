-- NimHunt execution-day treasury spend accounting.
-- Reservation day_key stays the UTC day of the 69-slot claim.
-- execution_day_key is the UTC day a payout is committed for broadcast/execution.
-- Daily treasury cap uses execution_day_key, not reservation day_key.
-- Does not change claim semantics, amounts, tx hashes, or statuses.

alter table public.reward_payouts
  add column if not exists execution_day_key date;

comment on column public.reward_payouts.day_key is
  'Reservation UTC day. The 69-slot claim day. Immutable after create.';
comment on column public.reward_payouts.execution_day_key is
  'UTC day the payout was committed for treasury execution. Set atomically on acquire.';

update public.reward_payouts
set execution_day_key = (pg_catalog.timezone(
  'utc',
  coalesce(submitted_at, confirmed_at, processing_started_at)
))::date
where execution_day_key is null
  and (
    status in ('PROCESSING', 'SUBMITTED', 'CONFIRMED')
    or (status = 'FAILED_FINAL' and tx_hash is not null)
  )
  and coalesce(submitted_at, confirmed_at, processing_started_at) is not null;

create index if not exists reward_payouts_execution_day_idx
  on public.reward_payouts (execution_day_key)
  where execution_day_key is not null;

alter table public.reward_payouts
  drop constraint if exists reward_payouts_execution_day_committed;
alter table public.reward_payouts
  add constraint reward_payouts_execution_day_committed
  check (status not in ('SUBMITTED', 'CONFIRMED') or execution_day_key is not null);

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
  if new.execution_day_key is distinct from old.execution_day_key then
    if old.execution_day_key is not null
      and not (
        old.status in ('PENDING', 'FAILED_RETRYABLE')
        and new.status = 'PROCESSING'
      ) then
      raise exception 'PAYOUT_IMMUTABLE';
    end if;
  end if;
  return new;
end;
$$;

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
    'execution_day_key', p_payout.execution_day_key,
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

create or replace function public.acquire_reward_payout()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_now timestamptz := pg_catalog.timezone('utc', pg_catalog.now());
  v_execution_day date := (pg_catalog.timezone('utc', v_now))::date;
  v_payout public.reward_payouts%rowtype;
begin
  with next as (
    select payout_id
    from public.reward_payouts
    where status in ('PENDING', 'FAILED_RETRYABLE')
      and tx_hash is null
    order by created_at, payout_id
    for update skip locked
    limit 1
  )
  update public.reward_payouts p
  set status = 'PROCESSING',
      execution_day_key = v_execution_day,
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

create or replace function public.acquire_automated_reward_payout(
  p_available_for_rewards_luna bigint,
  p_max_daily_reward_luna bigint,
  p_fee_luna bigint
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_now timestamptz := pg_catalog.timezone('utc', pg_catalog.now());
  v_execution_day date := (pg_catalog.timezone('utc', v_now))::date;
  v_enabled boolean := false;
  v_payout public.reward_payouts%rowtype;
  v_committed bigint := 0;
  v_outstanding bigint := 0;
  v_fee bigint := coalesce(p_fee_luna, 0);
begin
  if p_available_for_rewards_luna is null or p_available_for_rewards_luna < 0 then
    return pg_catalog.jsonb_build_object('ok', true, 'payout', null, 'reason', 'TREASURY_LOW');
  end if;
  if p_max_daily_reward_luna is null or p_max_daily_reward_luna <= 0 then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'PAYOUT_AMOUNT_INVALID');
  end if;
  if v_fee < 0 then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'PAYOUT_AMOUNT_INVALID');
  end if;

  select automatic_payouts_enabled into v_enabled
  from public.payout_automation_control
  where id is true
  for update;

  if not found or v_enabled is not true then
    return pg_catalog.jsonb_build_object('ok', true, 'payout', null, 'reason', 'AUTOMATION_DISABLED');
  end if;

  select p.* into v_payout
  from public.reward_payouts p
  inner join public.reward_claims c on c.claim_id = p.claim_id
  inner join public.reward_risk_assessments a on a.run_id = p.run_id
  where p.status in ('PENDING', 'FAILED_RETRYABLE')
    and p.tx_hash is null
    and c.status = 'RESERVED'
    and a.result = 'PASS'
  order by p.created_at, p.payout_id
  for update of p skip locked
  limit 1;

  if not found then
    return pg_catalog.jsonb_build_object('ok', true, 'payout', null, 'reason', 'NO_WORK');
  end if;

  select coalesce(sum(amount_luna), 0) into v_committed
  from public.reward_payouts
  where execution_day_key = v_execution_day
    and (
      status in ('PROCESSING', 'SUBMITTED', 'CONFIRMED')
      or (status = 'FAILED_FINAL' and tx_hash is not null)
    );

  if v_committed + v_payout.amount_luna > p_max_daily_reward_luna then
    return pg_catalog.jsonb_build_object('ok', true, 'payout', null, 'reason', 'DAILY_CAP_REACHED');
  end if;

  select coalesce(sum(amount_luna), 0) into v_outstanding
  from public.reward_payouts
  where status = 'PROCESSING'
    and tx_hash is null;

  if v_outstanding + v_payout.amount_luna + v_fee > p_available_for_rewards_luna then
    return pg_catalog.jsonb_build_object('ok', true, 'payout', null, 'reason', 'TREASURY_LOW');
  end if;

  update public.reward_payouts
  set status = 'PROCESSING',
      execution_day_key = v_execution_day,
      processing_started_at = v_now,
      attempt_count = attempt_count + 1,
      failure_code = null,
      failure_message_safe = null,
      updated_at = v_now
  where payout_id = v_payout.payout_id
  returning * into v_payout;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'payout', public.payout_json(v_payout),
    'reason', null
  );
end;
$$;

create or replace function public.get_execution_day_payout_spend(p_execution_day date)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_committed bigint := 0;
begin
  if p_execution_day is null then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'MALFORMED_REQUEST');
  end if;

  select coalesce(sum(amount_luna), 0) into v_committed
  from public.reward_payouts
  where execution_day_key = p_execution_day
    and (
      status in ('PROCESSING', 'SUBMITTED', 'CONFIRMED')
      or (status = 'FAILED_FINAL' and tx_hash is not null)
    );

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'execution_day', p_execution_day,
    'committed_luna', v_committed::text
  );
end;
$$;

revoke all on function public.payout_json(public.reward_payouts) from public, anon, authenticated;
revoke all on function public.reject_reward_payout_mutation() from public, anon, authenticated;
revoke all on function public.acquire_reward_payout() from public, anon, authenticated;
revoke all on function public.acquire_automated_reward_payout(bigint, bigint, bigint) from public, anon, authenticated;
revoke all on function public.get_execution_day_payout_spend(date) from public, anon, authenticated;

do $$
begin
  grant execute on function public.acquire_reward_payout() to service_role;
  grant execute on function public.acquire_automated_reward_payout(bigint, bigint, bigint) to service_role;
  grant execute on function public.get_execution_day_payout_spend(date) to service_role;
exception
  when undefined_object then null;
end $$;
