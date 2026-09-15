import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const sqlDir = join(dirname(fileURLToPath(import.meta.url)), 'sql')
const migrationPath = join(sqlDir, '002_expedition_proof.sql')
const runtimePath = join(sqlDir, '003_expedition_proof_runtime.sql')

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
