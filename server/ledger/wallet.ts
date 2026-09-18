import { Address } from '@nimiq/core'
import { LedgerError } from './errors.js'

export const MAX_WALLET_CHARS = 80

export function normalizeNimiqWallet(input: unknown): string {
  if (typeof input !== 'string' || input.length === 0 || input.length > MAX_WALLET_CHARS) {
    throw new LedgerError('INVALID_WALLET')
  }
  try {
    return Address.fromString(input.trim()).toUserFriendlyAddress()
  } catch {
    throw new LedgerError('INVALID_WALLET')
  }
}
