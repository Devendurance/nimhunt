import { describe, expect, it } from 'vitest'
import {
  buildVaultSealPayload,
  isCanonicalVaultSeal,
  parseVaultSealJson,
  serializeVaultSeal,
  tamperVaultSealMission,
  VAULT_SEAL_MISSION,
  VAULT_SEAL_OBJECTIVE,
  VAULT_SEAL_ROOM,
  VAULT_SEAL_TYPE,
  VAULT_SEAL_WORLD,
} from './vaultSeal.ts'

const WALLET = 'NQ07 TEST 0000 0000 0000 0000 0000 0000 0000'

describe('Vault seal preview payload', () => {
  it('serializes to the exact canonical preview string', () => {
    expect(serializeVaultSeal(buildVaultSealPayload(WALLET))).toBe(`{
  "version": 1,
  "type": "NIMHUNT_VAULT_SEAL_PREVIEW",
  "wallet": "${WALLET}",
  "mission": "VAULT_BREAKER",
  "world": "ANGKOR_RUINS",
  "room": "ROOM_01",
  "objective": "TEMPLE_VAULT",
  "environment": "development"
}`)
  })

  it('is deterministic and carries no reward fields', () => {
    const first = serializeVaultSeal(buildVaultSealPayload(WALLET))
    const second = serializeVaultSeal(buildVaultSealPayload(WALLET))
    expect(first).toBe(second)
    expect(first).not.toMatch(/amount|reward|nonce|tx|payout/i)
    expect(VAULT_SEAL_TYPE).toBe('NIMHUNT_VAULT_SEAL_PREVIEW')
    expect([VAULT_SEAL_MISSION, VAULT_SEAL_WORLD, VAULT_SEAL_ROOM, VAULT_SEAL_OBJECTIVE]).toEqual([
      'VAULT_BREAKER',
      'ANGKOR_RUINS',
      'ROOM_01',
      'TEMPLE_VAULT',
    ])
  })

  it('round-trips through strict parsing', () => {
    const payload = serializeVaultSeal(buildVaultSealPayload(WALLET))
    const parsed = parseVaultSealJson(payload)
    expect(parsed).not.toBe(null)
    expect(parsed?.wallet).toBe(WALLET)
    expect(isCanonicalVaultSeal(payload, parsed!)).toBe(true)
  })

  it('rejects mistyped and malformed payloads, and detects content tampering by signature', () => {
    const payload = serializeVaultSeal(buildVaultSealPayload(WALLET))
    // String-level tampering keeps canonical formatting, so parsing still
    // succeeds: only the Nimiq signature check can detect the content change.
    const tampered = tamperVaultSealMission(payload)
    expect(tampered).not.toBe(payload)
    const parsedTampered = parseVaultSealJson(tampered)
    expect(parsedTampered?.mission).toBe('GEM_RUNNER')
    expect(isCanonicalVaultSeal(tampered, parsedTampered!)).toBe(true)
    expect(parseVaultSealJson(payload.replace('NIMHUNT_VAULT_SEAL_PREVIEW', 'NIMHUNT_TEST_SEAL'))).toBe(null)
    expect(parseVaultSealJson('{')).toBe(null)
    expect(isCanonicalVaultSeal(payload.replaceAll('\n', ''), parseVaultSealJson(payload)!)).toBe(false)
  })
})
