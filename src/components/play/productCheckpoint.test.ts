import { afterEach, describe, expect, it, vi } from 'vitest'
import { ExpeditionProofApiError } from '../../api/expeditionProof.ts'
import type { AbandonExpeditionResult, CheckpointAcknowledgement, CheckpointRequest, ProductActiveExpedition, VerifyExpeditionResult } from '../../domain/expeditionProof.ts'
import { deriveCheckpointProgress } from '../../game/replay/checkpointProgress.ts'
import { createInitialRun, replayActions } from '../../game/replay/engine.ts'
import { createRoom01Blueprint } from '../../game/world/room01.ts'
import {
  MISSION_INCOMPLETE_COPY,
  PROOF_LOST_DETAIL,
  PROOF_LOST_TITLE,
  SYNCING_COPY,
  VERIFY_REJECTED_DETAIL,
  createProductCheckpointSession,
  shouldVerifyGameplayEvent,
} from './productCheckpoint.ts'
import { clearRememberedProductTerminal, getRememberedProductTerminal } from './productRunSession.ts'

function active(mission: ProductActiveExpedition['mission'] = 'gem-runner'): ProductActiveExpedition {
  const source = createRoom01Blueprint('2026-09-09', mission, 'checkpoint-client')
  const blueprint = { ...source, status: 'PUBLISHED' as const, blueprintHash: 'b'.repeat(64) }
  const state = createInitialRun({
    mission: blueprint.mission,
    rulesVersion: blueprint.rulesVersion,
    roomVersion: blueprint.roomVersion,
    blueprint,
  })
  return {
    runId: 'run-1',
    dayKey: '2026-09-09',
    mission,
    status: 'STARTED',
    startedAt: '2026-09-09T12:00:00.000Z',
    expiresAt: '2026-09-10T00:00:00.000Z',
    gameplayStartedAt: '2026-09-09T12:01:00.000Z',
    rulesVersion: blueprint.rulesVersion,
    roomVersion: blueprint.roomVersion,
    blueprintVersion: blueprint.blueprintVersion,
    blueprintId: blueprint.blueprintId,
    blueprintHash: blueprint.blueprintHash,
    blueprint,
    state,
    checkpoint: {
      version: 1,
      runId: 'run-1',
      runChallenge: 'run-challenge',
      seq: 0,
      previousCheckpointHash: null,
      stateHash: 'c'.repeat(64),
      transcriptHash: 'd'.repeat(64),
      checkpointHash: 'e'.repeat(64),
    },
  }
}

function matchingAck(expedition: ProductActiveExpedition, request: CheckpointRequest, checkpointHash = 'f'.repeat(64)): CheckpointAcknowledgement {
  const state = replayActions({
    mission: expedition.state.mission,
    rulesVersion: expedition.state.rulesVersion,
    roomVersion: expedition.state.roomVersion,
    blueprint: expedition.state.blueprint,
  }, request.actions)
  return {
    runId: request.runId,
    seqStart: request.actions[0]!.seq,
    seqEnd: request.actions[request.actions.length - 1]!.seq,
    previousCheckpointHash: request.previousCheckpointHash,
    transcriptHash: '1'.repeat(64),
    stateHash: '2'.repeat(64),
    batchFingerprint: '3'.repeat(64),
    ...deriveCheckpointProgress(state, checkpointHash),
  }
}

function verified(expedition: ProductActiveExpedition, checkpointHash: string): VerifyExpeditionResult {
  return {
    runId: expedition.runId,
    checkpointHash,
    outcome: 'VERIFIED_ELIGIBLE',
    status: 'COMPLETED',
    rewardStatus: 'ELIGIBLE',
    finalHp: 100,
    gemsCollected: 6,
    chestsOpened: 0,
    objectiveReached: false,
    hasTempleKey: false,
    missionSatisfied: true,
    finalSeq: 8,
    transcriptHash: '4'.repeat(64),
    stateHash: '5'.repeat(64),
    verifiedAt: '2026-09-09T12:05:00.000Z',
  }
}

function abandoned(expedition: ProductActiveExpedition, checkpointHash: string): AbandonExpeditionResult {
  return {
    runId: expedition.runId,
    checkpointHash,
    outcome: 'ABANDONED',
    status: 'ABANDONED',
    rewardStatus: 'NONE',
  }
}

