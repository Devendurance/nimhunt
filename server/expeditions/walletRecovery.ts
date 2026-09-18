import {
  serializeWalletRecoveryPayload,
  WALLET_RECOVERY_PURPOSE,
  WALLET_RECOVERY_TYPE,
  WALLET_RECOVERY_VERSION,
  type WalletRecoveryPayload,
} from '../../src/domain/walletRecovery.js'
import { normalizeNimiqWallet } from '../ledger/wallet.js'
import { sha256Hex } from './crypto.js'

export {
  serializeWalletRecoveryPayload,
  WALLET_RECOVERY_PURPOSE,
  WALLET_RECOVERY_TYPE,
  WALLET_RECOVERY_VERSION,
} from '../../src/domain/walletRecovery.js'
export type { WalletRecoveryPayload } from '../../src/domain/walletRecovery.js'

const RECOVERY_FIELDS = [
  'version',
  'type',
  'wallet',
  'challenge',
  'issuedAt',
  'expiresAt',
  'purpose',
] as const

export type SignedWalletRecoveryRequest = {
  readonly payload: string
  readonly publicKey: string
  readonly signature: string
}

export function parseWalletRecoveryPayload(payload: unknown): WalletRecoveryPayload | null {
  if (typeof payload !== 'string' || payload.length === 0 || payload.length > 4_096) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(payload)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null

  const record = parsed as Record<string, unknown>
  const keys = Object.keys(record)
  if (keys.length !== RECOVERY_FIELDS.length || RECOVERY_FIELDS.some(field => !keys.includes(field))) return null
  if (record.version !== WALLET_RECOVERY_VERSION || record.type !== WALLET_RECOVERY_TYPE) return null
  if (record.purpose !== WALLET_RECOVERY_PURPOSE) return null
  if (!isBoundedString(record.wallet, 80) || !isBoundedString(record.challenge, 256)) return null
  if (!/^[A-Za-z0-9_-]+$/.test(record.challenge)) return null
  if (!isIsoTimestamp(record.issuedAt) || !isIsoTimestamp(record.expiresAt)) return null
  if (new Date(record.expiresAt).getTime() <= new Date(record.issuedAt).getTime()) return null

  let wallet: string
  try {
    wallet = normalizeNimiqWallet(record.wallet)
  } catch {
    return null
  }
  if (wallet !== record.wallet) return null

  const result: WalletRecoveryPayload = {
    version: WALLET_RECOVERY_VERSION,
    type: WALLET_RECOVERY_TYPE,
    wallet,
    challenge: record.challenge,
    issuedAt: record.issuedAt,
    expiresAt: record.expiresAt,
    purpose: WALLET_RECOVERY_PURPOSE,
  }
  return payload === serializeWalletRecoveryPayload(result) ? result : null
}

export function alignRecoveryConsumeTimestamps(
  signed: { readonly issuedAt: string; readonly expiresAt: string },
  stored: { readonly issuedAt: unknown; readonly expiresAt: unknown } | null,
): { readonly issuedAt: string; readonly expiresAt: string } {
  if (!stored) return signed
  const storedIssuedAt = typeof stored.issuedAt === 'string' ? stored.issuedAt : null
  const storedExpiresAt = typeof stored.expiresAt === 'string' ? stored.expiresAt : null
  if (!storedIssuedAt || !storedExpiresAt) return signed
  if (new Date(storedIssuedAt).toISOString() !== signed.issuedAt) return signed
  if (new Date(storedExpiresAt).toISOString() !== signed.expiresAt) return signed
  return { issuedAt: storedIssuedAt, expiresAt: storedExpiresAt }
}

export function hashRecoveryChallenge(challenge: string): string {
  return sha256Hex(challenge)
}

export function fingerprintWalletRecoveryAuthorization(input: SignedWalletRecoveryRequest): string {
  return sha256Hex(`${input.payload}\n${input.publicKey}\n${input.signature}`)
}

function isBoundedString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const parsed = new Date(value)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value
}
