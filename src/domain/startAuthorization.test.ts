import { KeyPair } from '@nimiq/core'
import { describe, expect, it } from 'vitest'
import { parseStartPayload } from '../../server/expeditions/canonical.ts'
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

  it('accepts only the shared serializer output on the server', () => {
    const value = payload()
    const serialized = serializeStartPayload(value)
    const parsed = JSON.parse(serialized) as Record<string, unknown>

    expect(parseStartPayload(serialized)).toEqual(value)
    expect(parseStartPayload(JSON.stringify({ ...parsed, extra: true }))).toBeNull()
    expect(parseStartPayload(JSON.stringify({
      type: parsed.type,
      version: parsed.version,
      wallet: parsed.wallet,
      mission: parsed.mission,
      dayKey: parsed.dayKey,
      challenge: parsed.challenge,
      blueprintId: parsed.blueprintId,
      blueprintHash: parsed.blueprintHash,
    }))).toBeNull()
    expect(parseStartPayload(serialized.replace('"mission": "gem-runner"', '"mission":"gem-runner"'))).toBeNull()
  })
})
