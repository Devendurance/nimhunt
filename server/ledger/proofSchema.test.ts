import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const sqlDir = join(dirname(fileURLToPath(import.meta.url)), 'sql')
const migrationPath = join(sqlDir, '002_expedition_proof.sql')
const runtimePath = join(sqlDir, '003_expedition_proof_runtime.sql')
const claimPath = join(sqlDir, '004_reward_claims.sql')
const payoutPath = join(sqlDir, '005_reward_payouts.sql')
const recoveryPath = join(sqlDir, '006_reward_claim_session_recovery.sql')
const walletRecoveryPath = join(sqlDir, '007_wallet_recovery_session.sql')

describe('durable expedition proof migration', () => {
  const migration = readFileSync(migrationPath, 'utf8')
  const executable = migration.replace(/--.*$/gm, '')

  it('defines immutable blueprints, day-bound challenges, run sessions, and initial checkpoints', () => {
    expect(executable).toMatch(/daily_expedition_blueprints/)
    expect(executable).toMatch(/blueprint_lifecycle/)
    expect(executable).toMatch(/canonical_blueprint/)
    expect(executable).toMatch(/blueprint_hash/)
    expect(executable).toMatch(/expedition_start_challenges/)
    expect(executable).toMatch(/challenge_hash/)
    expect(executable).toMatch(/day_key/)
    expect(executable).toMatch(/run_sessions/)
    expect(executable).toMatch(/run_session_hash/)
    expect(executable).toMatch(/initial_checkpoint_hash/)
    expect(executable).toMatch(/start_expedition_authorized/)
  })

  it('enforces published lifecycle and service-only security boundaries', () => {
    expect(executable).toMatch(/unique index[^;]+lifecycle\s*=\s*'PUBLISHED'/is)
    expect(executable).toMatch(/PUBLISHED.*RETIRED/is)
    expect(executable).toMatch(/security definer/i)
    expect(executable).toMatch(/set search_path\s*=\s*pg_catalog\s*,\s*public/i)
    expect(executable).toMatch(/revoke all on function/i)
    expect(executable).toMatch(/grant execute[^;]+service_role/is)
    expect(executable).not.toMatch(/payout|treasury|private_key|seed|transfer|reward_amount/i)
  })
})

describe('durable expedition proof runtime migration', () => {
  const migration = readFileSync(runtimePath, 'utf8')
  const executable = migration.replace(/--.*$/gm, '')

  it('persists checkpoint batches, verification terminal, and one vault seal per run', () => {
    expect(executable).toMatch(/expedition_checkpoint_batches/)
    expect(executable).toMatch(/seq_start/)
    expect(executable).toMatch(/previous_checkpoint_hash/)
    expect(executable).toMatch(/batch_fingerprint/)
    expect(executable).toMatch(/gameplay_started_at/)
    expect(executable).toMatch(/trusted_final_summary/)
    expect(executable).toMatch(/expedition_vault_seals/)
    expect(executable).toMatch(/vault_seal_hash/)
    expect(executable).toMatch(/append_checkpoint_batch/)
    expect(executable).toMatch(/persist_run_terminal/)
    expect(executable).toMatch(/persist_vault_seal/)
    expect(executable).toMatch(/start_expedition_authorized/)
  })

  it('locks proof tables behind RLS and service-only SECURITY DEFINER RPCs', () => {
    expect(executable).toMatch(/force row level security/i)
    expect(executable).toMatch(/security definer/i)
    expect(executable).toMatch(/set search_path\s*=\s*pg_catalog\s*,\s*public/i)
    expect(executable).toMatch(/revoke all on function/i)
    expect(executable).toMatch(/grant execute[^;]+service_role/is)
    expect(executable).toMatch(/revoke all on function public.append_checkpoint_batch/i)
    expect(executable).not.toMatch(/payout|treasury|private_key|seed|transfer|reward_amount/i)
  })
})

describe('signed reward claim migration', () => {
  const migration = readFileSync(claimPath, 'utf8')
  const executable = migration.replace(/--.*$/gm, '')

  it('creates one durable claim per run with signed reservation lifecycle', () => {
    expect(executable).toMatch(/reward_claims/)
    expect(executable).toMatch(/claim_id/)
    expect(executable).toMatch(/canonical_payload/)
    expect(executable).toMatch(/claim_payload_hash/)
    expect(executable).toMatch(/PREPARED/)
    expect(executable).toMatch(/RESERVED/)
    expect(executable).toMatch(/SOLD_OUT/)
    expect(executable).toMatch(/ALREADY_REWARDED/)
    expect(executable).toMatch(/EXPIRED/)
    expect(executable).toMatch(/prepare_reward_claim/)
    expect(executable).toMatch(/finalize_reward_claim/)
    expect(executable).toMatch(/get_reserved_reward_claim_for_session/)
    expect(executable).toMatch(/reserved_slots < 69/)
  })

  it('locks claims behind RLS and service-only SECURITY DEFINER RPCs', () => {
    expect(executable).toMatch(/force row level security/i)
    expect(executable).toMatch(/security definer/i)
    expect(executable).toMatch(/set search_path\s*=\s*pg_catalog\s*,\s*public/i)
    expect(executable).toMatch(/revoke all on function public.prepare_reward_claim/i)
    expect(executable).toMatch(/revoke all on function public.finalize_reward_claim/i)
    expect(executable).toMatch(/grant execute[^;]+service_role/is)
    expect(executable).not.toMatch(/payout|treasury|private_key|seed|transfer|reward_amount/i)
  })
})