describe('product checkpoint session', () => {
  afterEach(() => {
    clearRememberedProductTerminal()
  })

  it('sends the first 8 accepted moves and retries the exact batch after a transient failure', async () => {
    const expedition = active()
    const calls: number[][] = []
    const submit = vi.fn(async (request: CheckpointRequest) => {
      calls.push(request.actions.map(action => action.seq))
      if (submit.mock.calls.length === 1) throw new ExpeditionProofApiError('NETWORK_ERROR')
      return matchingAck(expedition, request)
    })
    const session = createProductCheckpointSession(expedition, { submit, retryDelayMs: 0, verify: vi.fn(), abandon: vi.fn() })
    for (let i = 0; i < 8; i += 1) session.recordAcceptedMove(i % 2 === 0 ? 'LEFT' : 'RIGHT')
    await session.flushPending()

    expect(calls).toEqual([
      [1, 2, 3, 4, 5, 6, 7, 8],
      [1, 2, 3, 4, 5, 6, 7, 8],
    ])
    expect(session.snapshot().proofLost).toBe(false)
    session.stop()
  })

  it('enters proof-lost on a non-JSON checkpoint response without converting the run to practice', async () => {
    const submit = vi.fn(async () => {
      throw new ExpeditionProofApiError('MALFORMED_RESPONSE')
    })
    const session = createProductCheckpointSession(active(), { submit, retryDelayMs: 0, verify: vi.fn(), abandon: vi.fn() })
    for (let i = 0; i < 8; i += 1) session.recordAcceptedMove(i % 2 === 0 ? 'LEFT' : 'RIGHT')
    await session.flushPending()
    expect(session.snapshot()).toMatchObject({ proofLost: true, proofState: 'PROOF_LOST', movementPaused: false })
    expect(session.canAcceptMove()).toBe(true)
    session.stop()
  })

  it('enters proof-lost on CHECKPOINT_MISMATCH without converting the run to practice', async () => {
    const submit = vi.fn(async () => {
      throw new ExpeditionProofApiError('CHECKPOINT_MISMATCH')
    })
    const session = createProductCheckpointSession(active(), { submit, retryDelayMs: 0, verify: vi.fn(), abandon: vi.fn() })
    for (let i = 0; i < 8; i += 1) session.recordAcceptedMove(i % 2 === 0 ? 'LEFT' : 'RIGHT')
    await session.flushPending()
    expect(session.snapshot()).toMatchObject({ proofLost: true, proofState: 'PROOF_LOST', movementPaused: false })
    expect(session.canAcceptMove()).toBe(true)
    expect(PROOF_LOST_TITLE).toBe('Reward proof was interrupted.')
    expect(PROOF_LOST_DETAIL).toContain("this run can no longer reserve today's treasure")
    session.stop()
  })

  it('pauses new movement at 16 unacked actions and resumes after acknowledgement', async () => {
    const expedition = active()
    const pending: CheckpointAcknowledgement[] = []
    let release: ((value: CheckpointAcknowledgement) => void) = value => { pending.push(value) }
    const submit = vi.fn((request: CheckpointRequest) => new Promise<CheckpointAcknowledgement>(resolve => {
      release = resolve
      if (pending.length > 0) resolve(pending.shift()!)
      void request
    }))
    const session = createProductCheckpointSession(expedition, { submit, retryDelayMs: 0, verify: vi.fn(), abandon: vi.fn() })
    for (let i = 0; i < 16; i += 1) session.recordAcceptedMove(i % 2 === 0 ? 'LEFT' : 'RIGHT')
    await Promise.resolve()
    expect(session.snapshot().syncing).toBe(true)
    expect(session.snapshot().movementPaused).toBe(true)
    expect(SYNCING_COPY).toBe('Syncing expedition…')
    expect(session.canAcceptMove()).toBe(false)
    expect(submit).toHaveBeenCalledTimes(1)
    const request = submit.mock.calls[0]?.[0]
    if (!request) throw new Error('CHECKPOINT_REQUEST_MISSING')
    release(matchingAck(expedition, request))
    await Promise.resolve()
    await Promise.resolve()
    expect(session.snapshot().movementPaused).toBe(false)
    expect(session.canAcceptMove()).toBe(true)
    session.stop()
  })

  it('flushes pending actions on death, mission complete, vault, and leave', async () => {
    const expedition = active()
    const submit = vi.fn(async (request: CheckpointRequest) => matchingAck(expedition, request))
    const verify = vi.fn(async request => verified(expedition, request.checkpointHash))
    const session = createProductCheckpointSession(expedition, { submit, verify, retryDelayMs: 0, abandon: vi.fn() })
    session.recordAcceptedMove('LEFT')
    session.recordAcceptedMove('RIGHT')
    session.notifyGameplayEvent('DEATH')
    await session.flushPending()
    expect(submit).toHaveBeenCalledTimes(1)
    expect(submit.mock.calls[0]?.[0].actions).toHaveLength(2)
    expect(verify).toHaveBeenCalledTimes(1)
    session.stop()
  })

  it('waits for the terminal checkpoint ACK before calling verify', async () => {
    const expedition = active()
    const held: { release: ((value: CheckpointAcknowledgement) => void) | null } = { release: null }
    const submit = vi.fn((request: CheckpointRequest) => new Promise<CheckpointAcknowledgement>(resolve => {
      held.release = resolve
      void request
    }))
    const verify = vi.fn(async request => verified(expedition, request.checkpointHash))
    const session = createProductCheckpointSession(expedition, { submit, verify, retryDelayMs: 0, abandon: vi.fn() })
    session.recordAcceptedMove('LEFT')
    session.notifyGameplayEvent('MISSION_COMPLETE')
    await Promise.resolve()
    expect(verify).not.toHaveBeenCalled()
    expect(session.snapshot().syncing || session.snapshot().verifying).toBe(true)
    const request = submit.mock.calls[0]?.[0]
    if (!request || !held.release) throw new Error('CHECKPOINT_REQUEST_MISSING')
    const ack = matchingAck(expedition, request)
    held.release(ack)
    await session.flushPending()
    expect(verify).toHaveBeenCalledTimes(1)
    expect(verify).toHaveBeenCalledWith({ runId: expedition.runId, checkpointHash: ack.checkpointHash })
    expect(session.snapshot()).toMatchObject({ verifiedEligible: true, proofState: 'VERIFIED_ELIGIBLE', verifying: false })
    expect(getRememberedProductTerminal('gem-runner', expedition.runId)?.result.outcome).toBe('VERIFIED_ELIGIBLE')
    session.stop()
  })

  it('does not call verify while actions remain unacked', async () => {
    const expedition = active()
    const submit = vi.fn(() => new Promise<CheckpointAcknowledgement>(() => {}))
    const verify = vi.fn()
    const session = createProductCheckpointSession(expedition, { submit, verify, retryDelayMs: 0, abandon: vi.fn() })
    session.recordAcceptedMove('LEFT')
    session.notifyGameplayEvent('MISSION_COMPLETE')
    await Promise.resolve()
    await Promise.resolve()
    expect(submit).toHaveBeenCalledTimes(1)
    expect(verify).not.toHaveBeenCalled()
    expect(session.snapshot().verifiedEligible).toBe(false)
    session.stop()
  })

  it('abandons an alive incomplete leave after flushing checkpoints', async () => {
    const expedition = active()
    const submit = vi.fn(async (request: CheckpointRequest) => matchingAck(expedition, request))
    const verify = vi.fn()
    const abandonFn = vi.fn(async request => abandoned(expedition, request.checkpointHash))
    const session = createProductCheckpointSession(expedition, { submit, verify, abandon: abandonFn, retryDelayMs: 0 })
    session.recordAcceptedMove('LEFT')
    await session.leaveAndAbandon()
    expect(submit).toHaveBeenCalledTimes(1)
    expect(verify).not.toHaveBeenCalled()
    expect(abandonFn).toHaveBeenCalledTimes(1)
    session.stop()
  })

  it('freezes movement after VAULT_GAMEPLAY_VERIFIED and does not abandon or keep sending checkpoints', async () => {
    const expedition = { ...active(), mission: 'vault-breaker' as const }
    const submit = vi.fn()
    const verify = vi.fn(async (request: { readonly checkpointHash: string }) => ({
      ...verified(expedition, request.checkpointHash),
      outcome: 'VAULT_GAMEPLAY_VERIFIED' as const,
      status: 'STARTED' as const,
      rewardStatus: 'NONE' as const,
      missionSatisfied: false,
      objectiveReached: true,
      hasTempleKey: true,
    }))
    const abandonFn = vi.fn()
    const session = createProductCheckpointSession(expedition, { submit, verify, abandon: abandonFn, retryDelayMs: 0 })
    session.notifyGameplayEvent('VAULT_REACHED')
    await session.flushPending()
    expect(verify).toHaveBeenCalledTimes(1)
    expect(session.snapshot()).toMatchObject({
      vaultGameplayVerified: true,
      proofState: 'VAULT_GAMEPLAY_VERIFIED',
      movementPaused: true,
    })
    expect(session.canAcceptMove()).toBe(false)
    session.recordAcceptedMove('LEFT')
    expect(submit).not.toHaveBeenCalled()
    await session.leaveAndAbandon()
    expect(abandonFn).not.toHaveBeenCalled()
    expect(getRememberedProductTerminal('vault-breaker', expedition.runId)?.result.outcome).toBe('VAULT_GAMEPLAY_VERIFIED')
    session.stop()
  })

  it('does not terminal-verify Gem Runner or Chest Hunter on VAULT_REACHED', async () => {
    expect(shouldVerifyGameplayEvent('gem-runner', 'VAULT_REACHED')).toBe(false)
    expect(shouldVerifyGameplayEvent('chest-hunter', 'VAULT_REACHED')).toBe(false)
    expect(shouldVerifyGameplayEvent('vault-breaker', 'VAULT_REACHED')).toBe(true)
    expect(shouldVerifyGameplayEvent('chest-hunter', 'MISSION_COMPLETE')).toBe(true)
    expect(shouldVerifyGameplayEvent('gem-runner', 'DEATH')).toBe(true)

    for (const mission of ['gem-runner', 'chest-hunter'] as const) {
      const expedition = active(mission)
      const verify = vi.fn()
      const session = createProductCheckpointSession(expedition, { submit: vi.fn(), verify, retryDelayMs: 0, abandon: vi.fn() })
      session.notifyGameplayEvent('VAULT_REACHED')
      await session.flushPending()
      expect(verify, mission).not.toHaveBeenCalled()
      expect(session.snapshot()).toMatchObject({
        verifying: false,
        verifyRejected: false,
        proofLost: false,
        missionIncomplete: false,
        movementPaused: false,
      })
      expect(session.canAcceptMove()).toBe(true)
      session.stop()
    }
  })

  it('verifies Chest Hunter only after MISSION_COMPLETE, not 3/4 plus shrine reach', async () => {
    const expedition = active('chest-hunter')
    const verify = vi.fn(async request => verified(expedition, request.checkpointHash))
    const session = createProductCheckpointSession(expedition, { submit: vi.fn(), verify, retryDelayMs: 0, abandon: vi.fn() })
    session.notifyGameplayEvent('VAULT_REACHED')
    await session.flushPending()
    expect(verify).not.toHaveBeenCalled()
    session.notifyGameplayEvent('MISSION_COMPLETE')
    await session.flushPending()
    expect(verify).toHaveBeenCalledTimes(1)
    expect(session.snapshot().verifiedEligible).toBe(true)
    session.stop()
  })

  it('verifies Gem Runner only after MISSION_COMPLETE, not 5/6 plus shrine reach', async () => {
    const expedition = active('gem-runner')
    const verify = vi.fn(async request => verified(expedition, request.checkpointHash))
    const session = createProductCheckpointSession(expedition, { submit: vi.fn(), verify, retryDelayMs: 0, abandon: vi.fn() })
    session.notifyGameplayEvent('VAULT_REACHED')
    await session.flushPending()
    expect(verify).not.toHaveBeenCalled()
    session.notifyGameplayEvent('MISSION_COMPLETE')
    await session.flushPending()
    expect(verify).toHaveBeenCalledTimes(1)
    expect(session.snapshot().verifiedEligible).toBe(true)
    session.stop()
  })

  it('restores gameplay on RUN_INCOMPLETE without proof mismatch or reservation copy', async () => {
    const expedition = active('chest-hunter')
    const verify = vi.fn()
      .mockRejectedValueOnce(new ExpeditionProofApiError('RUN_INCOMPLETE'))
      .mockResolvedValueOnce(verified(expedition, 'e'.repeat(64)))
    const session = createProductCheckpointSession(expedition, { submit: vi.fn(), verify, retryDelayMs: 0, abandon: vi.fn() })
    session.notifyGameplayEvent('MISSION_COMPLETE')
    await session.flushPending()
    expect(session.snapshot()).toMatchObject({
      proofLost: false,
      verifyRejected: false,
      verifying: false,
      missionIncomplete: true,
      movementPaused: false,
      verifiedEligible: false,
    })
    expect(session.canAcceptMove()).toBe(true)
    expect(MISSION_INCOMPLETE_COPY).toBe('Mission objective is not complete yet.')
    expect(VERIFY_REJECTED_DETAIL).toBe('This expedition could not be verified. Starting a new expedition is safe.')
    expect(VERIFY_REJECTED_DETAIL.toLowerCase()).not.toMatch(/reserv/)
    expect(MISSION_INCOMPLETE_COPY.toLowerCase()).not.toMatch(/reserv/)

    session.notifyGameplayEvent('MISSION_COMPLETE')
    await session.flushPending()
    expect(verify).toHaveBeenCalledTimes(2)
    expect(session.snapshot()).toMatchObject({ verifiedEligible: true, missionIncomplete: false })
    session.stop()
  })
})
