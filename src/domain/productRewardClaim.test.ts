import { describe, expect, it } from 'vitest'
import {
  isCanonicalProductRewardClaim,
  parseProductRewardClaim,
  PRODUCT_REWARD_CLAIM_TYPE,
  serializeProductRewardClaim,
  type ProductRewardClaimPayload,
} from './productRewardClaim.ts'

const WALLET = 'NQ07 33E4 6T32 24Y7 X4BA 7SP2 27TX 32PL 54JG'
const HASH = 'ab'.repeat(32)
const CLAIM_ID = '2f1c0a6e-4b8d-4c91-9f0a-7d3e1b5c8a22'
const RUN_ID = '7a4d21c0-9e12-4b88-a1f0-3c6d8e9b0123'

function gemPayload(mission: 'gem-runner' | 'chest-hunter' = 'gem-runner'): ProductRewardClaimPayload {
  return {
    version: 1,
    type: PRODUCT_REWARD_CLAIM_TYPE,
    claimId: CLAIM_ID,
    wallet: WALLET,
    runId: RUN_ID,
    mission,
    dayKey: '2026-09-09',
    runChallenge: 'cd'.repeat(32),
    rulesVersion: 'nimhunt-rules-v1',
    roomVersion: 'angkor-room-01-v1',
    blueprintVersion: 'angkor-blueprint-v1',
    blueprintId: 'angkor-room-01-gem',
    blueprintHash: HASH,
    transcriptHash: 'ef'.repeat(32),
  }
}

function vaultPayload(changes: Partial<Extract<ProductRewardClaimPayload, { mission: 'vault-breaker' }>> = {}) {
  return {
    version: 1 as const,
    type: PRODUCT_REWARD_CLAIM_TYPE,
    claimId: CLAIM_ID,
    wallet: WALLET,
    runId: RUN_ID,
    mission: 'vault-breaker' as const,
    dayKey: '2026-09-09',
    runChallenge: 'cd'.repeat(32),
    rulesVersion: 'nimhunt-rules-v1',
    roomVersion: 'angkor-room-01-v1',
    blueprintVersion: 'angkor-blueprint-v1',
    blueprintId: 'angkor-room-01-vault',
    blueprintHash: HASH,
    transcriptHash: 'ef'.repeat(32),
    vaultSealHash: '11'.repeat(32),
    ...changes,
  }
}

describe('product reward claim payload', () => {
  it('serializes the exact canonical Gem Runner string without vaultSealHash', () => {
    expect(serializeProductRewardClaim(gemPayload())).toBe(`{
  "version": 1,
  "type": "NIMHUNT_REWARD_CLAIM_V1",
  "claimId": "${CLAIM_ID}",
  "wallet": "${WALLET}",
  "runId": "${RUN_ID}",
  "mission": "gem-runner",
  "dayKey": "2026-09-09",
  "runChallenge": "${'cd'.repeat(32)}",
  "rulesVersion": "nimhunt-rules-v1",
  "roomVersion": "angkor-room-01-v1",
  "blueprintVersion": "angkor-blueprint-v1",
  "blueprintId": "angkor-room-01-gem",
  "blueprintHash": "${HASH}",
  "transcriptHash": "${'ef'.repeat(32)}"
}`)
  })

  it('is deterministic and includes vaultSealHash only for Vault', () => {
    expect(serializeProductRewardClaim(gemPayload())).toBe(serializeProductRewardClaim(gemPayload()))
    expect(serializeProductRewardClaim(gemPayload())).not.toContain('vaultSealHash')
    expect(serializeProductRewardClaim(vaultPayload())).toContain('"vaultSealHash":')
    expect(serializeProductRewardClaim(gemPayload())).not.toMatch(/"amount"|"rewardAmount"|"payout"|"nonce"/i)
  })

  it('round-trips Gem, Chest, and Vault through the strict parser', () => {
    for (const payload of [gemPayload(), gemPayload('chest-hunter'), vaultPayload()]) {
      const canonical = serializeProductRewardClaim(payload)
      const parsed = parseProductRewardClaim(canonical)
      expect(parsed).toEqual(payload)
      expect(isCanonicalProductRewardClaim(canonical, parsed!)).toBe(true)
    }
  })

  it('rejects client-supplied null vaultSealHash, extra fields, and compact JSON', () => {
    const gem = serializeProductRewardClaim(gemPayload())
    expect(parseProductRewardClaim(gem.replace('\n}', ',\n  "vaultSealHash": null\n}'))).toBe(null)
    expect(parseProductRewardClaim(gem.replaceAll('\n', ''))).toBe(null)
    const vault = serializeProductRewardClaim(vaultPayload())
    const withoutSeal = vault.split('\n').filter(line => !line.includes('vaultSealHash')).join('\n').replace(',\n}', '\n}')
    expect(parseProductRewardClaim(withoutSeal)).toBe(null)
    expect(parseProductRewardClaim(vault.replace('NIMHUNT_REWARD_CLAIM_V1', 'NIMHUNT_REWARD_CLAIM'))).toBe(null)
  })
})
