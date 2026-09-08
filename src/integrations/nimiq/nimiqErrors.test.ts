import { describe, expect, it } from 'vitest'
import { NimiqIntegrationError, normalizeNimiqError } from './nimiqErrors'

describe('Nimiq error normalization', () => {
  it('maps account permission cancellation', () => {
    const error = normalizeNimiqError({ error: { type: 'PERMISSION_DENIED', message: 'User rejected' } }, 'account')
    expect(error).toBeInstanceOf(NimiqIntegrationError)
    expect(error.code).toBe('ACCOUNT_CANCELLED')
    expect(error.message).toBe('Account access was cancelled.')
  })

  it('maps signature cancellation', () => {
    const error = normalizeNimiqError(new Error('Request cancelled by user'), 'sign')
    expect(error.code).toBe('SIGN_CANCELLED')
    expect(error.message).toBe('Signature request was cancelled.')
  })

  it('maps provider unavailability', () => {
    const error = normalizeNimiqError(new Error('Nimiq provider was not injected. Are you running inside a Nimiq app?'), 'init')
    expect(error.code).toBe('PROVIDER_UNAVAILABLE')
    expect(error.message).toBe('Nimiq Pay provider is unavailable in this browser.')
  })

  it('maps initialization failure when the host is present', () => {
    const error = normalizeNimiqError(new Error('INTERNAL_ERROR: bridge failed'), 'init')
    expect(error.code).toBe('PROVIDER_INIT_FAILED')
    expect(error.message).toBe('Nimiq Pay provider failed to initialize.')
  })

  it('keeps unknown SDK errors instead of swallowing them', () => {
    const error = normalizeNimiqError(new Error('weird provider crash'), 'sign')
    expect(error.code).toBe('UNKNOWN')
    expect(error.message).toBe('An unexpected Nimiq error occurred.')
    expect(error.details).toBeInstanceOf(Error)
  })
})
