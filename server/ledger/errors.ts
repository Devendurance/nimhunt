import type { LedgerErrorCode } from '../../src/domain/dailyLedger.js'

export class LedgerError extends Error {
  readonly code: LedgerErrorCode

  constructor(code: LedgerErrorCode) {
    super(code)
    this.name = 'LedgerError'
    this.code = code
  }
}

export function isLedgerError(error: unknown): error is LedgerError {
  return error instanceof LedgerError
}
