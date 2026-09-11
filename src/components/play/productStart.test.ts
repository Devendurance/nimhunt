import { describe, expect, it } from 'vitest'
import type { StartChallengeResponse } from '../../domain/expeditionProof.ts'
import type { MissionType } from '../../game/replay/types.ts'
import {
  INITIAL_PRODUCT_START_STATE,
  PRODUCT_START_COPY,
  createProductStartAttemptGuard,
  reduceProductStart,
  type ProductStartState,
} from './productStart.ts'

const challenge: StartChallengeResponse = {
  wallet: 'NQ00 TEST WALLET',
  challenge: 'challenge',
  blueprintId: 'blueprint-1',
  blueprintHash: 'a'.repeat(64),
  dayKey: '2026-09-09',
  expiresAt: '2026-09-09T12:05:00.000Z',
}

function begin(mission: MissionType = 'gem-runner'): ProductStartState {
  return reduceProductStart(INITIAL_PRODUCT_START_STATE, { type: 'BEGIN', mission })
}

describe('product start state machine', () => {
  it('allows only one begin transition while idle', () => {
    const started = begin()
    const duplicate = reduceProductStart(started, { type: 'BEGIN', mission: 'chest-hunter' })

    expect(started.status).toBe('REQUESTING_ACCOUNT')
    expect(duplicate).toBe(started)
    expect(duplicate.mission).toBe('gem-runner')
  })

  it('requires explicit selection when the provider returns multiple accounts', () => {
    const selecting = reduceProductStart(begin(), {
      type: 'ACCOUNTS_RECEIVED',
      accounts: ['NQ00 FIRST', 'NQ00 SECOND'],
    })
    const requesting = reduceProductStart(selecting, { type: 'ACCOUNT_SELECTED', account: 'NQ00 SECOND' })
    const changed = reduceProductStart(requesting, { type: 'ACCOUNT_SELECTED', account: 'NQ00 FIRST' })

    expect(selecting).toMatchObject({ status: 'SELECTING_ACCOUNT', accounts: ['NQ00 FIRST', 'NQ00 SECOND'] })
    expect(requesting).toMatchObject({ status: 'REQUESTING_CHALLENGE', selectedAccount: 'NQ00 SECOND' })
    expect(changed).toBe(requesting)
  })

  it('retains the exact signed request for a lost start response', () => {
    const awaiting = reduceProductStart(
      reduceProductStart(begin(), { type: 'ACCOUNTS_RECEIVED', accounts: ['NQ00 FIRST'] }),
      { type: 'CHALLENGE_RECEIVED', challenge, canonicalPayload: 'canonical-payload' },
    )
    const submitting = reduceProductStart(awaiting, {
      type: 'SIGNATURE_SUBMITTED',
      signed: { payload: 'canonical-payload', publicKey: 'public-key', signature: 'signature' },
    })
    const recovering = reduceProductStart(submitting, { type: 'START_NETWORK_FAILURE' })

    expect(awaiting.status).toBe('AWAITING_START_SIGNATURE')
    expect(recovering).toMatchObject({
      status: 'RECOVERING_START',
      signed: submitting.signed,
      canonicalPayload: 'canonical-payload',
    })
  })

  it('clears transient values when a flow is cancelled', () => {
    const awaiting = reduceProductStart(
      reduceProductStart(begin(), { type: 'ACCOUNTS_RECEIVED', accounts: ['NQ00 FIRST'] }),
      { type: 'CHALLENGE_RECEIVED', challenge, canonicalPayload: 'canonical-payload' },
    )
    const cancelled = reduceProductStart(awaiting, { type: 'CANCEL' })

    expect(cancelled).toMatchObject({
      status: 'CANCELLED',
      mission: null,
      accounts: [],
      selectedAccount: null,
      challenge: null,
      canonicalPayload: null,
      signed: null,
      start: null,
    })
    expect(PRODUCT_START_COPY.CANCELLED).toBe('Expedition start was cancelled. No daily expedition was used.')
  })

  it('keeps daily-limit copy distinct from mission availability and Practice', () => {
    expect(PRODUCT_START_COPY.LIMIT_REACHED).toBe("You've used today's 3 reward-eligible expeditions.")
    expect(PRODUCT_START_COPY.LIMIT_REACHED).not.toContain('AVAILABLE')
    expect(PRODUCT_START_COPY.LIMIT_REACHED).not.toContain('Practice')
  })

  it('ignores stale attempt tokens after invalidation', () => {
    const guard = createProductStartAttemptGuard()
    const first = guard.start()
    guard.invalidate()
    const second = guard.start()

    expect(guard.isCurrent(first)).toBe(false)
    expect(guard.isCurrent(second)).toBe(true)
  })

  it('only exposes a start result after the started transition', () => {
    const pending = begin()
    const failed = reduceProductStart(pending, { type: 'FAILURE', status: 'PROOF_UNAVAILABLE', errorCode: 'PROOF_UNAVAILABLE' })
    const complete = reduceProductStart(
      reduceProductStart(
        reduceProductStart(
          reduceProductStart(begin(), { type: 'ACCOUNTS_RECEIVED', accounts: ['NQ00 FIRST'] }),
          { type: 'CHALLENGE_RECEIVED', challenge, canonicalPayload: 'canonical-payload' },
        ),
        { type: 'SIGNATURE_SUBMITTED', signed: { payload: 'canonical-payload', publicKey: 'public-key', signature: 'signature' } },
      ),
      { type: 'START_SUCCEEDED', start: { runId: 'run-1' } as ProductStartState['start'] & object },
    )

    expect(pending.start).toBeNull()
    expect(failed.start).toBeNull()
    expect(complete.status).toBe('STARTED')
    expect(complete.start).toMatchObject({ runId: 'run-1' })
  })
})
