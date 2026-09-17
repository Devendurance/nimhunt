-- NimHunt scheduled payout orchestration operations state.
-- This migration records only safe cycle metadata and aggregate owner status.
-- It does not change reward amounts, reservation slots, or payout economics.

alter table public.payout_automation_control
  add column if not exists last_cycle_at timestamptz,
  add column if not exists last_cycle_id uuid,
  add column if not exists last_cycle_result text,
  add column if not exists last_cycle_errors jsonb not null default '[]'::jsonb;

comment on column public.payout_automation_control.last_cycle_at is
  'UTC completion timestamp of the latest scheduled payout cycle.';
comment on column public.payout_automation_control.last_cycle_id is
  'Opaque cycle identifier for operations correlation. Not a secret.';
comment on column public.payout_automation_control.last_cycle_result is
  'Safe cycle outcome: COMPLETED, DISABLED, or FAILED.';
comment on column public.payout_automation_control.last_cycle_errors is
  'Bounded safe error codes from the latest cycle. Never stores secrets or raw errors.';

do $$
begin
  alter table public.payout_automation_control
    add constraint payout_automation_control_cycle_result
    check (last_cycle_result is null or last_cycle_result in ('COMPLETED', 'DISABLED', 'FAILED'));
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter table public.payout_automation_control
    add constraint payout_automation_control_cycle_errors_array
    check (pg_catalog.jsonb_typeof(last_cycle_errors) = 'array');
exception
  when duplicate_object then null;
end $$;

create or replace function public.record_payout_cycle_result(
  p_cycle_id uuid,
  p_cycle_at timestamptz,
  p_result text,
  p_errors jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_errors jsonb := coalesce(p_errors, '[]'::jsonb);
  v_row public.payout_automation_control%rowtype;
begin
  if p_cycle_id is null or p_cycle_at is null then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'MALFORMED_REQUEST');
  end if;
  if p_result is null or p_result not in ('COMPLETED', 'DISABLED', 'FAILED') then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'MALFORMED_REQUEST');
  end if;
  if pg_catalog.jsonb_typeof(v_errors) <> 'array'
    or pg_catalog.jsonb_array_length(v_errors) > 20
    or exists (
      select 1
      from pg_catalog.jsonb_array_elements_text(v_errors) as e(value)
      where pg_catalog.length(e.value) > 96
         or e.value !~ '^[A-Z0-9_]+$'
    ) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'MALFORMED_REQUEST');
  end if;

  insert into public.payout_automation_control (
    id,
    automatic_payouts_enabled,
    last_cycle_at,
    last_cycle_id,
    last_cycle_result,
    last_cycle_errors,
    updated_at
  )
  values (
    true,
    false,
    p_cycle_at,
    p_cycle_id,
    p_result,
    v_errors,
    pg_catalog.timezone('utc', pg_catalog.now())
  )
  on conflict (id) do update
    set last_cycle_at = excluded.last_cycle_at,
        last_cycle_id = excluded.last_cycle_id,
        last_cycle_result = excluded.last_cycle_result,
        last_cycle_errors = excluded.last_cycle_errors,
        updated_at = pg_catalog.timezone('utc', pg_catalog.now())
    where public.payout_automation_control.last_cycle_at is null
       or excluded.last_cycle_at >= public.payout_automation_control.last_cycle_at
  returning * into v_row;

  if not found then
    select * into v_row
    from public.payout_automation_control
    where id is true;
  end if;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'recorded', v_row.last_cycle_id = p_cycle_id,
    'last_cycle_at', v_row.last_cycle_at,
    'last_cycle_id', v_row.last_cycle_id,
    'last_cycle_result', v_row.last_cycle_result,
    'last_cycle_errors', v_row.last_cycle_errors
  );
end;
$$;

create or replace function public.get_payout_operations_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_day date := (pg_catalog.timezone('utc', pg_catalog.now()))::date;
  v_row public.payout_automation_control%rowtype;
begin
  select * into v_row
  from public.payout_automation_control
  where id is true;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'automation_enabled', coalesce(v_row.automatic_payouts_enabled, false),
    'pending_count', (
      select count(*)::integer
      from public.reward_payouts
      where status = 'PENDING'
    ),
    'processing_count', (
      select count(*)::integer
      from public.reward_payouts
      where status = 'PROCESSING'
    ),
    'submitted_count', (
      select count(*)::integer
      from public.reward_payouts
      where status = 'SUBMITTED'
    ),
    'confirmed_today_count', (
      select count(*)::integer
      from public.reward_payouts
      where status = 'CONFIRMED'
        and confirmed_at is not null
        and (pg_catalog.timezone('utc', confirmed_at))::date = v_day
    ),
    'review_count', (
      select count(*)::integer
      from public.reward_claims rc
      inner join public.reward_risk_assessments a on a.run_id = rc.run_id
      where rc.status = 'RESERVED'
        and a.result = 'REVIEW'
        and not exists (
          select 1
          from public.reward_payouts p
          where p.claim_id = rc.claim_id
        )
    ),
    'block_count', (
      select count(*)::integer
      from public.reward_claims rc
      inner join public.reward_risk_assessments a on a.run_id = rc.run_id
      where rc.status = 'RESERVED'
        and a.result = 'BLOCK'
        and not exists (
          select 1
          from public.reward_payouts p
          where p.claim_id = rc.claim_id
        )
    ),
    'execution_day', v_day,
    'execution_day_committed_luna', (
      select coalesce(sum(amount_luna), 0)::text
      from public.reward_payouts
      where execution_day_key = v_day
        and (
          status in ('PROCESSING', 'SUBMITTED', 'CONFIRMED')
          or (status = 'FAILED_FINAL' and tx_hash is not null)
        )
    ),
    'last_cycle_at', v_row.last_cycle_at,
    'last_cycle_id', v_row.last_cycle_id,
    'last_cycle_result', v_row.last_cycle_result,
    'last_cycle_errors', coalesce(v_row.last_cycle_errors, '[]'::jsonb)
  );
end;
$$;

revoke all on function public.record_payout_cycle_result(uuid, timestamptz, text, jsonb) from public, anon, authenticated;
revoke all on function public.get_payout_operations_status() from public, anon, authenticated;

do $$
begin
  grant execute on function public.record_payout_cycle_result(uuid, timestamptz, text, jsonb) to service_role;
  grant execute on function public.get_payout_operations_status() to service_role;
exception
  when undefined_object then null;
end $$;
