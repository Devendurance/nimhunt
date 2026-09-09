import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const migrationPath = join(dirname(fileURLToPath(import.meta.url)), 'sql', '002_expedition_proof.sql')

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
