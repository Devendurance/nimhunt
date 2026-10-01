import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'sql', '018_reward_week_claim_amount.sql'), 'utf8')

describe('Reward Week claim amount migration', () => {
  it('adds a positive immutable claim amount and the new finalize signature', () => {
    expect(sql).toMatch(/add column if not exists reward_amount_luna bigint/i)
    expect(sql).toMatch(/reward_claims_reward_amount_positive/i)
    expect(sql).toMatch(/new\.reward_amount_luna is distinct from old\.reward_amount_luna/i)
    expect(sql).toMatch(/p_reward_amount_luna bigint/i)
    expect(sql).toMatch(/reward_amount_luna = p_reward_amount_luna/i)
    expect(sql).toMatch(/drop function if exists public\.finalize_reward_claim\(uuid, uuid, text, text, text, text, text, text\)/i)
    expect(sql).toMatch(/grant execute on function public\.finalize_reward_claim\(uuid, uuid, text, text, text, text, text, text, bigint\)/i)
  })

  it('does not contain payout execution, treasury, or secret mutation paths', () => {
    expect(sql).not.toMatch(/private_key|mnemonic|sendBasicTransaction|transfer\s*\(/i)
    expect(sql).toMatch(/public\.list_unpaid_reserved_claims/i)
  })
})
