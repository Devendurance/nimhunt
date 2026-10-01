import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const sqlDir = join(dirname(fileURLToPath(import.meta.url)), 'sql')
const sql018 = readFileSync(join(sqlDir, '018_reward_week_claim_amount.sql'), 'utf8')
const sql019 = readFileSync(join(sqlDir, '019_remove_legacy_reward_claim_finalize.sql'), 'utf8')
const legacyFinalize = /public\.finalize_reward_claim\(uuid, uuid, text, text, text, text, text, text\)/i
const amountAwareFinalize = /public\.finalize_reward_claim\(uuid, uuid, text, text, text, text, text, text, bigint\)/i

describe('Reward Week claim amount migrations', () => {
  it('keeps the legacy caller compatible while adding the amount-aware path in 018', () => {
    expect(sql018).toMatch(/add column if not exists reward_amount_luna bigint/i)
    expect(sql018).toMatch(/reward_claims_reward_amount_positive/i)
    expect(sql018).toMatch(/new\.reward_amount_luna is distinct from old\.reward_amount_luna/i)
    expect(sql018).toMatch(/p_reward_amount_luna bigint/i)
    expect(sql018).toMatch(/reward_amount_luna = p_reward_amount_luna/i)
    expect(sql018).not.toMatch(/drop function if exists public\.finalize_reward_claim\(uuid, uuid, text, text, text, text, text, text\)/i)
    expect(sql018).toMatch(legacyFinalize)
    expect(sql018).toMatch(amountAwareFinalize)
    expect(sql018).toMatch(/grant execute on function public\.finalize_reward_claim\(uuid, uuid, text, text, text, text, text, text\) to service_role/i)
    expect(sql018).toMatch(/grant execute on function public\.finalize_reward_claim\(uuid, uuid, text, text, text, text, text, text, bigint\) to service_role/i)
  })

  it('removes only the legacy path in 019 and requires the amount-aware path', () => {
    expect(sql019).toMatch(/to_regprocedure\('public\.finalize_reward_claim\(uuid,uuid,text,text,text,text,text,text,bigint\)'\)/i)
    expect(sql019).toMatch(/drop function if exists public\.finalize_reward_claim\(uuid, uuid, text, text, text, text, text, text\)/i)
    expect(sql019).toMatch(amountAwareFinalize)
    expect(sql019).not.toMatch(/drop function if exists public\.finalize_reward_claim\(uuid, uuid, text, text, text, text, text, text, bigint\)/i)
    expect(sql019).toMatch(/legacy_finalize_rpc_remains/i)
  })

  it('does not contain payout execution, treasury, or secret mutation paths', () => {
    expect(sql018).not.toMatch(/private_key|mnemonic|sendBasicTransaction|transfer\s*\(/i)
    expect(sql019).not.toMatch(/private_key|mnemonic|sendBasicTransaction|transfer\s*\(/i)
    expect(sql018).toMatch(/public\.list_unpaid_reserved_claims/i)
  })
})
