import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  LEGACY_MAX_CHECKPOINT_BATCH_ACTIONS,
  MAX_CHECKPOINT_BATCH_ACTIONS,
  V2_MAX_CHECKPOINT_BATCH_ACTIONS,
  maxCheckpointBatchActionsFor,
} from '../../src/game/replay/versions.ts'

const sqlDir = join(dirname(fileURLToPath(import.meta.url)), 'sql')
const sql020 = readFileSync(join(sqlDir, '020_angkor_v2_expeditions.sql'), 'utf8')
const sql021 = readFileSync(join(sqlDir, '021_permanent_seven_treasures.sql'), 'utf8')
const sql022 = readFileSync(join(sqlDir, '022_v2_checkpoint_throughput.sql'), 'utf8')
const executable = sql022.replace(/--.*$/gm, '')

describe('V2 checkpoint throughput migration 022', () => {
  it('keeps the legacy 8-action constant distinct from the V2 64-action ceiling', () => {
    expect(LEGACY_MAX_CHECKPOINT_BATCH_ACTIONS).toBe(8)
    expect(MAX_CHECKPOINT_BATCH_ACTIONS).toBe(8)
    expect(V2_MAX_CHECKPOINT_BATCH_ACTIONS).toBe(64)
    expect(maxCheckpointBatchActionsFor({
      rulesVersion: 'nimhunt-rules-v1',
      roomVersion: 'angkor-room-01-v1',
      blueprintVersion: 'angkor-blueprint-v1',
    })).toBe(8)
    expect(maxCheckpointBatchActionsFor({
      rulesVersion: 'nimhunt-angkor-v2-rules-v1',
      roomVersion: 'angkor-nine-stages-v1',
      blueprintVersion: 'angkor-expedition-blueprint-v1',
    })).toBe(64)
    expect(maxCheckpointBatchActionsFor({
      rulesVersion: 'nimhunt-angkor-v2-rules-v1',
      roomVersion: 'angkor-room-01-v1',
      blueprintVersion: 'angkor-expedition-blueprint-v1',
    })).toBe(8)
  })

  it('replaces append_checkpoint_batch with version-scoped 1..64 / 1..8 limits and no row rewrite', () => {
    expect(executable).toMatch(/create or replace function public\.append_checkpoint_batch\(/i)
    expect(executable).toMatch(/p_run_id uuid/)
    expect(executable).toMatch(/p_run_session_hash text/)
    expect(executable).toMatch(/then 64/)
    expect(executable).toMatch(/else 8/)
    expect(executable).toMatch(/expedition_checkpoint_batches_batch_size_check/)
    expect(executable).toMatch(/seq_end - seq_start \+ 1 <= 64/)
    expect(executable).toMatch(/nimhunt-angkor-v2-rules-v1/)
    expect(executable).toMatch(/angkor-nine-stages-v1/)
    expect(executable).toMatch(/angkor-expedition-blueprint-v1/)
    expect(executable).toMatch(/then 30000/)
    expect(executable).toMatch(/else 256 end/)
    expect(executable).not.toMatch(/update public\.expedition_checkpoint_batches\s+set/i)
    expect(executable).not.toMatch(/delete from public\.expedition_checkpoint_batches/i)
    expect(executable).not.toMatch(/update public\.expedition_runs\s+set rules_version/i)
    expect(executable).not.toMatch(/private_key|mnemonic|seed|treasury|payout/i)
    expect(sql022).not.toMatch(/021_permanent/)
    expect(sql021).not.toMatch(/append_checkpoint_batch/)
    expect(sql020).toMatch(/v_action_count > 8/)
  })
})
