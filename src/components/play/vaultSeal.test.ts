import { describe, expect, it } from 'vitest'
import { evaluateMission } from '../../game/domain/mission'
import { createRunState } from '../../game/domain/runState'
import { createInitialHUDState } from '../../game/events/gameEvents'
import {
  initialVaultSealState,
  isVaultBreakerComplete,
  reduceVaultSeal,
  shouldShowVaultOverlay,
  vaultRejectionCopy,
} from './vaultSeal'

describe('Vault Breaker two-stage completion', () => {
  it('reaching the Vault does not complete the mission by itself', () => {
    const run = { ...createRunState(), gemsCollected: 6, chestsOpened: 4, hp: 80 }
    const next = evaluateMission(run, 'vault-breaker')
    expect(next.runStatus).toBe('PLAYING')
    expect(next.missionStatus).toBe('IN_PROGRESS')
  })

  it('death at the Vault still fails a Vault Breaker run', () => {
    const run = { ...createRunState(), hp: 0 }
    expect(evaluateMission(run, 'vault-breaker').runStatus).toBe('FAILED')
  })

  it('requires both the Vault reach and a verified seal', () => {
    expect(isVaultBreakerComplete({ vaultReached: true, sealVerified: true })).toBe(true)
    expect(isVaultBreakerComplete({ vaultReached: true, sealVerified: false })).toBe(false)
    expect(isVaultBreakerComplete({ vaultReached: false, sealVerified: true })).toBe(false)
    expect(isVaultBreakerComplete({ vaultReached: false, sealVerified: false })).toBe(false)
  })

  it('opens the Vault overlay only when alive and playing at the objective', () => {
    const reached = { ...createInitialHUDState('vault-breaker'), objectiveReached: true }
    expect(shouldShowVaultOverlay(reached, 'vault-breaker')).toBe(true)
    expect(shouldShowVaultOverlay({ ...reached, hp: 0 }, 'vault-breaker')).toBe(false)
    expect(shouldShowVaultOverlay({ ...reached, runStatus: 'FAILED' as const }, 'vault-breaker')).toBe(false)
    expect(shouldShowVaultOverlay({ ...reached, objectiveReached: false }, 'vault-breaker')).toBe(false)
    expect(shouldShowVaultOverlay({ ...createInitialHUDState('gem-runner'), objectiveReached: true }, 'gem-runner')).toBe(false)
  })
})

