-- Wallet-level recovery session for daily state / reserved-claim reads after WebView cookie loss.
-- Additive only. Does not create runs, consume expeditions, or send/acquire/sign payouts.

create table if not exists public.wallet_recovery_challenges (
  challenge_hash text primary key check (challenge_hash ~ '^[0-9a-f]{64}$'),
  wallet text not null check (pg_catalog.char_length(wallet) between 1 and 80),
  issued_at timestamptz not null,
  expires_at timestamptz not null check (expires_at > issued_at),
  consumed_at timestamptz,
  authorization_fingerprint text check (
    authorization_fingerprint is null or authorization_fingerprint ~ '^[0-9a-f]{64}$'
  ),
  check (
    (consumed_at is null and authorization_fingerprint is null)
    or (consumed_at is not null and authorization_fingerprint is not null)
  )
);

create index if not exists wallet_recovery_challenges_wallet_idx
  on public.wallet_recovery_challenges (wallet, issued_at desc);

create table if not exists public.wallet_recovery_sessions (
  id uuid primary key default gen_random_uuid(),
  wallet_session_hash text not null unique check (wallet_session_hash ~ '^[0-9a-f]{64}$'),
  wallet text not null check (pg_catalog.char_length(wallet) between 1 and 80),
  purpose text not null check (purpose = 'reward/daily-state recovery'),
  created_at timestamptz not null,
  expires_at timestamptz not null check (expires_at > created_at),
  revoked_at timestamptz
);

create index if not exists wallet_recovery_sessions_wallet_idx
  on public.wallet_recovery_sessions (wallet, expires_at desc);

alter table public.wallet_recovery_challenges enable row level security;
alter table public.wallet_recovery_challenges force row level security;
alter table public.wallet_recovery_sessions enable row level security;
alter table public.wallet_recovery_sessions force row level security;

do $$
begin
  grant select, insert, update, delete on public.wallet_recovery_challenges to anon, authenticated;
exception
  when undefined_object then null;
  when insufficient_privilege then null;
end $$;

do $$
begin
  grant select, insert, update, delete on public.wallet_recovery_sessions to anon, authenticated;
exception
  when undefined_object then null;
  when insufficient_privilege then null;
end $$;

create or replace function public.create_wallet_recovery_challenge(
  p_wallet text,
  p_challenge_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_now timestamptz := pg_catalog.date_trunc('milliseconds', pg_catalog.timezone('utc', pg_catalog.now()));
  v_day date := v_now::date;
  v_expires_at timestamptz;
begin
  if p_wallet is null or pg_catalog.char_length(p_wallet) = 0 or pg_catalog.char_length(p_wallet) > 80 then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'INVALID_WALLET');
  end if;
  if p_challenge_hash is null or p_challenge_hash !~ '^[0-9a-f]{64}$' then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'RECOVERY_CHALLENGE_INVALID');
  end if;

  v_expires_at := least(v_now + pg_catalog.interval '5 minutes', public.next_utc_reset_at(v_day));
  insert into public.wallet_recovery_challenges (
    challenge_hash,
    wallet,
    issued_at,
    expires_at
  ) values (
    p_challenge_hash,
    p_wallet,
    v_now,
    v_expires_at
  );

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'wallet', p_wallet,
    'issued_at', v_now,
    'expires_at', v_expires_at,
    'purpose', 'reward/daily-state recovery'
  );
end;
$$;

create or replace function public.consume_wallet_recovery_challenge(
  p_challenge_hash text,
  p_authorization_fingerprint text,
  p_wallet text,
  p_issued_at timestamptz,
  p_expires_at timestamptz,
  p_wallet_session_hash text,
  p_session_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_now timestamptz := pg_catalog.timezone('utc', pg_catalog.now());
  v_challenge public.wallet_recovery_challenges%rowtype;
  v_session public.wallet_recovery_sessions%rowtype;
begin
  if p_challenge_hash is null or p_challenge_hash !~ '^[0-9a-f]{64}$'
    or p_authorization_fingerprint is null or p_authorization_fingerprint !~ '^[0-9a-f]{64}$'
    or p_wallet is null or pg_catalog.char_length(p_wallet) = 0
    or p_wallet_session_hash is null or p_wallet_session_hash !~ '^[0-9a-f]{64}$' then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'RECOVERY_CHALLENGE_INVALID');
  end if;

  select * into v_challenge
  from public.wallet_recovery_challenges
  where challenge_hash = p_challenge_hash
  for update;

  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'RECOVERY_CHALLENGE_INVALID');
  end if;

  if v_challenge.consumed_at is not null then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'RECOVERY_CHALLENGE_INVALID');
  end if;

  if v_now >= v_challenge.expires_at then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'RECOVERY_CHALLENGE_EXPIRED');
  end if;

  if v_challenge.wallet is distinct from p_wallet
    or pg_catalog.date_trunc('milliseconds', v_challenge.issued_at)
      is distinct from pg_catalog.date_trunc('milliseconds', p_issued_at)
    or pg_catalog.date_trunc('milliseconds', v_challenge.expires_at)
      is distinct from pg_catalog.date_trunc('milliseconds', p_expires_at) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'RECOVERY_CHALLENGE_INVALID');
  end if;

  update public.wallet_recovery_challenges
  set consumed_at = v_now,
      authorization_fingerprint = p_authorization_fingerprint
  where challenge_hash = p_challenge_hash;

  insert into public.wallet_recovery_sessions (
    wallet_session_hash,
    wallet,
    purpose,
    created_at,
    expires_at
  ) values (
    p_wallet_session_hash,
    p_wallet,
    'reward/daily-state recovery',
    v_now,
    p_session_expires_at
  )
  returning * into v_session;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'session_hash', v_session.wallet_session_hash,
    'wallet', v_session.wallet,
    'purpose', v_session.purpose,
    'created_at', v_session.created_at,
    'expires_at', v_session.expires_at,
    'revoked_at', v_session.revoked_at
  );
