import { describe, expect, it } from 'vitest'
import {
  initialProductVaultSealState,
  reduceProductVaultSeal,
  shortenNqWallet,
  shortenProofHash,
} from './productVaultSeal.ts'

const proof = {
  runId: 'run-1',
  wallet: 'NQ07 33E4 6T32 24Y7 X4BA 7SP2 27TX 32PL 54JG',
  canonicalPayload: '{}',
  vaultSealHash: 'ab'.repeat(32),
  publicKey: 'cd'.repeat(32),
  vaultCheckpointHash: 'ef'.repeat(32),
  verifiedAt: '2026-09-09T12:10:00.000Z',
}

describe('product Vault seal client state', () => {
  it('keeps cancellation and failures retryable until a verified proof arrives', () => {
    const sealing = reduceProductVaultSeal(initialProductVaultSealState, { type: 'SEAL_REQUESTED' })
    expect(sealing.status).toBe('SEALING')
    const cancelled = reduceProductVaultSeal(sealing, { type: 'SEAL_CANCELLED' })
    expect(cancelled).toMatchObject({ status: 'CANCELLED', error: 'Signature request was cancelled.' })
    const retry = reduceProductVaultSeal(cancelled, { type: 'SEAL_REQUESTED' })
    expect(retry.status).toBe('SEALING')
    const failed = reduceProductVaultSeal(retry, { type: 'SEAL_FAILED', message: 'The signature does not match this treasure.' })
    expect(failed.status).toBe('REJECTED')
    const verified = reduceProductVaultSeal(failed, { type: 'SEAL_REQUESTED' })
    const done = reduceProductVaultSeal(verified, { type: 'SEAL_VERIFIED', proof })
    expect(done).toMatchObject({ status: 'VERIFIED', proof })
    expect(reduceProductVaultSeal(done, { type: 'SEAL_REQUESTED' }).status).toBe('VERIFIED')
  })

  it('shortens wallet and hash metadata without exposing the full values', () => {
    expect(shortenNqWallet(proof.wallet)).toBe('NQ0733…54JG')
    expect(shortenProofHash(proof.vaultSealHash)).toBe('abababab…')
  })
})
