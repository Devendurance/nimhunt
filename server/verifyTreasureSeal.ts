import { Address, Hash, PublicKey, Signature } from '@nimiq/core'
import {
  isCanonicalTreasureSeal,
  parseTreasureSealJson,
  TEST_SEAL_ENVIRONMENT,
  TEST_SEAL_TYPE,
} from '../src/domain/treasureSeal.ts'
import type {
  VerifyTreasureSealReason,
  VerifyTreasureSealRequest,
  VerifyTreasureSealResult,
} from '../src/integrations/nimiq/verifySealTypes.ts'

export { DEV_VERIFY_PATH } from '../src/integrations/nimiq/verifySealTypes.ts'
export const MAX_VERIFY_BODY_BYTES = 12_288
export const MAX_PAYLOAD_CHARS = 8_192
export const MAX_WALLET_CHARS = 80
export const MAX_PUBLIC_KEY_CHARS = 130
export const MAX_SIGNATURE_CHARS = 258

const SIGNED_MESSAGE_PREFIX = '\x16Nimiq Signed Message:\n'
const encoder = new TextEncoder()

const rejected = (
  reason: VerifyTreasureSealReason,
  extras: Partial<VerifyTreasureSealResult> = {},
): VerifyTreasureSealResult => ({
  valid: false,
  signatureValid: false,
  addressMatches: false,
  reason,
  ...extras,
})

export function verifyTreasureSeal(input: unknown): VerifyTreasureSealResult {
  const request = readRequest(input)
  if (!request.ok) return rejected(request.reason)

  const parsed = parseTreasureSealJson(request.value.payload)
  if (!parsed) return rejected('MALFORMED_PAYLOAD')
  if (parsed.type !== TEST_SEAL_TYPE) return rejected('UNSUPPORTED_MESSAGE_TYPE')
  if (parsed.environment !== TEST_SEAL_ENVIRONMENT) return rejected('MALFORMED_PAYLOAD')
  if (!isCanonicalTreasureSeal(request.value.payload, parsed)) return rejected('PAYLOAD_TAMPERED')

  let expectedAddress: Address
  let payloadAddress: Address
  try {
    expectedAddress = Address.fromString(request.value.wallet)
    payloadAddress = Address.fromString(parsed.wallet)
  } catch {
    return rejected('INVALID_WALLET')
  }

  let publicKey: PublicKey
  try {
    publicKey = PublicKey.fromHex(normalizeHex(request.value.publicKey, 64))
  } catch {
    return rejected('INVALID_PUBLIC_KEY')
  }

  const derivedAddress = publicKey.toAddress()
  const addressMatches = derivedAddress.equals(expectedAddress) && derivedAddress.equals(payloadAddress)
  const wallet = derivedAddress.toUserFriendlyAddress()
  const payloadHash = toHex(Hash.computeSha256(encoder.encode(request.value.payload)))

  let signature: Signature
  try {
    signature = Signature.fromHex(normalizeHex(request.value.signature, 128))
  } catch {
    return rejected('INVALID_SIGNATURE', { addressMatches, payloadHash, wallet })
  }

  const signatureValid = publicKey.verify(signature, nimiqSignedMessageHash(request.value.payload))

  if (!addressMatches) {
    return rejected('ADDRESS_MISMATCH', { addressMatches: false, payloadHash, signatureValid, wallet })
  }

  if (!signatureValid) {
    return rejected('INVALID_SIGNATURE', { addressMatches: true, payloadHash, signatureValid: false, wallet })
  }

  return {
    valid: true,
    signatureValid: true,
    addressMatches: true,
    payloadHash,
    wallet,
  }
}

export function nimiqSignedMessageHash(message: string): Uint8Array {
  const messageBytes = encoder.encode(message)
  const prefixBytes = encoder.encode(`${SIGNED_MESSAGE_PREFIX}${messageBytes.byteLength}`)
  const prefixed = new Uint8Array(prefixBytes.byteLength + messageBytes.byteLength)
  prefixed.set(prefixBytes)
  prefixed.set(messageBytes, prefixBytes.byteLength)
  return Hash.computeSha256(prefixed)
}

function readRequest(input: unknown): { ok: true; value: VerifyTreasureSealRequest } | { ok: false; reason: VerifyTreasureSealReason } {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, reason: 'MALFORMED_PAYLOAD' }
  }

  const record = input as Record<string, unknown>
  if (!isBoundedString(record.payload, MAX_PAYLOAD_CHARS)) return { ok: false, reason: 'MALFORMED_PAYLOAD' }
  if (!isBoundedString(record.wallet, MAX_WALLET_CHARS)) return { ok: false, reason: 'INVALID_WALLET' }
  if (!isBoundedString(record.publicKey, MAX_PUBLIC_KEY_CHARS)) return { ok: false, reason: 'INVALID_PUBLIC_KEY' }
  if (!isBoundedString(record.signature, MAX_SIGNATURE_CHARS)) return { ok: false, reason: 'INVALID_SIGNATURE' }

  return {
    ok: true,
    value: {
      payload: record.payload,
      wallet: record.wallet,
      publicKey: record.publicKey,
      signature: record.signature,
    },
  }
}

function isBoundedString(value: unknown, maxChars: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxChars
}

function normalizeHex(value: string, expectedLength: number): string {
  const hex = value.startsWith('0x') || value.startsWith('0X') ? value.slice(2) : value
  if (hex.length !== expectedLength || !/^[0-9a-fA-F]+$/.test(hex)) {
    throw new Error('Invalid hex encoding')
  }
  return hex
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
}
