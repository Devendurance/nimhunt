import {
  isCanonicalTreasureSeal,
  parseTreasureSealJson,
  TEST_SEAL_ENVIRONMENT,
  TEST_SEAL_TYPE,
} from '../src/domain/treasureSeal.js'
import { isCanonicalVaultSeal, parseVaultSealJson, VAULT_SEAL_TYPE } from '../src/domain/vaultSeal.js'
import type {
  VerifyTreasureSealReason,
  VerifyTreasureSealRequest,
  VerifyTreasureSealResult,
} from '../src/integrations/nimiq/verifySealTypes.js'
import { verifyNimiqSignedCanonicalMessage } from './expeditions/crypto.js'

export { DEV_VERIFY_PATH } from '../src/integrations/nimiq/verifySealTypes.js'
export { nimiqSignedMessageHash } from './expeditions/crypto.js'
export const MAX_VERIFY_BODY_BYTES = 12_288
export const MAX_PAYLOAD_CHARS = 8_192
export const MAX_WALLET_CHARS = 80
export const MAX_PUBLIC_KEY_CHARS = 130
export const MAX_SIGNATURE_CHARS = 258

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

  const messageType = readMessageType(request.value.payload)
  if (!messageType) return rejected('MALFORMED_PAYLOAD')
  if (messageType !== TEST_SEAL_TYPE && messageType !== VAULT_SEAL_TYPE) {
    return rejected('UNSUPPORTED_MESSAGE_TYPE')
  }

  if (messageType === VAULT_SEAL_TYPE) {
    const parsed = parseVaultSealJson(request.value.payload)
    if (!parsed) return rejected('MALFORMED_PAYLOAD')
    if (!isCanonicalVaultSeal(request.value.payload, parsed)) return rejected('PAYLOAD_TAMPERED')
    return verifySealCrypto({
      payload: request.value.payload,
      requestWallet: request.value.wallet,
      payloadWallet: parsed.wallet,
      publicKeyHex: request.value.publicKey,
      signatureHex: request.value.signature,
    })
  }

  const parsed = parseTreasureSealJson(request.value.payload)
  if (!parsed) return rejected('MALFORMED_PAYLOAD')
  if (parsed.type !== TEST_SEAL_TYPE) return rejected('UNSUPPORTED_MESSAGE_TYPE')
  if (parsed.environment !== TEST_SEAL_ENVIRONMENT) return rejected('MALFORMED_PAYLOAD')
  if (!isCanonicalTreasureSeal(request.value.payload, parsed)) return rejected('PAYLOAD_TAMPERED')
  return verifySealCrypto({
    payload: request.value.payload,
    requestWallet: request.value.wallet,
    payloadWallet: parsed.wallet,
    publicKeyHex: request.value.publicKey,
    signatureHex: request.value.signature,
  })
}

function verifySealCrypto(input: {
  payload: string
  requestWallet: string
  payloadWallet: string
  publicKeyHex: string
  signatureHex: string
}): VerifyTreasureSealResult {
  const result = verifyNimiqSignedCanonicalMessage({
    payload: input.payload,
    wallet: input.requestWallet,
    payloadWallet: input.payloadWallet,
    publicKey: input.publicKeyHex,
    signature: input.signatureHex,
  })
  if (result.reason === 'INVALID_WALLET' || result.reason === 'INVALID_PUBLIC_KEY') return rejected(result.reason)
  if (result.reason) {
    return rejected(result.reason, {
      addressMatches: result.addressMatches,
      payloadHash: result.payloadHash,
      signatureValid: result.signatureValid,
      wallet: result.wallet,
    })
  }
  return result
}

function readMessageType(payload: string): string | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(payload)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
  const type = (parsed as Record<string, unknown>).type
  return typeof type === 'string' ? type : null
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
