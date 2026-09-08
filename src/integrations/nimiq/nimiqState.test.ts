import { describe, expect, it } from 'vitest'
import { createNimiqError } from './nimiqErrors'
import { initialNimiqState, reduceNimiqState } from './nimiqState'

describe('Nimiq provider state transitions', () => {
  it('starts uninitialized and idle', () => {
    expect(initialNimiqState.providerStatus).toBe('uninitialized')
    expect(initialNimiqState.account).toBeNull()
    expect(initialNimiqState.signature).toBeNull()
  })

  it('marks a normal browser as unavailable without faking an account', () => {
    const next = reduceNimiqState(initialNimiqState, { type: 'HOST_UNAVAILABLE' })
    expect(next.environment).toBe('browser')
    expect(next.providerStatus).toBe('unavailable')
    expect(next.account).toBeNull()
    expect(next.signature).toBeNull()
    expect(next.error?.code).toBe('PROVIDER_UNAVAILABLE')
  })

  it('moves initializing → ready inside Nimiq Pay', () => {
    const starting = reduceNimiqState(initialNimiqState, { type: 'INIT_START' })
    expect(starting.providerStatus).toBe('initializing')
    expect(starting.environment).toBe('nimiq-pay')

    const ready = reduceNimiqState(starting, { type: 'INIT_READY' })
    expect(ready.providerStatus).toBe('ready')
    expect(ready.accountStatus).toBe('idle')
  })

  it('records initialization failure', () => {
    const next = reduceNimiqState(
      reduceNimiqState(initialNimiqState, { type: 'INIT_START' }),
      { type: 'INIT_ERROR', error: createNimiqError('PROVIDER_INIT_FAILED') },
    )
    expect(next.providerStatus).toBe('error')
    expect(next.error?.code).toBe('PROVIDER_INIT_FAILED')
  })

  it('keeps the account after a cancelled signature', () => {
    const withAccount = reduceNimiqState(initialNimiqState, {
      type: 'ACCOUNT_SUCCESS',
      address: 'NQ07 TEST',
      accounts: ['NQ07 TEST'],
    })
    const cancelled = reduceNimiqState(withAccount, {
      type: 'SIGN_ERROR',
      error: createNimiqError('SIGN_CANCELLED'),
    })
    expect(cancelled.account).toBe('NQ07 TEST')
    expect(cancelled.signStatus).toBe('error')
    expect(cancelled.signature).toBeNull()
    expect(cancelled.error?.message).toBe('Signature request was cancelled.')
  })

  it('resets verification when a new signature arrives', () => {
    const withAccount = reduceNimiqState(initialNimiqState, {
      type: 'ACCOUNT_SUCCESS',
      address: 'NQ07 TEST',
      accounts: ['NQ07 TEST'],
    })
    const verified = reduceNimiqState(
      reduceNimiqState(withAccount, { type: 'VERIFY_START' }),
      {
        type: 'VERIFY_SUCCESS',
        result: { valid: true, signatureValid: true, addressMatches: true, payloadHash: 'abc', wallet: 'NQ07 TEST' },
      },
    )
    expect(verified.verifyStatus).toBe('success')

    const signed = reduceNimiqState(verified, {
      type: 'SIGN_SUCCESS',
      proof: {
        publicKey: 'pub',
        signature: 'sig',
        message: '{}',
        payload: {
          version: 1,
          type: 'NIMHUNT_TEST_SEAL',
          wallet: 'NQ07 TEST',
          mission: 'VAULT_BREAKER',
          environment: 'development',
        },
        completedAt: '2026-09-07T00:00:00.000Z',
      },
    })
    expect(signed.verifyStatus).toBe('idle')
    expect(signed.verification).toBeNull()
  })
})