describe('reward payout migration', () => {
  const migration = readFileSync(payoutPath, 'utf8')
  const executable = migration.replace(/--.*$/gm, '')

  it('keeps payouts separate from gameplay proof with a strict lifecycle', () => {
    expect(executable).toMatch(/reward_payouts/)
    expect(executable).toMatch(/claim_id uuid not null unique/)
    expect(executable).toMatch(/amount_luna bigint not null/)
    expect(executable).toMatch(/PENDING/)
    expect(executable).toMatch(/PROCESSING/)
    expect(executable).toMatch(/SUBMITTED/)
    expect(executable).toMatch(/CONFIRMED/)
    expect(executable).toMatch(/FAILED_RETRYABLE/)
    expect(executable).toMatch(/FAILED_FINAL/)
    expect(executable).toMatch(/for update skip locked/i)
    expect(executable).toMatch(/create_reward_payout/)
    expect(executable).toMatch(/acquire_reward_payout/)
    expect(executable).not.toMatch(/private_key|mnemonic|seed/i)
  })

  it('locks payouts behind RLS and service-only SECURITY DEFINER RPCs', () => {
    expect(executable).toMatch(/force row level security/i)
    expect(executable).toMatch(/security definer/i)
    expect(executable).toMatch(/set search_path\s*=\s*pg_catalog\s*,\s*public/i)
    expect(executable).toMatch(/revoke all on function public.create_reward_payout/i)
    expect(executable).toMatch(/revoke all on function public.acquire_reward_payout/i)
    expect(executable).toMatch(/grant execute[^;]+service_role/is)
  })
})

describe('reserved claim session recovery migration', () => {
  const migration = readFileSync(recoveryPath, 'utf8')
  const executable = migration.replace(/--.*$/gm, '')

  it('adds only the session-bound reserved claim locator', () => {
    expect(executable).toMatch(/get_reserved_reward_claim_for_session/)
    expect(executable).toMatch(/p_run_session_hash/)
    expect(executable).toMatch(/status = 'RESERVED'/)
    expect(executable).toMatch(/run_id = v_session\.run_id/)
    expect(executable).not.toMatch(/create table|alter table|create type/i)
    expect(executable).not.toMatch(/create_reward_payout|acquire_reward_payout|mark_reward_payout/i)
    expect(executable).not.toMatch(/private_key|mnemonic|seed|treasury/i)
  })

  it('locks the recovery helper behind service-only SECURITY DEFINER', () => {
    expect(executable).toMatch(/security definer/i)
    expect(executable).toMatch(/set search_path\s*=\s*pg_catalog\s*,\s*public/i)
    expect(executable).toMatch(/revoke all on function public.get_reserved_reward_claim_for_session/i)
    expect(executable).toMatch(/grant execute[^;]+service_role/is)
    expect(executable).not.toMatch(/grant execute[^;]+anon/is)
    expect(executable).not.toMatch(/grant execute[^;]+authenticated/is)
  })
})

describe('wallet recovery session migration', () => {
  const migration = readFileSync(walletRecoveryPath, 'utf8')
  const executable = migration.replace(/--.*$/gm, '')

  it('adds a separate wallet recovery challenge and session, not a run session', () => {
    expect(executable).toMatch(/wallet_recovery_challenges/)
    expect(executable).toMatch(/wallet_recovery_sessions/)
    expect(executable).toMatch(/reward\/daily-state recovery/)
    expect(executable).toMatch(/create_wallet_recovery_challenge/)
    expect(executable).toMatch(/consume_wallet_recovery_challenge/)
    expect(executable).toMatch(/date_trunc\('milliseconds'/)
    expect(executable).toMatch(/get_wallet_recovery_session/)
    expect(executable).toMatch(/get_reserved_reward_claim_for_wallet_session/)
    expect(executable).not.toMatch(/create_reward_payout|acquire_reward_payout|mark_reward_payout/i)
    expect(executable).not.toMatch(/private_key|mnemonic|seed|treasury/i)
    expect(executable).not.toMatch(/insert into public\.expedition_runs/i)
  })

  it('locks wallet recovery behind service-only SECURITY DEFINER', () => {
    expect(executable).toMatch(/security definer/i)
    expect(executable).toMatch(/set search_path\s*=\s*pg_catalog\s*,\s*public/i)
    expect(executable).toMatch(/revoke all on function public.create_wallet_recovery_challenge/i)
    expect(executable).toMatch(/revoke all on function public.consume_wallet_recovery_challenge/i)
    expect(executable).toMatch(/grant execute[^;]+service_role/is)
    expect(executable).not.toMatch(/grant execute[^;]+anon/is)
    expect(executable).not.toMatch(/grant execute[^;]+authenticated/is)
  })
})
