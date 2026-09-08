import { describe, expect, it } from 'vitest'
import { tamperTestSealMission } from '../../domain/treasureSeal'
import { buildTestTreasureSealPayload, serializeTestTreasureSeal, shortenNimiqAddress } from './treasureSeal'

const wallet = 'NQ07 TEST 0000 0000 0000 0000 0000 0000 0000'

describe('test treasure seal serialization', () => {
  it('builds the fixed-field payload', () => {
    expect(buildTestTreasureSealPayload(wallet)).toEqual({
      version: 1,
      type: 'NIMHUNT_TEST_SEAL',
      wallet,
      mission: 'VAULT_BREAKER',
      environment: 'development',
    })
  })

  it('serializes with a stable field order', () => {
    const message = serializeTestTreasureSeal(buildTestTreasureSealPayload(wallet))
    const keys = Object.keys(JSON.parse(message) as Record<string, unknown>)
    expect(keys).toEqual(['version', 'type', 'wallet', 'mission', 'environment'])
    expect(message).toBe(`{
  "version": 1,
  "type": "NIMHUNT_TEST_SEAL",
  "wallet": "${wallet}",
  "mission": "VAULT_BREAKER",
  "environment": "development"
}`)
  })

  it('does not include reward or claim fields', () => {
    const message = serializeTestTreasureSeal(buildTestTreasureSealPayload(wallet))
    expect(message).not.toMatch(/reward|claimNonce|txHash|transaction/i)
  })

  it('shortens Nimiq addresses for display', () => {
    expect(shortenNimiqAddress(wallet)).toBe('NQ07TE…0000')
  })

  it('tampers only the mission field after signing', () => {
    const message = serializeTestTreasureSeal(buildTestTreasureSealPayload(wallet))
    const tampered = tamperTestSealMission(message)
    expect(tampered).toContain('"mission": "GEM_RUNNER"')
    expect(tampered).not.toContain('"mission": "VAULT_BREAKER"')
    expect(tampered).toContain(`"wallet": "${wallet}"`)
  })
})
