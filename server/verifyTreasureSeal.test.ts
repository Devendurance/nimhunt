import { KeyPair } from '@nimiq/core'
import { describe, expect, it } from 'vitest'
import {
  buildTestTreasureSealPayload,
  serializeTestTreasureSeal,
  serializeTreasureSeal,
  tamperTestSealMission,
} from '../src/domain/treasureSeal.ts'
import { buildVaultSealPayload, serializeVaultSeal, tamperVaultSealMission } from '../src/domain/vaultSeal.ts'
import { nimiqSignedMessageHash, verifyTreasureSeal } from './verifyTreasureSeal.ts'

describe('server-side treasure-seal verification', () => {
  it('accepts a valid official-Nimiq signature fixture', () => {
    const fixture = createTestOnlySeal()
    const result = verifyTreasureSeal(fixture.request)

    expect(result).toMatchObject({
      valid: true,
      signatureValid: true,
      addressMatches: true,
      wallet: fixture.wallet,
    })
    expect(result.payloadHash).toMatch(/^[0-9a-f]{64}$/)
    expect(result.reason).toBeUndefined()
  })

  it('rejects a changed payload with the original signature', () => {
    const fixture = createTestOnlySeal()
    const result = verifyTreasureSeal({
      ...fixture.request,
      payload: tamperTestSealMission(fixture.request.payload),
    })

    expect(result.valid).toBe(false)
    expect(result.reason).toBe('INVALID_SIGNATURE')
    expect(result.signatureValid).toBe(false)
    expect(result.addressMatches).toBe(true)
  })

  it('rejects a changed wallet', () => {
    const fixture = createTestOnlySeal()
    const other = createTestOnlySeal()
    const result = verifyTreasureSeal({
      ...fixture.request,
      wallet: other.wallet,
    })

    expect(result.valid).toBe(false)
    expect(result.reason).toBe('ADDRESS_MISMATCH')
    expect(result.signatureValid).toBe(true)
    expect(result.addressMatches).toBe(false)
  })

  it('rejects a changed signature', () => {
    const fixture = createTestOnlySeal()
    const result = verifyTreasureSeal({
      ...fixture.request,
      signature: flipHex(fixture.request.signature),
    })

    expect(result.valid).toBe(false)
    expect(result.reason).toBe('INVALID_SIGNATURE')
  })

  it('rejects a changed public key', () => {
    const fixture = createTestOnlySeal()
    const other = createTestOnlySeal()
    const result = verifyTreasureSeal({
      ...fixture.request,
      publicKey: other.publicKey,
    })

    expect(result.valid).toBe(false)
    expect(result.reason).toBe('ADDRESS_MISMATCH')
    expect(result.addressMatches).toBe(false)
  })

  it('rejects a malformed public key', () => {
    const fixture = createTestOnlySeal()
    const result = verifyTreasureSeal({
      ...fixture.request,
      publicKey: 'not-a-public-key',
    })

    expect(result.valid).toBe(false)
    expect(result.reason).toBe('INVALID_PUBLIC_KEY')
  })

  it('rejects a malformed signature', () => {
    const fixture = createTestOnlySeal()
    const result = verifyTreasureSeal({
      ...fixture.request,
      signature: 'zz',
    })

    expect(result.valid).toBe(false)
    expect(result.reason).toBe('INVALID_SIGNATURE')
  })

  it('rejects an unsupported message type', () => {
    const fixture = createTestOnlySeal()
    const parsed = {
      version: 1 as const,
      type: 'NOT_A_TREASURE_SEAL',
      wallet: fixture.wallet,
      mission: 'VAULT_BREAKER',
      environment: 'development',
    }
    const result = verifyTreasureSeal({
      ...fixture.request,
      payload: serializeTreasureSeal(parsed),
    })

    expect(result.valid).toBe(false)
    expect(result.reason).toBe('UNSUPPORTED_MESSAGE_TYPE')
  })

  it('rejects non-canonical serialization of an otherwise valid object', () => {
    const fixture = createTestOnlySeal()
    const result = verifyTreasureSeal({
      ...fixture.request,
      payload: fixture.request.payload.replaceAll('\n', ''),
    })

    expect(result.valid).toBe(false)
    expect(result.reason).toBe('PAYLOAD_TAMPERED')
  })

  it('ignores a client-controlled valid field', () => {
    const result = verifyTreasureSeal({
      valid: true,
      payload: '{',
      wallet: 'not-an-address',
      publicKey: '00',
      signature: '00',
    })

    expect(result.valid).toBe(false)
    expect(result.reason).toBe('MALFORMED_PAYLOAD')
  })
})

