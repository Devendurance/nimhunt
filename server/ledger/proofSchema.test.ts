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
const riskGatePath = join(sqlDir, '008_reward_risk_gate.sql')
const automationPath = join(sqlDir, '009_automatic_payout_pipeline.sql')
const executionDayPath = join(sqlDir, '010_payout_execution_day.sql')
const schedulerPath = join(sqlDir, '011_payout_scheduler_operations.sql')

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

describe('reward risk gate migration', () => {
  const migration = readFileSync(riskGatePath, 'utf8')
  const executable = migration.replace(/--.*$/gm, '')

  it('persists hashed install signals and one assessment per run', () => {
    expect(executable).toMatch(/reward_risk_assessments/)
    expect(executable).toMatch(/assessment_id/)
    expect(executable).toMatch(/run_id uuid not null unique/)
    expect(executable).toMatch(/install_id_hash/)
    expect(executable).toMatch(/PASS/)
    expect(executable).toMatch(/REVIEW/)
    expect(executable).toMatch(/BLOCK/)
    expect(executable).toMatch(/reason_codes/)
    expect(executable).toMatch(/record_reward_risk_signal/)
    expect(executable).toMatch(/upsert_reward_risk_assessment/)
    expect(executable).not.toMatch(/user_agent|userAgent|fingerprint|raw_ip|ip_address/i)
  })

  it('locks risk tables behind RLS and service-only SECURITY DEFINER RPCs', () => {
    expect(executable).toMatch(/force row level security/i)
    expect(executable).toMatch(/security definer/i)
    expect(executable).toMatch(/set search_path\s*=\s*pg_catalog\s*,\s*public/i)
    expect(executable).toMatch(/revoke all on function public.record_reward_risk_signal/i)
    expect(executable).toMatch(/revoke all on function public.upsert_reward_risk_assessment/i)
    expect(executable).toMatch(/grant execute[^;]+service_role/is)
    expect(executable).not.toMatch(/grant execute[^;]+anon/is)
    expect(executable).not.toMatch(/grant execute[^;]+authenticated/is)
  })
})

describe('automatic payout pipeline migration', () => {
  const migration = readFileSync(automationPath, 'utf8')
  const executable = migration.replace(/--.*$/gm, '')

  it('adds a default-off kill switch and PASS-only automated acquire', () => {
    expect(executable).toMatch(/payout_automation_control/)
    expect(executable).toMatch(/automatic_payouts_enabled boolean not null default false/)
    expect(executable).toMatch(/acquire_automated_reward_payout/)
    expect(executable).toMatch(/a\.result = 'PASS'/)
    expect(executable).toMatch(/DAILY_CAP_REACHED/)
    expect(executable).toMatch(/TREASURY_LOW/)
    expect(executable).toMatch(/AUTOMATION_DISABLED/)
    expect(executable).toMatch(/for update of p skip locked/i)
    expect(executable).not.toMatch(/private_key|mnemonic|seed/i)
  })

  it('locks automation control behind RLS and service-only SECURITY DEFINER RPCs', () => {
    expect(executable).toMatch(/force row level security/i)
    expect(executable).toMatch(/security definer/i)
    expect(executable).toMatch(/set search_path\s*=\s*pg_catalog\s*,\s*public/i)
    expect(executable).toMatch(/revoke all on function public.acquire_automated_reward_payout/i)
    expect(executable).toMatch(/revoke all on function public.set_payout_automation_enabled/i)
    expect(executable).toMatch(/grant execute[^;]+service_role/is)
    expect(executable).not.toMatch(/grant execute[^;]+anon/is)
    expect(executable).not.toMatch(/grant execute[^;]+authenticated/is)
  })
})

describe('payout scheduler operations migration', () => {
  const migration = readFileSync(schedulerPath, 'utf8')
  const executable = migration.replace(/--.*$/gm, '')

  it('persists bounded safe cycle metadata and owner aggregate status', () => {
    expect(executable).toMatch(/last_cycle_at timestamptz/)
    expect(executable).toMatch(/last_cycle_id uuid/)
    expect(executable).toMatch(/last_cycle_result text/)
    expect(executable).toMatch(/last_cycle_errors jsonb/)
    expect(executable).toMatch(/record_payout_cycle_result/)
    expect(executable).toMatch(/get_payout_operations_status/)
    expect(executable).toMatch(/pending_count/)
    expect(executable).toMatch(/confirmed_today_count/)
    expect(executable).toMatch(/execution_day_committed_luna/)
    expect(executable).not.toMatch(/private_key|mnemonic|seed/i)
  })

  it('locks scheduler metadata behind service-only SECURITY DEFINER RPCs', () => {
    expect(executable).toMatch(/security definer/i)
    expect(executable).toMatch(/set search_path\s*=\s*pg_catalog\s*,\s*public/i)
    expect(executable).toMatch(/revoke all on function public.record_payout_cycle_result/i)
    expect(executable).toMatch(/revoke all on function public.get_payout_operations_status/i)
    expect(executable).toMatch(/grant execute[^;]+service_role/is)
    expect(executable).not.toMatch(/grant execute[^;]+anon/is)
    expect(executable).not.toMatch(/grant execute[^;]+authenticated/is)
  })
})

describe('payout execution-day migration', () => {
  const migration = readFileSync(executionDayPath, 'utf8')
  const executable = migration.replace(/--.*$/gm, '')

  it('adds execution_day_key, backfills from timestamps, and caps spend on execution day', () => {
    expect(executable).toMatch(/execution_day_key date/)
    expect(executable).toMatch(/coalesce\(submitted_at, confirmed_at, processing_started_at\)/)
    expect(executable).toMatch(/execution_day_key = v_execution_day/)
    expect(executable).toMatch(/where execution_day_key = v_execution_day/)
    expect(executable).toMatch(/get_execution_day_payout_spend/)
    expect(executable).toMatch(/DAILY_CAP_REACHED/)
    expect(executable).not.toMatch(/private_key|mnemonic|seed/i)
  })

  it('locks the spend RPC behind service-only SECURITY DEFINER grants', () => {
    expect(executable).toMatch(/security definer/i)
    expect(executable).toMatch(/set search_path\s*=\s*pg_catalog\s*,\s*public/i)
    expect(executable).toMatch(/revoke all on function public.get_execution_day_payout_spend/i)
    expect(executable).toMatch(/grant execute[^;]+service_role/is)
    expect(executable).not.toMatch(/grant execute[^;]+anon/is)
    expect(executable).not.toMatch(/grant execute[^;]+authenticated/is)
  })
})
