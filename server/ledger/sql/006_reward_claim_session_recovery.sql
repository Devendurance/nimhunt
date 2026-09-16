-- Live-safe session recovery for a reserved reward claim.
-- Additive only. Do not replay 004. No payout send/acquire/sign/reconcile.

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

revoke all on function public.get_reserved_reward_claim_for_session(text) from public, anon, authenticated;

do $$
begin
  grant execute on function public.get_reserved_reward_claim_for_session(text) to service_role;
exception
  when undefined_object then null;
end $$;
