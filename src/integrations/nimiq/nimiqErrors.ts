import type { NimiqErrorCode, NimiqOperation } from './nimiqTypes'

export class NimiqIntegrationError extends Error {
  readonly code: NimiqErrorCode
  readonly details: unknown

  constructor(code: NimiqErrorCode, message: string, details?: unknown) {
    super(message)
    this.name = 'NimiqIntegrationError'
    this.code = code
    this.details = details
  }
}

type ErrorResponse = {
  error: {
    type?: string
    message?: string
  }
}

const USER_MESSAGES: Record<NimiqErrorCode, string> = {
  PROVIDER_UNAVAILABLE: 'Nimiq Pay provider is unavailable in this browser.',
  PROVIDER_INIT_FAILED: 'Nimiq Pay provider failed to initialize.',
  ACCOUNT_CANCELLED: 'Account access was cancelled.',
  ACCOUNT_EMPTY: 'No Nimiq account was returned.',
  SIGN_CANCELLED: 'Signature request was cancelled.',
  UNKNOWN: 'An unexpected Nimiq error occurred.',
}

export function createNimiqError(
  code: NimiqErrorCode,
  details?: unknown,
  message = USER_MESSAGES[code],
): NimiqIntegrationError {
  return new NimiqIntegrationError(code, message, details)
}

export function isErrorResponse(value: unknown): value is ErrorResponse {
  if (typeof value !== 'object' || value === null || !('error' in value)) return false
  const error = (value as { error: unknown }).error
  return typeof error === 'object' && error !== null
}

export function normalizeNimiqError(error: unknown, operation: NimiqOperation): NimiqIntegrationError {
  if (error instanceof NimiqIntegrationError) return error

  const parts = readErrorParts(error)

  if (isCancelled(parts)) {
    if (operation === 'sign') return createNimiqError('SIGN_CANCELLED', error)
    if (operation === 'account') return createNimiqError('ACCOUNT_CANCELLED', error)
  }

  if (operation === 'init') {
    if (isUnavailable(parts)) return createNimiqError('PROVIDER_UNAVAILABLE', error)
    return createNimiqError('PROVIDER_INIT_FAILED', error)
  }

  if (isUnavailable(parts)) return createNimiqError('PROVIDER_UNAVAILABLE', error)

  return createNimiqError('UNKNOWN', error)
}

function readErrorParts(error: unknown): { type: string; message: string } {
  if (isErrorResponse(error)) {
    return {
      type: String(error.error.type ?? ''),
      message: String(error.error.message ?? ''),
    }
  }

  if (error instanceof Error) {
    const type = 'code' in error ? String(error.code) : error.name
    return { type, message: error.message }
  }

  if (typeof error === 'object' && error !== null) {
    const record = error as { type?: unknown; code?: unknown; message?: unknown }
    return {
      type: String(record.type ?? record.code ?? ''),
      message: String(record.message ?? ''),
    }
  }

  return { type: '', message: String(error) }
}

function isCancelled(parts: { type: string; message: string }): boolean {
  const haystack = `${parts.type} ${parts.message}`.toLowerCase()
  return /permission_denied|user.?reject|user.?denied|user.?cancel|rejected|cancelled|canceled|denied/.test(haystack)
}

function isUnavailable(parts: { type: string; message: string }): boolean {
  const haystack = `${parts.type} ${parts.message}`.toLowerCase()
  return /not injected|not running inside|unavailable|timeout/.test(haystack)
}

export function logNimiqError(error: NimiqIntegrationError): void {
  if (!import.meta.env.DEV) return
  console.warn('[nimiq]', error.code, error.message, error.details)
}
