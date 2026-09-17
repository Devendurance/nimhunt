import { Address } from '@nimiq/core'
import { PayoutError } from './errors.js'
import {
  NIMIQ_MAINNET_NETWORK_ID,
  NIMIQ_TESTNET_NETWORK_ID,
  PAYOUT_DATA_PREFIX,
  type PayoutNetwork,
} from './types.js'

export function payoutExtraData(payoutId: string): Uint8Array {
  return new TextEncoder().encode(`${PAYOUT_DATA_PREFIX}${payoutId}`)
}

export function decodePayoutExtraData(bytes: Uint8Array | string | null | undefined): string | null {
  if (bytes == null) return null
  const raw = typeof bytes === 'string' ? hexToBytes(bytes) : bytes
  if (!raw) return null
  const text = new TextDecoder().decode(raw)
  if (!text.startsWith(PAYOUT_DATA_PREFIX)) return null
  const payoutId = text.slice(PAYOUT_DATA_PREFIX.length)
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(payoutId)
    ? payoutId.toLowerCase()
    : null
}

export function networkIdFor(network: PayoutNetwork): number {
  return network === 'mainnet' ? NIMIQ_MAINNET_NETWORK_ID : NIMIQ_TESTNET_NETWORK_ID
}

export function requireNimiqAddress(wallet: string): Address {
  try {
    return Address.fromString(wallet)
  } catch {
    throw new PayoutError('WALLET_MISMATCH')
  }
}

export function normalizeNimiqAddress(wallet: string): string {
  return requireNimiqAddress(wallet).toUserFriendlyAddress()
}

export function parseTxHash(value: string): string {
  const hash = value.startsWith('0x') || value.startsWith('0X') ? value.slice(2) : value
  if (!/^[0-9a-f]{64}$/i.test(hash)) throw new PayoutError('PAYOUT_TX_INVALID')
  return hash.toLowerCase()
}

function hexToBytes(value: string): Uint8Array | null {
  const hex = value.startsWith('0x') || value.startsWith('0X') ? value.slice(2) : value
  if (hex.length === 0 || hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) return null
  const bytes = new Uint8Array(hex.length / 2)
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16)
  }
  return bytes
}
