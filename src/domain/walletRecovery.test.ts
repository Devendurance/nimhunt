import { KeyPair } from '@nimiq/core'
import { describe, expect, it } from 'vitest'
import {
  serializeWalletRecoveryPayload,
  WALLET_RECOVERY_PURPOSE,
  WALLET_RECOVERY_TYPE,
  WALLET_RECOVERY_VERSION,
  type WalletRecoveryPayload,
} from './walletRecovery.ts'

function payload(): WalletRecoveryPayload {
  return {
    version: WALLET_RECOVERY_VERSION,
    type: WALLET_RECOVERY_TYPE,
    wallet: KeyPair.generate().toAddress().toUserFriendlyAddress(),
    challenge: 'recovery-challenge',
    issuedAt: '2026-09-16T12:00:00.000Z',
    expiresAt: '2026-09-16T12:05:00.000Z',
    purpose: WALLET_RECOVERY_PURPOSE,
  }
}

describe('NIMHUNT_RECOVER_SESSION_V1 payload', () => {
  it('serializes the signed recovery payload in the fixed field order', () => {
    const value = payload()

    expect(serializeWalletRecoveryPayload(value)).toBe(`{
  "version": 1,
  "type": "NIMHUNT_RECOVER_SESSION_V1",
  "wallet": "${value.wallet}",
  "challenge": "recovery-challenge",
  "issuedAt": "2026-09-16T12:00:00.000Z",
  "expiresAt": "2026-09-16T12:05:00.000Z",
  "purpose": "reward/daily-state recovery"
}`)
  })
})