end;
$$;

create or replace function public.get_wallet_recovery_session(
  p_wallet_session_hash text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_session public.wallet_recovery_sessions%rowtype;
begin
  if p_wallet_session_hash is null or p_wallet_session_hash !~ '^[0-9a-f]{64}$' then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'INVALID_SESSION');
  end if;

  select * into v_session
  from public.wallet_recovery_sessions
  where wallet_session_hash = p_wallet_session_hash;

  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'INVALID_SESSION');
  end if;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'session_hash', v_session.wallet_session_hash,
    'wallet', v_session.wallet,
    'purpose', v_session.purpose,
    'created_at', v_session.created_at,
    'expires_at', v_session.expires_at,
    'revoked_at', v_session.revoked_at
  );
end;
$$;

create or replace function public.get_reserved_reward_claim_for_wallet_session(
  p_wallet_session_hash text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_now timestamptz := pg_catalog.timezone('utc', pg_catalog.now());
  v_day date := v_now::date;
  v_session public.wallet_recovery_sessions%rowtype;
  v_claim public.reward_claims%rowtype;
  v_reserved integer := 0;
begin
  if p_wallet_session_hash is null or pg_catalog.char_length(p_wallet_session_hash) = 0 then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'RUN_SESSION_INVALID');
  end if;

  select * into v_session
  from public.wallet_recovery_sessions
  where wallet_session_hash = p_wallet_session_hash;

  if not found
    or v_session.revoked_at is not null
    or v_now >= v_session.expires_at then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'RUN_SESSION_INVALID');
  end if;

  select * into v_claim
  from public.reward_claims
  where wallet = v_session.wallet
    and status = 'RESERVED'
    and day_key = v_day
  order by finalized_at desc nulls last
  limit 1;

  if not found then
    select * into v_claim
    from public.reward_claims
    where wallet = v_session.wallet
      and status = 'RESERVED'
    order by finalized_at desc nulls last, created_at desc
    limit 1;
  end if;

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

create or replace function public.get_reward_claim_for_wallet_session(
  p_claim_id uuid,
  p_wallet_session_hash text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_now timestamptz := pg_catalog.timezone('utc', pg_catalog.now());
  v_session public.wallet_recovery_sessions%rowtype;
  v_claim public.reward_claims%rowtype;
  v_reserved integer := 0;
begin
  if p_wallet_session_hash is null or pg_catalog.char_length(p_wallet_session_hash) = 0 then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'RUN_SESSION_INVALID');
  end if;

  select * into v_session
  from public.wallet_recovery_sessions
  where wallet_session_hash = p_wallet_session_hash;

  if not found
    or v_session.revoked_at is not null
    or v_now >= v_session.expires_at then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'RUN_SESSION_INVALID');
  end if;

  select * into v_claim
  from public.reward_claims
  where claim_id = p_claim_id;

  if not found or v_claim.wallet is distinct from v_session.wallet then
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

revoke all on function public.create_wallet_recovery_challenge(text, text) from public, anon, authenticated;
revoke all on function public.consume_wallet_recovery_challenge(text, text, text, timestamptz, timestamptz, text, timestamptz) from public, anon, authenticated;
revoke all on function public.get_wallet_recovery_session(text) from public, anon, authenticated;
revoke all on function public.get_reserved_reward_claim_for_wallet_session(text) from public, anon, authenticated;
revoke all on function public.get_reward_claim_for_wallet_session(uuid, text) from public, anon, authenticated;

do $$
begin
  grant execute on function public.create_wallet_recovery_challenge(text, text) to service_role;
  grant execute on function public.consume_wallet_recovery_challenge(text, text, text, timestamptz, timestamptz, text, timestamptz) to service_role;
  grant execute on function public.get_wallet_recovery_session(text) to service_role;
  grant execute on function public.get_reserved_reward_claim_for_wallet_session(text) to service_role;
  grant execute on function public.get_reward_claim_for_wallet_session(uuid, text) to service_role;
exception
  when undefined_object then null;
end $$;
