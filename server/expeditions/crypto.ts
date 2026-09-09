import { createHash } from 'node:crypto'
import { Address, Hash, PublicKey, Signature } from '@nimiq/core'

const SIGNED_MESSAGE_PREFIX = '\x16Nimiq Signed Message:\n'
const encoder = new TextEncoder()

export type NimiqCryptoReason = 'INVALID_WALLET' | 'INVALID_PUBLIC_KEY' | 'INVALID_SIGNATURE' | 'ADDRESS_MISMATCH'

export type NimiqCryptoVerification = {
  readonly valid: boolean
  readonly signatureValid: boolean
  readonly addressMatches: boolean
  readonly reason?: NimiqCryptoReason
  readonly payloadHash: string
  readonly wallet?: string
}

export function verifyNimiqSignedCanonicalMessage(input: {
  readonly payload: string
  readonly wallet: string
  readonly payloadWallet: string
  readonly publicKey: string
  readonly signature: string
}): NimiqCryptoVerification {
  let expectedAddress: Address
  let payloadAddress: Address
  try {
    expectedAddress = Address.fromString(input.wallet)
    payloadAddress = Address.fromString(input.payloadWallet)
  } catch {
    return rejected('INVALID_WALLET', input.payload)
  }

  let publicKey: PublicKey
  try {
    publicKey = PublicKey.fromHex(normalizeHex(input.publicKey, 64))
  } catch {
    return rejected('INVALID_PUBLIC_KEY', input.payload)
  }

  const derivedAddress = publicKey.toAddress()
  const addressMatches = derivedAddress.equals(expectedAddress) && derivedAddress.equals(payloadAddress)
  const wallet = derivedAddress.toUserFriendlyAddress()
  const payloadHash = sha256Hex(input.payload)

  let signature: Signature
  try {
    signature = Signature.fromHex(normalizeHex(input.signature, 128))
  } catch {
    return {
      ...rejected('INVALID_SIGNATURE', input.payload),
      addressMatches,
      wallet,
    }
  }

  const signatureValid = publicKey.verify(signature, nimiqSignedMessageHash(input.payload))
  if (!addressMatches) {
    return { ...rejected('ADDRESS_MISMATCH', input.payload), addressMatches: false, signatureValid, wallet }
  }
  if (!signatureValid) {
    return { ...rejected('INVALID_SIGNATURE', input.payload), addressMatches: true, signatureValid: false, wallet }
  }

  return { valid: true, signatureValid: true, addressMatches: true, payloadHash, wallet }
}

export function nimiqSignedMessageHash(message: string): Uint8Array {
  const messageBytes = encoder.encode(message)
  const prefixBytes = encoder.encode(`${SIGNED_MESSAGE_PREFIX}${messageBytes.byteLength}`)
  const prefixed = new Uint8Array(prefixBytes.byteLength + messageBytes.byteLength)
  prefixed.set(prefixBytes)
  prefixed.set(messageBytes, prefixBytes.byteLength)
  return Hash.computeSha256(prefixed)
}

export function sha256Hex(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

function rejected(reason: NimiqCryptoReason, payload: string): NimiqCryptoVerification {
  return {
    valid: false,
    signatureValid: false,
    addressMatches: false,
    reason,
    payloadHash: sha256Hex(payload),
  }
}

function normalizeHex(value: string, expectedLength: number): string {
  const hex = value.startsWith('0x') || value.startsWith('0X') ? value.slice(2) : value
  if (hex.length !== expectedLength || !/^[0-9a-fA-F]+$/.test(hex)) throw new Error('Invalid hex encoding')
  return hex
}
