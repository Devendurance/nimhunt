-- Angkor V2 additive publication and version-scoped action admission.
-- OWNER RELEASE ACTION ONLY. No historical blueprint/run/claim JSON is rewritten.
-- Apply transactionally before V2 application release. Old app lookup stays legacy-only.
begin;
drop index public.daily_expedition_blueprints_active_idx;
create unique index daily_expedition_blueprints_active_idx
  on public.daily_expedition_blueprints(day_key, mission_type, rules_version)
  where lifecycle = 'PUBLISHED';

create or replace function public.get_published_blueprint(p_day_key date, p_mission_type text)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_blueprint public.daily_expedition_blueprints%rowtype;
begin
  if p_mission_type is null or p_mission_type not in ('gem-runner', 'chest-hunter', 'vault-breaker') then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'DAILY_BLUEPRINT_UNAVAILABLE');
  end if;

  select * into v_blueprint
  from public.daily_expedition_blueprints
  where day_key = p_day_key
    and mission_type = p_mission_type
    and lifecycle = 'PUBLISHED'
    and rules_version = 'nimhunt-rules-v1';

  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'DAILY_BLUEPRINT_UNAVAILABLE');
  end if;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'blueprint', v_blueprint.canonical_blueprint,
    'blueprint_id', v_blueprint.blueprint_id,
    'blueprint_hash', v_blueprint.blueprint_hash,
    'day_key', v_blueprint.day_key,
    'rules_version', v_blueprint.rules_version,
    'room_version', v_blueprint.room_version,
    'blueprint_version', v_blueprint.blueprint_version
  );
end;
$$;

create or replace function public.get_published_angkor_v2_blueprint(p_day_key date, p_mission_type text)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_blueprint public.daily_expedition_blueprints%rowtype;
begin
  if p_mission_type is null or p_mission_type not in ('gem-runner', 'chest-hunter', 'vault-breaker') then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'DAILY_BLUEPRINT_UNAVAILABLE');
  end if;

  select * into v_blueprint
  from public.daily_expedition_blueprints
  where day_key = p_day_key
    and mission_type = p_mission_type
    and lifecycle = 'PUBLISHED'
    and rules_version = 'nimhunt-angkor-v2-rules-v1'
    and room_version = 'angkor-nine-stages-v1'
    and blueprint_version = 'angkor-expedition-blueprint-v1';

  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'DAILY_BLUEPRINT_UNAVAILABLE');
  end if;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'blueprint', v_blueprint.canonical_blueprint,
    'blueprint_id', v_blueprint.blueprint_id,
    'blueprint_hash', v_blueprint.blueprint_hash,
    'day_key', v_blueprint.day_key,
    'rules_version', v_blueprint.rules_version,
    'room_version', v_blueprint.room_version,
    'blueprint_version', v_blueprint.blueprint_version
  );
end;
$$;

create or replace function public.append_checkpoint_batch(
  p_run_id uuid,
  p_run_session_hash text,
  p_previous_checkpoint_hash text,
  p_actions jsonb,
  p_seq_start integer,
  p_seq_end integer,
  p_batch_fingerprint text,
  p_transcript_hash text,
  p_state_hash text,
  p_checkpoint_hash text,
  p_replay_snapshot jsonb,
  p_acknowledgement jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_now timestamptz := pg_catalog.timezone('utc', pg_catalog.now());
  v_run public.expedition_runs%rowtype;
  v_session public.run_sessions%rowtype;
  v_existing public.expedition_checkpoint_batches%rowtype;
  v_action_count integer;
begin
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

  if not found or v_run.wallet <> v_session.wallet then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'RUN_SESSION_INVALID');
  end if;

  if v_run.gameplay_started_at is null
    or v_run.status <> 'STARTED'
    or v_run.terminal is not null
    or v_now >= public.next_utc_reset_at(v_run.day_key) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'RUN_NOT_ACTIVE');
  end if;

  select * into v_existing
  from public.expedition_checkpoint_batches
  where run_id = p_run_id
    and previous_checkpoint_hash = p_previous_checkpoint_hash;

  if found then
    if v_existing.actions = p_actions and v_existing.batch_fingerprint = p_batch_fingerprint then
      return pg_catalog.jsonb_build_object('ok', true, 'acknowledgement', v_existing.acknowledgement, 'existing', true);
    end if;
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'CHECKPOINT_MISMATCH');
  end if;

  if p_previous_checkpoint_hash is distinct from v_run.checkpoint_hash then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'CHECKPOINT_MISMATCH');
  end if;

  if p_actions is null or pg_catalog.jsonb_typeof(p_actions) <> 'array' then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'MALFORMED_REQUEST');
  end if;
  v_action_count := pg_catalog.jsonb_array_length(p_actions);
  if v_action_count < 1 or v_action_count > 8 then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'MALFORMED_REQUEST');
  end if;
  if p_seq_start <> v_run.checkpoint_seq + 1 or p_seq_end <> p_seq_start + v_action_count - 1 then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'INVALID_SEQUENCE');
  end if;
  if v_run.checkpoint_seq + v_action_count > (case
    when v_run.rules_version = 'nimhunt-angkor-v2-rules-v1'
      and v_run.room_version = 'angkor-nine-stages-v1'
      and v_run.blueprint_version = 'angkor-expedition-blueprint-v1' then 30000
    else 256 end) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'ACTION_LIMIT_EXCEEDED');
  end if;

  insert into public.expedition_checkpoint_batches (
    run_id,
    seq_start,
    seq_end,
    previous_checkpoint_hash,
    actions,
    batch_fingerprint,
    transcript_hash,
    state_hash,
    checkpoint_hash,
    acknowledgement,
    created_at
  ) values (
    p_run_id,
    p_seq_start,
    p_seq_end,
    p_previous_checkpoint_hash,
    p_actions,
    p_batch_fingerprint,
    p_transcript_hash,
    p_state_hash,
    p_checkpoint_hash,
    p_acknowledgement,
    v_now
  );

  update public.expedition_runs
  set checkpoint_hash = p_checkpoint_hash,
      checkpoint_seq = p_seq_end,
      replay_snapshot = p_replay_snapshot,
      transcript_hash = p_transcript_hash,
      state_hash = p_state_hash,
      last_checkpoint_at = v_now
  where id = p_run_id;

  return pg_catalog.jsonb_build_object('ok', true, 'acknowledgement', p_acknowledgement, 'existing', false);
end;
$$;

revoke all on function public.get_published_angkor_v2_blueprint(date, text) from public, anon, authenticated;
grant execute on function public.get_published_angkor_v2_blueprint(date, text) to service_role;
-- Existing append and legacy lookup signatures/permissions stay unchanged.
commit;
