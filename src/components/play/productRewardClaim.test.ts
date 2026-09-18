import { describe, expect, it } from 'vitest'
import {
  initialProductRewardClaimState,
  reduceProductRewardClaim,
} from './productRewardClaim.ts'

const reserved = {
  outcome: 'RESERVED' as const,
  claimId: 'claim-1',
  runId: 'run-1',
  reservationNumber: 1,
  remainingSlots: 68,
  totalSlots: 69 as const,
  finalizedAt: '2026-09-09T12:10:00.000Z',
}

describe('product reward claim client state', () => {
  it('keeps cancellation retryable and does not consume a local slot', () => {
    const signing = reduceProductRewardClaim(initialProductRewardClaimState, { type: 'CLAIM_REQUESTED' })
    expect(signing.status).toBe('SIGNING')
    const cancelled = reduceProductRewardClaim(signing, { type: 'CLAIM_CANCELLED' })
    expect(cancelled).toMatchObject({ status: 'CANCELLED', error: 'Signature request was cancelled.' })
    const retry = reduceProductRewardClaim(cancelled, { type: 'CLAIM_REQUESTED' })
    expect(retry.status).toBe('SIGNING')
    const done = reduceProductRewardClaim(retry, { type: 'CLAIM_FINALIZED', result: reserved })
    expect(done).toMatchObject({ status: 'RESERVED', result: reserved })
    expect(reduceProductRewardClaim(done, { type: 'CLAIM_REQUESTED' }).status).toBe('RESERVED')
  })

  it('surfaces sold out and already reserved without another signature request', () => {
    const signing = reduceProductRewardClaim(initialProductRewardClaimState, { type: 'CLAIM_REQUESTED' })
    const soldOut = reduceProductRewardClaim(signing, {
      type: 'CLAIM_PREPARED_TERMINAL',
      result: {
        outcome: 'SOLD_OUT',
        claimId: 'claim-2',
        runId: 'run-1',
        expiresAt: '2026-09-10T00:00:00.000Z',
        reservationNumber: null,
        remainingSlots: 0,
        totalSlots: 69,
      },
    })
    expect(soldOut.status).toBe('SOLD_OUT')
    const already = reduceProductRewardClaim(initialProductRewardClaimState, {
      type: 'CLAIM_PREPARED_TERMINAL',
      result: {
        outcome: 'ALREADY_REWARDED',
        claimId: 'claim-3',
        runId: 'run-2',
        expiresAt: '2026-09-10T00:00:00.000Z',
        reservationNumber: null,
        remainingSlots: 68,
        totalSlots: 69,
      },
    })
    expect(already.status).toBe('ALREADY_REWARDED')
  })
})

  it('keeps review and block terminal without signing', () => {
    const signing = reduceProductRewardClaim(initialProductRewardClaimState, { type: 'CLAIM_REQUESTED' })
    const review = reduceProductRewardClaim(signing, {
      type: 'CLAIM_PREPARED_TERMINAL',
      result: { outcome: 'REVIEW', runId: 'run-9' },
    })
    expect(review.status).toBe('REVIEW')
    expect(reduceProductRewardClaim(review, { type: 'CLAIM_REQUESTED' }).status).toBe('REVIEW')
    const blocked = reduceProductRewardClaim(initialProductRewardClaimState, {
      type: 'CLAIM_PREPARED_TERMINAL',
      result: { outcome: 'BLOCK', runId: 'run-9', reasonCategory: 'TIMING' },
    })
    expect(blocked.status).toBe('BLOCK')
  })

describe('session block retry', () => {
  it('retries eligibility only for SESSION blocks; TIMING/ELIGIBILITY stay terminal', () => {
    const sessionBlocked = reduceProductRewardClaim(initialProductRewardClaimState, {
      type: 'CLAIM_PREPARED_TERMINAL',
      result: { outcome: 'BLOCK', runId: 'run-9', reasonCategory: 'SESSION' },
    })
    expect(sessionBlocked.status).toBe('BLOCK')
    expect(reduceProductRewardClaim(sessionBlocked, { type: 'CLAIM_REQUESTED' }).status).toBe('SIGNING')

    const timingBlocked = reduceProductRewardClaim(initialProductRewardClaimState, {
      type: 'CLAIM_PREPARED_TERMINAL',
      result: { outcome: 'BLOCK', runId: 'run-9', reasonCategory: 'TIMING' },
    })
    expect(reduceProductRewardClaim(timingBlocked, { type: 'CLAIM_REQUESTED' }).status).toBe('BLOCK')

    const eligibilityBlocked = reduceProductRewardClaim(initialProductRewardClaimState, {
      type: 'CLAIM_PREPARED_TERMINAL',
      result: { outcome: 'BLOCK', runId: 'run-9', reasonCategory: 'ELIGIBILITY' },
    })
    expect(reduceProductRewardClaim(eligibilityBlocked, { type: 'CLAIM_REQUESTED' }).status).toBe('BLOCK')
  })
})