describe('server-side vault-seal preview verification', () => {
  it('accepts a valid vault preview seal', () => {
    const fixture = createVaultOnlySeal()
    const result = verifyTreasureSeal(fixture.request)

    expect(result).toMatchObject({
      valid: true,
      signatureValid: true,
      addressMatches: true,
      wallet: fixture.wallet,
    })
    expect(result.payloadHash).toMatch(/^[0-9a-f]{64}$/)
    expect(result.reason).toBeUndefined()
  })

  it('rejects a tampered vault payload with the original signature', () => {
    const fixture = createVaultOnlySeal()
    const result = verifyTreasureSeal({
      ...fixture.request,
      payload: tamperVaultSealMission(fixture.request.payload),
    })

    expect(result.valid).toBe(false)
    expect(result.reason).toBe('INVALID_SIGNATURE')
    expect(result.signatureValid).toBe(false)
  })

  it('rejects a vault seal bound to a different wallet', () => {
    const fixture = createVaultOnlySeal()
    const other = createVaultOnlySeal()
    const result = verifyTreasureSeal({
      ...fixture.request,
      wallet: other.wallet,
    })

    expect(result.valid).toBe(false)
    expect(result.reason).toBe('ADDRESS_MISMATCH')
    expect(result.addressMatches).toBe(false)
  })

  it('rejects a malformed vault wallet', () => {
    const fixture = createVaultOnlySeal()
    const result = verifyTreasureSeal({
      ...fixture.request,
      wallet: 'not-an-address',
    })

    expect(result.valid).toBe(false)
    expect(result.reason).toBe('INVALID_WALLET')
  })
})

describe('canonical treasure-seal serialization', () => {
  it('remains stable for the development payload', () => {
    const wallet = 'NQ07 TEST 0000 0000 0000 0000 0000 0000 0000'
    const message = serializeTestTreasureSeal(buildTestTreasureSealPayload(wallet))
    expect(message).toBe(`{
  "version": 1,
  "type": "NIMHUNT_TEST_SEAL",
  "wallet": "${wallet}",
  "mission": "VAULT_BREAKER",
  "environment": "development"
}`)
  })
})

function createTestOnlySeal() {
  // Test-only generated key. Never reuse for treasury or reward activity.
  const keyPair = KeyPair.generate()
  const wallet = keyPair.toAddress().toUserFriendlyAddress()
  const payload = serializeTestTreasureSeal(buildTestTreasureSealPayload(wallet))
  const signature = keyPair.sign(nimiqSignedMessageHash(payload))

  return {
    wallet,
    publicKey: keyPair.publicKey.toHex(),
    request: {
      payload,
      wallet,
      publicKey: keyPair.publicKey.toHex(),
      signature: signature.toHex(),
    },
  }
}

function createVaultOnlySeal() {
  // Test-only generated key. Never reuse for treasury or reward activity.
  const keyPair = KeyPair.generate()
  const wallet = keyPair.toAddress().toUserFriendlyAddress()
  const payload = serializeVaultSeal(buildVaultSealPayload(wallet))
  const signature = keyPair.sign(nimiqSignedMessageHash(payload))

  return {
    wallet,
    publicKey: keyPair.publicKey.toHex(),
    request: {
      payload,
      wallet,
      publicKey: keyPair.publicKey.toHex(),
      signature: signature.toHex(),
    },
  }
}

function flipHex(value: string): string {
  const next = value.endsWith('0') ? '1' : '0'
  return `${value.slice(0, -1)}${next}`
}