describe('Vault seal state machine', () => {
  it('starts unsealed with no wallet or proof', () => {
    expect(initialVaultSealState).toMatchObject({ status: 'UNSEALED', wallet: null, proof: null, error: null })
  })

  it('requests an account only after a deliberate seal action', () => {
    const next = reduceVaultSeal(initialVaultSealState, { type: 'SEAL_REQUESTED' })
    expect(next.status).toBe('REQUESTING_ACCOUNT')
    expect(next.error).toBe(null)
  })

  it('signs after the account arrives and verifies after the signature', () => {
    const awaiting = reduceVaultSeal(reduceVaultSeal(initialVaultSealState, { type: 'SEAL_REQUESTED' }), {
      type: 'ACCOUNT_RECEIVED',
      wallet: 'NQ07 TEST',
    })
    expect(awaiting).toMatchObject({ status: 'AWAITING_SIGNATURE', wallet: 'NQ07 TEST' })
    const verifying = reduceVaultSeal(awaiting, {
      type: 'SIGNATURE_RECEIVED',
      proof: { publicKey: 'pk', signature: 'sig', message: 'msg' },
    })
    expect(verifying.status).toBe('VERIFYING')
    expect(verifying.proof).toMatchObject({ publicKey: 'pk', signature: 'sig', message: 'msg' })
  })

  it('stays incomplete with a retry message when account access is cancelled', () => {
    const next = reduceVaultSeal(reduceVaultSeal(initialVaultSealState, { type: 'SEAL_REQUESTED' }), {
      type: 'ACCOUNT_FAILED',
      message: 'Account access was cancelled.',
    })
    expect(next.status).toBe('UNSEALED')
    expect(next.error).toBe('Account access was cancelled.')
    expect(isVaultBreakerComplete({ vaultReached: true, sealVerified: next.status === 'VERIFIED' })).toBe(false)
  })

  it('stays incomplete with a retry message when signing is cancelled', () => {
    const awaiting = reduceVaultSeal(reduceVaultSeal(initialVaultSealState, { type: 'SEAL_REQUESTED' }), {
      type: 'ACCOUNT_RECEIVED',
      wallet: 'NQ07 TEST',
    })
    const next = reduceVaultSeal(awaiting, { type: 'SIGNATURE_FAILED', message: 'Signature request was cancelled.' })
    expect(next.status).toBe('UNSEALED')
    expect(next.error).toBe('Signature request was cancelled.')
    expect(next.wallet).toBe('NQ07 TEST')
  })

  it('stays in the browser fallback without faking a seal when the provider is missing', () => {
    const next = reduceVaultSeal(reduceVaultSeal(initialVaultSealState, { type: 'SEAL_REQUESTED' }), {
      type: 'PROVIDER_MISSING',
    })
    expect(next.status).toBe('UNSEALED')
    expect(next.error).toBe('Open NimHunt inside Nimiq Pay to seal this treasure.')
    expect(next.proof).toBe(null)
  })

  it('completes only on a valid verification and keeps the proof', () => {
    const verifying = reduceVaultSeal(
      reduceVaultSeal(reduceVaultSeal(initialVaultSealState, { type: 'SEAL_REQUESTED' }), {
        type: 'ACCOUNT_RECEIVED',
        wallet: 'NQ07 TEST',
      }),
      { type: 'SIGNATURE_RECEIVED', proof: { publicKey: 'pk', signature: 'sig', message: 'msg' } },
    )
    const verified = reduceVaultSeal(verifying, {
      type: 'VERIFICATION_DONE',
      result: { valid: true, signatureValid: true, addressMatches: true, payloadHash: 'ab'.repeat(32) },
    })
    expect(verified.status).toBe('VERIFIED')
    expect(verified.proof).not.toBe(null)
    expect(isVaultBreakerComplete({ vaultReached: true, sealVerified: verified.status === 'VERIFIED' })).toBe(true)
  })

  it('rejects without completing on an invalid verification and allows retry', () => {
    const verifying = reduceVaultSeal(
      reduceVaultSeal(reduceVaultSeal(initialVaultSealState, { type: 'SEAL_REQUESTED' }), {
        type: 'ACCOUNT_RECEIVED',
        wallet: 'NQ07 TEST',
      }),
      { type: 'SIGNATURE_RECEIVED', proof: { publicKey: 'pk', signature: 'sig', message: 'msg' } },
    )
    const rejected = reduceVaultSeal(verifying, {
      type: 'VERIFICATION_DONE',
      result: { valid: false, signatureValid: false, addressMatches: false, reason: 'INVALID_SIGNATURE' },
    })
    expect(rejected.status).toBe('REJECTED')
    expect(isVaultBreakerComplete({ vaultReached: true, sealVerified: rejected.status === 'VERIFIED' })).toBe(false)
    const retry = reduceVaultSeal(rejected, { type: 'SEAL_REQUESTED' })
    expect(retry.status).toBe('REQUESTING_ACCOUNT')
  })

  it('leaves Gem Runner and Chest Hunter evaluation unchanged', () => {
    expect(evaluateMission({ ...createRunState(), gemsCollected: 6, hp: 60 }).runStatus).toBe('MISSION_COMPLETE')
    expect(evaluateMission({ ...createRunState(), chestsOpened: 4, hp: 60 }, 'chest-hunter').runStatus).toBe('MISSION_COMPLETE')
    expect(evaluateMission({ ...createRunState(), gemsCollected: 2, hp: 60 }, 'chest-hunter').runStatus).toBe('PLAYING')
  })

  it('explains seal rejections without technical detail', () => {
    expect(vaultRejectionCopy('INVALID_SIGNATURE')).toBe('The signature does not match this treasure.')
    expect(vaultRejectionCopy('ADDRESS_MISMATCH')).toBe('The signing wallet does not match this expedition.')
    expect(vaultRejectionCopy('REQUEST_FAILED')).toBe('Verification could not be reached. Check your connection and try again.')
    expect(vaultRejectionCopy(undefined)).toBe('The seal could not be verified.')
  })
})
