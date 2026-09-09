import { KeyPair } from '@nimiq/core'
import { describe, expect, it } from 'vitest'
import {
  isCanonicalStartPayload,
  parseStartPayload,
  serializeStartPayload,
  START_EXPEDITION_TYPE,
  type StartExpeditionPayload,
} from './canonical.ts'

function payload(): StartExpeditionPayload {
  return {
    version: 1,
    type: START_EXPEDITION_TYPE,
    wallet: KeyPair.generate().toAddress().toUserFriendlyAddress(),
    mission: 'gem-runner',
    dayKey: '2026-09-09',
    challenge: 'challenge-value',
    blueprintId: 'bootstrap-2026-09-09-gem-runner',
    blueprintHash: 'a'.repeat(64),
  }
}

describe('canonical signed start payload', () => {
  it('serializes the approved field order and parses only its exact canonical form', () => {
    const value = payload()
    const serialized = serializeStartPayload(value)

    expect(serialized).toBe(`{
  "version": 1,
  "type": "NIMHUNT_START_EXPEDITION",
  "wallet": "${value.wallet}",
  "mission": "gem-runner",
  "dayKey": "2026-09-09",
  "challenge": "challenge-value",
  "blueprintId": "bootstrap-2026-09-09-gem-runner",
  "blueprintHash": "${'a'.repeat(64)}"
}`)
    expect(parseStartPayload(serialized)).toEqual(value)
    expect(isCanonicalStartPayload(serialized, value)).toBe(true)
    expect(parseStartPayload(JSON.stringify({ ...value, extra: true }))).toBeNull()
    expect(isCanonicalStartPayload(serialized.replace('"mission": "gem-runner"', '"mission":"gem-runner"'), value)).toBe(false)
  })

  it('rejects invalid UTC days, missions, and non-canonical wallets', () => {
    const value = payload()
    expect(parseStartPayload(serializeStartPayload({ ...value, dayKey: '2026-02-30' }))).toBeNull()
    expect(parseStartPayload(serializeStartPayload({ ...value, mission: 'relic-keeper' as never }))).toBeNull()
    expect(parseStartPayload(serializeStartPayload({ ...value, wallet: value.wallet.replaceAll(' ', '') }))).toBeNull()
  })
})
