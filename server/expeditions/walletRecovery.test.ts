import { KeyPair } from '@nimiq/core'
import { describe, expect, it } from 'vitest'
import {
  alignRecoveryConsumeTimestamps,
  parseWalletRecoveryPayload,
  serializeWalletRecoveryPayload,
  WALLET_RECOVERY_PURPOSE,
  WALLET_RECOVERY_TYPE,
  type WalletRecoveryPayload,
} from './walletRecovery.ts'

function payload(): WalletRecoveryPayload {
  return {
    version: 1,
    type: WALLET_RECOVERY_TYPE,
    wallet: KeyPair.generate().toAddress().toUserFriendlyAddress(),
    challenge: 'recovery-challenge',
    issuedAt: '2026-09-16T12:00:00.000Z',
    expiresAt: '2026-09-16T12:05:00.000Z',
    purpose: WALLET_RECOVERY_PURPOSE,
  }
}

describe('canonical NIMHUNT_RECOVER_SESSION_V1 payload', () => {
  it('parses only the exact canonical form', () => {
    const value = payload()
    const serialized = serializeWalletRecoveryPayload(value)

    expect(parseWalletRecoveryPayload(serialized)).toEqual(value)
    expect(parseWalletRecoveryPayload(JSON.stringify({ ...value, extra: true }))).toBeNull()
    expect(parseWalletRecoveryPayload(JSON.stringify({
      type: value.type,
      version: value.version,
      wallet: value.wallet,
      challenge: value.challenge,
      issuedAt: value.issuedAt,
      expiresAt: value.expiresAt,
      purpose: value.purpose,
    }))).toBeNull()
    expect(parseWalletRecoveryPayload(serialized.replace('"purpose": "reward/daily-state recovery"', '"purpose":"reward/daily-state recovery"'))).toBeNull()
  })

  it('rejects non-canonical wallets, bad timestamps, and the wrong purpose', () => {
    const value = payload()
    expect(parseWalletRecoveryPayload(serializeWalletRecoveryPayload({
      ...value,
      wallet: value.wallet.replaceAll(' ', ''),
    }))).toBeNull()
    expect(parseWalletRecoveryPayload(serializeWalletRecoveryPayload({
      ...value,
      expiresAt: value.issuedAt,
    }))).toBeNull()
    expect(parseWalletRecoveryPayload(JSON.stringify({
      ...value,
      purpose: 'payout-send',
    }, null, 2))).toBeNull()
  })

  it('aligns millisecond-truncated signed timestamps to stored postgres values', () => {
    const signed = {
      issuedAt: '2026-09-16T12:00:00.123Z',
      expiresAt: '2026-09-16T12:05:00.123Z',
    }
    expect(alignRecoveryConsumeTimestamps(signed, {
      issuedAt: '2026-09-16T12:00:00.123456+00:00',
      expiresAt: '2026-09-16T12:05:00.123456+00:00',
    })).toEqual({
      issuedAt: '2026-09-16T12:00:00.123456+00:00',
      expiresAt: '2026-09-16T12:05:00.123456+00:00',
    })
    expect(alignRecoveryConsumeTimestamps({
      ...signed,
      issuedAt: '2026-09-16T12:00:01.123Z',
    }, {
      issuedAt: '2026-09-16T12:00:00.123456+00:00',
      expiresAt: '2026-09-16T12:05:00.123456+00:00',
    })).toEqual({
      issuedAt: '2026-09-16T12:00:01.123Z',
      expiresAt: '2026-09-16T12:05:00.123Z',
    })
  })
})
