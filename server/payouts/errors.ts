export type PayoutErrorCode =
  | 'MALFORMED_REQUEST'
  | 'CLAIM_NOT_FOUND'
  | 'CLAIM_NOT_ELIGIBLE'
  | 'RUN_SESSION_INVALID'
  | 'PAYOUT_NOT_FOUND'
  | 'PAYOUT_AMOUNT_INVALID'
  | 'PAYOUT_AMOUNT_UNCONFIGURED'
  | 'PAYOUT_NETWORK_INVALID'
  | 'PAYOUT_MAINNET_DISABLED'
  | 'PAYOUT_AUTOMATION_DISABLED'
  | 'PAYOUT_DAILY_CAP_INVALID'
  | 'PAYOUT_STATUS_INVALID'
  | 'PAYOUT_TX_INVALID'
  | 'PAYOUT_TX_MISMATCH'
  | 'PAYOUT_RESEND_UNSAFE'
  | 'PAYOUT_TREASURY_UNAVAILABLE'
  | 'PAYOUT_TREASURY_LOW'
  | 'PAYOUT_CYCLE_LIMIT_INVALID'
  | 'PAYOUT_SCHEDULER_SECRET_INVALID'
  | 'PAYOUT_SCHEDULER_SECRET_UNAVAILABLE'
  | 'PAYOUT_UNAVAILABLE'
  | 'WALLET_MISMATCH'

export class PayoutError extends Error {
  readonly code: PayoutErrorCode

  constructor(code: PayoutErrorCode) {
    super(code)
    this.name = 'PayoutError'
    this.code = code
  }
}

export function isPayoutError(error: unknown): error is PayoutError {
  return error instanceof PayoutError
}
