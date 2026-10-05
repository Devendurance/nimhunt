-- V2 checkpoint throughput. Forward-only. No checkpoint/run rewrite.
-- Exact Angkor V2 version triple may append 1..64 actions; every other run stays 1..8.
-- Safe before application deploy: existing 8-action callers keep working.
begin;
do $$
declare
  v_constraint record;
begin
  for v_constraint in
    select con.conname
    from pg_catalog.pg_constraint con
    inner join pg_catalog.pg_class rel on rel.oid = con.conrelid
    inner join pg_catalog.pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'expedition_checkpoint_batches'
      and con.contype = 'c'
      and pg_catalog.pg_get_constraintdef(con.oid) like '%seq_end%'
      and pg_catalog.pg_get_constraintdef(con.oid) like '%<= 8%'
  loop
    execute format('alter table public.expedition_checkpoint_batches drop constraint %I', v_constraint.conname);
  end loop;
end
$$;
alter table public.expedition_checkpoint_batches drop constraint if exists expedition_checkpoint_batches_batch_size_check;
alter table public.expedition_checkpoint_batches
  add constraint expedition_checkpoint_batches_batch_size_check
  check (seq_end - seq_start + 1 <= 64);
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
  v_max_actions integer;
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
  v_max_actions := case
    when v_run.rules_version = 'nimhunt-angkor-v2-rules-v1'
      and v_run.room_version = 'angkor-nine-stages-v1'
      and v_run.blueprint_version = 'angkor-expedition-blueprint-v1' then 64
    else 8
  end;
  if v_action_count < 1 or v_action_count > v_max_actions then
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
-- Existing append signature and grants stay unchanged.
commit;
