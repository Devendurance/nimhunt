-- NimHunt controlled automatic payout pipeline.
-- Adds a DB kill switch (default OFF) and PASS-only automated acquire/discovery.
-- Does not change reservation semantics. Does not store treasury secrets.

create table if not exists public.payout_automation_control (
  id boolean primary key default true check (id),
  automatic_payouts_enabled boolean not null default false,
  updated_at timestamptz not null default pg_catalog.timezone('utc', pg_catalog.now())
);

insert into public.payout_automation_control (id, automatic_payouts_enabled)
values (true, false)
on conflict (id) do nothing;

alter table public.payout_automation_control enable row level security;
alter table public.payout_automation_control force row level security;

do $$
begin
  grant select, insert, update, delete on public.payout_automation_control to anon, authenticated;
exception
  when undefined_object then null;
  when insufficient_privilege then null;
end $$;

create or replace function public.reject_payout_automation_control_delete()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  raise exception 'PAYOUT_IMMUTABLE';
end;
$$;

drop trigger if exists payout_automation_control_immutable_delete on public.payout_automation_control;
create trigger payout_automation_control_immutable_delete
before delete on public.payout_automation_control
for each row execute function public.reject_payout_automation_control_delete();

create or replace function public.get_payout_automation_control()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_row public.payout_automation_control%rowtype;
begin
  select * into v_row from public.payout_automation_control where id is true;
  if not found then
    return pg_catalog.jsonb_build_object(
      'ok', true,
      'automatic_payouts_enabled', false
    );
  end if;
  return pg_catalog.jsonb_build_object(
    'ok', true,
    'automatic_payouts_enabled', v_row.automatic_payouts_enabled
  );
end;
$$;

create or replace function public.set_payout_automation_enabled(p_enabled boolean)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_now timestamptz := pg_catalog.timezone('utc', pg_catalog.now());
  v_row public.payout_automation_control%rowtype;
begin
  if p_enabled is null then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'MALFORMED_REQUEST');
  end if;

  insert into public.payout_automation_control (id, automatic_payouts_enabled, updated_at)
  values (true, p_enabled, v_now)
  on conflict (id) do update
    set automatic_payouts_enabled = excluded.automatic_payouts_enabled,
        updated_at = v_now
  returning * into v_row;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'automatic_payouts_enabled', v_row.automatic_payouts_enabled
  );
end;
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
      ) order by c.finalized_at, c.claim_id)
      from (
        select rc.claim_id, rc.run_id, rc.wallet, rc.day_key, rc.finalized_at
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

create or replace function public.count_unpaid_reward_risk_skips()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
begin
  return pg_catalog.jsonb_build_object(
    'ok', true,
    'review_skipped', (
      select count(*)::integer
      from public.reward_claims rc
      inner join public.reward_risk_assessments a on a.run_id = rc.run_id
      where rc.status = 'RESERVED'
        and a.result = 'REVIEW'
        and not exists (
          select 1 from public.reward_payouts p where p.claim_id = rc.claim_id
        )
    ),
    'block_skipped', (
      select count(*)::integer
      from public.reward_claims rc
      inner join public.reward_risk_assessments a on a.run_id = rc.run_id
      where rc.status = 'RESERVED'
        and a.result = 'BLOCK'
        and not exists (
          select 1 from public.reward_payouts p where p.claim_id = rc.claim_id
        )
    )
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
      select pg_catalog.jsonb_agg(public.payout_json(p) order by p.created_at, p.payout_id)
      from (
        select *
        from public.reward_payouts
        where status = v_status
        order by created_at, payout_id
        limit v_limit
      ) p
    ), '[]'::jsonb)
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
    order by created_at, payout_id
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
  where day_key = v_payout.day_key
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

revoke all on function public.reject_payout_automation_control_delete() from public, anon, authenticated;
revoke all on function public.get_payout_automation_control() from public, anon, authenticated;
revoke all on function public.set_payout_automation_enabled(boolean) from public, anon, authenticated;
revoke all on function public.list_unpaid_reserved_claims(integer) from public, anon, authenticated;
revoke all on function public.count_unpaid_reward_risk_skips() from public, anon, authenticated;
revoke all on function public.list_reward_payouts(text, integer) from public, anon, authenticated;
revoke all on function public.acquire_reward_payout() from public, anon, authenticated;
revoke all on function public.acquire_automated_reward_payout(bigint, bigint, bigint) from public, anon, authenticated;

do $$
begin
  grant execute on function public.get_payout_automation_control() to service_role;
  grant execute on function public.set_payout_automation_enabled(boolean) to service_role;
  grant execute on function public.list_unpaid_reserved_claims(integer) to service_role;
  grant execute on function public.count_unpaid_reward_risk_skips() to service_role;
  grant execute on function public.list_reward_payouts(text, integer) to service_role;
  grant execute on function public.acquire_reward_payout() to service_role;
  grant execute on function public.acquire_automated_reward_payout(bigint, bigint, bigint) to service_role;
exception
  when undefined_object then null;
end $$;
