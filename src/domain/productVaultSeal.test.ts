import { describe, expect, it } from 'vitest'
import {
  isCanonicalProductVaultSeal,
  parseProductVaultSeal,
  PRODUCT_VAULT_SEAL_OBJECTIVE,
  PRODUCT_VAULT_SEAL_ROOM,
  PRODUCT_VAULT_SEAL_TYPE,
  PRODUCT_VAULT_SEAL_WORLD,
  serializeProductVaultSeal,
  type ProductVaultSealPayload,
} from './productVaultSeal.ts'
import { VAULT_SEAL_TYPE } from './vaultSeal.ts'

const WALLET = 'NQ07 33E4 6T32 24Y7 X4BA 7SP2 27TX 32PL 54JG'
const HASH = 'ab'.repeat(32)

function payload(changes: Partial<ProductVaultSealPayload> = {}): ProductVaultSealPayload {
  return {
    version: 1,
    type: PRODUCT_VAULT_SEAL_TYPE,
    wallet: WALLET,
    runId: '2f1c0a6e-4b8d-4c91-9f0a-7d3e1b5c8a22',
    mission: 'vault-breaker',
    world: PRODUCT_VAULT_SEAL_WORLD,
    room: PRODUCT_VAULT_SEAL_ROOM,
    objective: PRODUCT_VAULT_SEAL_OBJECTIVE,
    runChallenge: 'cd'.repeat(32),
    rulesVersion: 'nimhunt-rules-v1',
    roomVersion: 'angkor-room-01-v1',
    blueprintVersion: 'angkor-blueprint-v1',
    blueprintId: 'angkor-room-01-vault',
    blueprintHash: HASH,
    vaultCheckpointHash: 'ef'.repeat(32),
    ...changes,
  }
}

describe('product Vault seal payload', () => {
  it('serializes to the exact canonical product string', () => {
    expect(serializeProductVaultSeal(payload())).toBe(`{
  "version": 1,
  "type": "NIMHUNT_VAULT_SEAL_V1",
  "wallet": "${WALLET}",
  "runId": "2f1c0a6e-4b8d-4c91-9f0a-7d3e1b5c8a22",
  "mission": "vault-breaker",
  "world": "ANGKOR_RUINS",
  "room": "ROOM_01",
  "objective": "TEMPLE_VAULT",
  "runChallenge": "${'cd'.repeat(32)}",
  "rulesVersion": "nimhunt-rules-v1",
  "roomVersion": "angkor-room-01-v1",
  "blueprintVersion": "angkor-blueprint-v1",
  "blueprintId": "angkor-room-01-vault",
  "blueprintHash": "${HASH}",
  "vaultCheckpointHash": "${'ef'.repeat(32)}"
}`)
  })

  it('is deterministic, stable, and distinct from the preview seal', () => {
    const first = serializeProductVaultSeal(payload())
    const second = serializeProductVaultSeal(payload())
    expect(first).toBe(second)
    expect(PRODUCT_VAULT_SEAL_TYPE).toBe('NIMHUNT_VAULT_SEAL_V1')
    expect(VAULT_SEAL_TYPE).toBe('NIMHUNT_VAULT_SEAL_PREVIEW')
    expect(first).not.toContain('NIMHUNT_VAULT_SEAL_PREVIEW')
    expect(first).not.toMatch(/"amount"|"reward"|"nonce"|"payout"|"environment"/i)
  })

  it('round-trips through the strict parser', () => {
    const canonical = serializeProductVaultSeal(payload())
    const parsed = parseProductVaultSeal(canonical)
    expect(parsed).toEqual(payload())
    expect(isCanonicalProductVaultSeal(canonical, parsed!)).toBe(true)
  })

  it('rejects preview type, extra fields, and non-canonical formatting', () => {
    const canonical = serializeProductVaultSeal(payload())
    expect(parseProductVaultSeal(canonical.replace('NIMHUNT_VAULT_SEAL_V1', 'NIMHUNT_VAULT_SEAL_PREVIEW'))).toBe(null)
    expect(parseProductVaultSeal(canonical.replace('vault-breaker', 'gem-runner'))).toBe(null)
    expect(parseProductVaultSeal(canonical.replaceAll('\n', ''))).toBe(null)
    expect(parseProductVaultSeal('{')).toBe(null)
    expect(parseProductVaultSeal(`${canonical.slice(0, -1)},\n  "reward": true\n}`)).toBe(null)
  })
})
