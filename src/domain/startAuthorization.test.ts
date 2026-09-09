import { KeyPair } from '@nimiq/core'
import { describe, expect, it } from 'vitest'
import {
  serializeStartPayload,
  START_EXPEDITION_TYPE,
  START_EXPEDITION_VERSION,
  type StartExpeditionPayload,
} from './startAuthorization.ts'

function payload(): StartExpeditionPayload {
  return {
    version: START_EXPEDITION_VERSION,
    type: START_EXPEDITION_TYPE,
    wallet: KeyPair.generate().toAddress().toUserFriendlyAddress(),
    mission: 'gem-runner',
    dayKey: '2026-09-09',
    challenge: 'challenge-value',
    blueprintId: 'bootstrap-2026-09-09-gem-runner',
    blueprintHash: 'a'.repeat(64),
  }
}

describe('shared authenticated start contract', () => {
  it('serializes the signed start payload in the fixed field order', () => {
    const value = payload()

    expect(serializeStartPayload(value)).toBe(`{
  "version": 1,
  "type": "NIMHUNT_START_EXPEDITION",
  "wallet": "${value.wallet}",
  "mission": "gem-runner",
  "dayKey": "2026-09-09",
  "challenge": "challenge-value",
  "blueprintId": "bootstrap-2026-09-09-gem-runner",
  "blueprintHash": "${'a'.repeat(64)}"
}`)
  })

})
