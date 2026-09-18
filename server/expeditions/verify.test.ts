import { KeyPair } from '@nimiq/core'
import { describe, expect, it } from 'vitest'
import { parseAbandonExpeditionResult, parseVerifyExpeditionResult } from '../../src/api/expeditionProof.ts'
import { hashBlueprint, hashReplayState, hashTranscript } from '../../src/game/replay/canonical.ts'
import { createRoom01Blueprint } from '../../src/game/world/room01.ts'
import type { Direction, MoveAction } from '../../src/game/replay/types.ts'
import { PREVALIDATED_ROOM_01_BOOTSTRAP_WINNING_SEQUENCES } from './room01BootstrapPrevalidation.ts'
import { serializeStartPayload, type StartExpeditionPayload } from './canonical.ts'
import { nimiqSignedMessageHash } from './crypto.ts'
import { ProofError } from './errors.ts'
import { dispatchExpeditionHttp, type ExpeditionHttpSecurity } from './http.ts'
import { createMemoryProofService } from './memoryProofStore.ts'
import { serializeRunSessionCookie } from './session.ts'
import { reconstructActionsFromBatches, verifyExpeditionRun } from './verify.ts'

const SECURITY: ExpeditionHttpSecurity = {
  expectedOrigin: 'https://hunt.example',
  expectedHost: 'hunt.example',
  expectedProtocol: 'https',
  secureCookie: true,
}

function publishedBlueprint(mission: 'gem-runner' | 'chest-hunter' | 'vault-breaker' = 'gem-runner') {
  const source = createRoom01Blueprint('2026-09-09', mission, `verify-blueprint-${mission}`)
  return { ...source, status: 'PUBLISHED' as const, blueprintHash: hashBlueprint(source) }
}

function fixture(mission: 'gem-runner' | 'chest-hunter' | 'vault-breaker' = 'gem-runner') {
  let current = new Date('2026-09-09T12:00:00.000Z')
  const service = createMemoryProofService({ clock: { now: () => current }, blueprints: [publishedBlueprint(mission)] })
  const keyPair = KeyPair.generate()
  const wallet = keyPair.toAddress().toUserFriendlyAddress()
  return { service, keyPair, wallet, mission, setNow: (value: string) => { current = new Date(value) } }
}

function decodeSequence(encoded: string): Direction[] {
  return [...encoded].map(character => {
    if (character === 'U') return 'UP'
    if (character === 'D') return 'DOWN'
    if (character === 'L') return 'LEFT'
    if (character === 'R') return 'RIGHT'
    throw new Error(`INVALID_SEQUENCE_CHAR:${character}`)
  })
}

function moves(start: number, directions: readonly Direction[]): MoveAction[] {
  return directions.map((direction, index) => ({ seq: start + index, type: 'MOVE' as const, direction }))
}

function headers(cookie: string, overrides: Record<string, string | undefined> = {}) {
  return {
    origin: SECURITY.expectedOrigin,
    host: SECURITY.expectedHost,
    protocol: SECURITY.expectedProtocol,
    'content-type': 'application/json',
    cookie,
    ...overrides,
  }
}

async function startPlaying(mission: 'gem-runner' | 'chest-hunter' | 'vault-breaker' = 'gem-runner') {
  const started = fixture(mission)
  const challenge = await started.service.issueStartChallenge(started.wallet, mission)
  const payload: StartExpeditionPayload = {
    version: 1,
    type: 'NIMHUNT_START_EXPEDITION',
    wallet: challenge.wallet,
    mission,
    dayKey: challenge.dayKey,
    challenge: challenge.challenge,
    blueprintId: challenge.blueprintId,
    blueprintHash: challenge.blueprintHash,
  }
  const canonicalPayload = serializeStartPayload(payload)
  const authorized = await started.service.authorizeStart({
    payload: canonicalPayload,
    publicKey: started.keyPair.publicKey.toHex(),
    signature: started.keyPair.sign(nimiqSignedMessageHash(canonicalPayload)).toHex(),
  })
  started.service.markGameplayStarted(authorized.start.runId, authorized.session)
  const run = started.service.getRun(authorized.start.runId)
  if (!run) throw new Error('RUN_MISSING')
  const cookie = serializeRunSessionCookie(
    authorized.sessionCapability,
    new Date(authorized.session.expiresAt),
    new Date(authorized.session.createdAt),
    true,
  )
  return { ...started, authorized, run, cookie }
}

async function playSequence(
  service: ReturnType<typeof createMemoryProofService>,
  session: { readonly sessionHash: string; readonly runId: string; readonly wallet: string; readonly createdAt: string; readonly expiresAt: string; readonly revokedAt: string | null },
  runId: string,
  encoded: string,
) {
  const directions = decodeSequence(encoded)
  for (let index = 0; index < directions.length; index += 8) {
    const current = service.getRun(runId)
    if (!current) throw new Error('RUN_MISSING')
    const batch = directions.slice(index, index + 8)
    await service.appendCheckpoint({
      runId,
      session,
      previousCheckpointHash: current.checkpointHash,
      actions: moves(index + 1, batch),
    })
  }
  const next = service.getRun(runId)
  if (!next) throw new Error('RUN_MISSING')
  return next
}

async function playUntilDead(
  service: ReturnType<typeof createMemoryProofService>,
  session: Parameters<typeof playSequence>[1],
  runId: string,
) {
  const directions = decodeSequence('RRLRLRLRRRLRLRLR')
  for (const direction of directions) {
    const current = service.getRun(runId)
    if (!current) throw new Error('RUN_MISSING')
    if (current.state.run.hp === 0) return current
    await service.appendCheckpoint({
      runId,
      session,
      previousCheckpointHash: current.checkpointHash,
      actions: moves(current.seq + 1, [direction]),
    })
  }
  const next = service.getRun(runId)
  if (!next) throw new Error('RUN_MISSING')
  return next
}

describe('server final replay verification', () => {
  it('verifies a complete Gem Runner transcript as VERIFIED_ELIGIBLE without consuming another attempt', async () => {
    const started = await startPlaying('gem-runner')
    expect(started.service.getWalletDailyStatus(started.wallet).expeditionsRemaining).toBe(2)
    const run = await playSequence(started.service, started.authorized.session, started.run.runId, PREVALIDATED_ROOM_01_BOOTSTRAP_WINNING_SEQUENCES['gem-runner'])
    const result = await started.service.verifyExpedition({
      runId: run.runId,
      session: started.authorized.session,
      checkpointHash: run.checkpointHash,
    })
    const stored = started.service.getRun(run.runId)

    expect(result.outcome).toBe('VERIFIED_ELIGIBLE')
    expect(result.status).toBe('COMPLETED')
    expect(result.rewardStatus).toBe('ELIGIBLE')
    expect(result.missionSatisfied).toBe(true)
    expect(result.finalHp).toBeGreaterThan(0)
    expect(result.gemsCollected).toBeGreaterThanOrEqual(6)
    expect(result.finalSeq).toBe(run.seq)
    expect(result.checkpointHash).toBe(run.checkpointHash)
    expect(stored?.status).toBe('COMPLETED')
    expect(stored?.rewardStatus).toBe('ELIGIBLE')
    expect(started.service.getWalletDailyStatus(started.wallet).expeditionsRemaining).toBe(2)
  }, 15_000)

  it('verifies a complete Chest Hunter transcript as VERIFIED_ELIGIBLE', async () => {
    const started = await startPlaying('chest-hunter')
    const run = await playSequence(started.service, started.authorized.session, started.run.runId, PREVALIDATED_ROOM_01_BOOTSTRAP_WINNING_SEQUENCES['chest-hunter'])
    const result = await started.service.verifyExpedition({
      runId: run.runId,
      session: started.authorized.session,
      checkpointHash: run.checkpointHash,
    })
    expect(result.outcome).toBe('VERIFIED_ELIGIBLE')
    expect(result.status).toBe('COMPLETED')
    expect(result.rewardStatus).toBe('ELIGIBLE')
    expect(result.chestsOpened).toBeGreaterThanOrEqual(4)
    expect(result.finalHp).toBeGreaterThan(0)
  }, 15_000)

  it('verifies Vault gameplay without making reward eligibility final', async () => {
    const started = await startPlaying('vault-breaker')
    const run = await playSequence(started.service, started.authorized.session, started.run.runId, PREVALIDATED_ROOM_01_BOOTSTRAP_WINNING_SEQUENCES['vault-breaker'])
    const result = await started.service.verifyExpedition({
      runId: run.runId,
      session: started.authorized.session,
      checkpointHash: run.checkpointHash,
    })
    const stored = started.service.getRun(run.runId)
    expect(result.outcome).toBe('VAULT_GAMEPLAY_VERIFIED')
    expect(result.status).toBe('STARTED')
    expect(result.rewardStatus).toBe('NONE')
    expect(result.missionSatisfied).toBe(false)
    expect(result.objectiveReached).toBe(true)
    expect(result.finalHp).toBeGreaterThan(0)
    expect(stored?.status).toBe('STARTED')
    expect(stored?.rewardStatus).toBe('NONE')
    await expect(started.service.appendCheckpoint({
      runId: run.runId,
      session: started.authorized.session,
      previousCheckpointHash: run.checkpointHash,
      actions: moves(run.seq + 1, ['LEFT']),
    })).rejects.toMatchObject({ code: 'RUN_NOT_ACTIVE' })
  }, 15_000)

  it('rejects forged client completion fields on verify', async () => {
    const started = await startPlaying()
    const run = started.service.getRun(started.run.runId)!
    const forged = await dispatchExpeditionHttp(started.service, {
      method: 'POST',
      path: '/api/expeditions/verify',
      headers: headers(started.cookie),
      body: {
        runId: run.runId,
        checkpointHash: run.checkpointHash,
        hp: 100,
        gemsCollected: 6,
        objectiveReached: true,
        missionSatisfied: true,
      },
    }, SECURITY)
    expect(forged.status).toBe(400)
    expect(forged.body).toEqual({ ok: false, error: 'MALFORMED_REQUEST' })
    expect(started.service.getRun(run.runId)?.status).toBe('STARTED')
  }, 15_000)

  it('reconstructs the transcript only from immutable server batches', async () => {
    const started = await startPlaying()
    const run = await playSequence(started.service, started.authorized.session, started.run.runId, PREVALIDATED_ROOM_01_BOOTSTRAP_WINNING_SEQUENCES['gem-runner'])
    const fromBatches = reconstructActionsFromBatches(run)
    const poisoned = {
      ...run,
      actions: moves(1, ['UP', 'UP', 'UP']),
    }
    const result = verifyExpeditionRun(poisoned, {
      checkpointHash: run.checkpointHash,
      now: new Date('2026-09-09T12:10:00.000Z'),
    })
    expect(fromBatches.map(action => action.type === 'MOVE' ? action.direction[0] : 'T').join('')).toBe(PREVALIDATED_ROOM_01_BOOTSTRAP_WINNING_SEQUENCES['gem-runner'])
    expect(result.result.outcome).toBe('VERIFIED_ELIGIBLE')
    expect(result.result.finalSeq).toBe(fromBatches.length)
  }, 15_000)

  it('detects altered immutable batch history', async () => {
    const started = await startPlaying()
    const run = await playSequence(started.service, started.authorized.session, started.run.runId, PREVALIDATED_ROOM_01_BOOTSTRAP_WINNING_SEQUENCES['gem-runner'])
    const altered = {
      ...run,
      batches: run.batches.map((batch, index) => index === 0
        ? { ...batch, actions: batch.actions.map((action, actionIndex) => actionIndex === 0 && action.type === 'MOVE' ? { ...action, direction: 'RIGHT' as const } : action) }
        : batch),
    }
    expect(() => verifyExpeditionRun(altered, {
      checkpointHash: run.checkpointHash,
      now: new Date('2026-09-09T12:10:00.000Z'),
    })).toThrow(ProofError)
    try {
      verifyExpeditionRun(altered, { checkpointHash: run.checkpointHash, now: new Date('2026-09-09T12:10:00.000Z') })
    } catch (error) {
      expect(error).toMatchObject({ code: 'PROOF_LOST' })
    }
  }, 15_000)

  it('rejects a persisted transcriptHash mismatch', async () => {
    const started = await startPlaying()
    const run = await playSequence(started.service, started.authorized.session, started.run.runId, PREVALIDATED_ROOM_01_BOOTSTRAP_WINNING_SEQUENCES['gem-runner'])
    const tampered = {
      ...run,
      checkpoint: { ...run.checkpoint, transcriptHash: 'a'.repeat(64) },
    }
    expect(() => verifyExpeditionRun(tampered, {
      checkpointHash: run.checkpointHash,
      now: new Date('2026-09-09T12:10:00.000Z'),
    })).toThrow(ProofError)
    try {
      verifyExpeditionRun(tampered, { checkpointHash: run.checkpointHash, now: new Date('2026-09-09T12:10:00.000Z') })
    } catch (error) {
      expect(error).toMatchObject({ code: 'PROOF_LOST' })
    }
  }, 15_000)

  it('rejects a persisted stateHash mismatch', async () => {
    const started = await startPlaying()
    const run = await playSequence(started.service, started.authorized.session, started.run.runId, PREVALIDATED_ROOM_01_BOOTSTRAP_WINNING_SEQUENCES['gem-runner'])
    const tampered = {
      ...run,
      checkpoint: { ...run.checkpoint, stateHash: 'b'.repeat(64) },
    }
    expect(() => verifyExpeditionRun(tampered, {
      checkpointHash: run.checkpointHash,
      now: new Date('2026-09-09T12:10:00.000Z'),
    })).toThrow(ProofError)
    try {
      verifyExpeditionRun(tampered, { checkpointHash: run.checkpointHash, now: new Date('2026-09-09T12:10:00.000Z') })
    } catch (error) {
      expect(error).toMatchObject({ code: 'PROOF_LOST' })
    }
  }, 15_000)

  it('returns the stored result for an exact verify retry and rejects a different checkpoint', async () => {
    const started = await startPlaying()
    const run = await playSequence(started.service, started.authorized.session, started.run.runId, PREVALIDATED_ROOM_01_BOOTSTRAP_WINNING_SEQUENCES['gem-runner'])
    const first = await started.service.verifyExpedition({
      runId: run.runId,
      session: started.authorized.session,
      checkpointHash: run.checkpointHash,
    })
    const second = await started.service.verifyExpedition({
      runId: run.runId,
      session: started.authorized.session,
      checkpointHash: run.checkpointHash,
    })
    expect(second).toEqual(first)
    await expect(started.service.verifyExpedition({
      runId: run.runId,
      session: started.authorized.session,
      checkpointHash: 'c'.repeat(64),
    })).rejects.toMatchObject({ code: 'CHECKPOINT_MISMATCH' })
    expect(started.service.getRun(run.runId)?.terminal?.type).toBe('VERIFIED')
  }, 15_000)

  it('does not classify an alive incomplete run as FAILED or success', async () => {
    const started = await startPlaying()
    const run = await playSequence(started.service, started.authorized.session, started.run.runId, 'L')
    await expect(started.service.verifyExpedition({
      runId: run.runId,
      session: started.authorized.session,
      checkpointHash: run.checkpointHash,
    })).rejects.toMatchObject({ code: 'RUN_INCOMPLETE' })
    expect(started.service.getRun(run.runId)?.status).toBe('STARTED')
    expect(started.service.getRun(run.runId)?.rewardStatus).toBe('NONE')
    expect(started.service.getRun(run.runId)?.terminal).toBeNull()
  }, 15_000)

  it('classifies hp 0 as FAILED with no reward', async () => {
    const started = await startPlaying()
    const run = await playUntilDead(started.service, started.authorized.session, started.run.runId)
    const result = await started.service.verifyExpedition({
      runId: run.runId,
      session: started.authorized.session,
      checkpointHash: run.checkpointHash,
    })
    expect(result.outcome).toBe('FAILED')
    expect(result.status).toBe('FAILED')
    expect(result.rewardStatus).toBe('NONE')
    expect(result.finalHp).toBe(0)
    expect(result.missionSatisfied).toBe(false)
    expect(started.service.getRun(run.runId)?.status).toBe('FAILED')
  }, 15_000)

  it('abandons an alive incomplete run as ABANDONED with no reward', async () => {
    const started = await startPlaying()
    const run = await playSequence(started.service, started.authorized.session, started.run.runId, 'L')
    const result = await started.service.abandonExpedition({
      runId: run.runId,
      session: started.authorized.session,
      checkpointHash: run.checkpointHash,
    })
    expect(result).toMatchObject({
      outcome: 'ABANDONED',
      status: 'ABANDONED',
      rewardStatus: 'NONE',
      checkpointHash: run.checkpointHash,
    })
    expect(started.service.getRun(run.runId)?.status).toBe('ABANDONED')
    expect(started.service.getWalletDailyStatus(started.wallet).expeditionsRemaining).toBe(2)
  }, 15_000)

  it('rejects a stale checkpoint on verify and persists only server-derived summary fields', async () => {
    const started = await startPlaying()
    const initialHash = started.run.checkpointHash
    const run = await playSequence(started.service, started.authorized.session, started.run.runId, PREVALIDATED_ROOM_01_BOOTSTRAP_WINNING_SEQUENCES['gem-runner'])
    await expect(started.service.verifyExpedition({
      runId: run.runId,
      session: started.authorized.session,
      checkpointHash: initialHash,
    })).rejects.toMatchObject({ code: 'CHECKPOINT_MISMATCH' })
    const response = await dispatchExpeditionHttp(started.service, {
      method: 'POST',
      path: '/api/expeditions/verify',
      headers: headers(started.cookie),
      body: { runId: run.runId, checkpointHash: run.checkpointHash },
    }, SECURITY)
    expect(response.status).toBe(200)
    expect(parseVerifyExpeditionResult(response.body)).toMatchObject({ outcome: 'VERIFIED_ELIGIBLE' })
    expect(response.body).not.toHaveProperty('hp')
    expect(response.body).not.toHaveProperty('player')
    expect(response.body).not.toHaveProperty('transcript')
    expect(response.body).not.toHaveProperty('blueprint')
    expect(hashTranscript).toBeTypeOf('function')
    expect(hashReplayState).toBeTypeOf('function')
  }, 15_000)
})

describe('verify HTTP locator contract', () => {
  it('parses abandon results and rejects extra fields', () => {
    const body = {
      ok: true,
      runId: 'run-1',
      checkpointHash: 'd'.repeat(64),
      outcome: 'ABANDONED',
      status: 'ABANDONED',
      rewardStatus: 'NONE',
    }
    expect(parseAbandonExpeditionResult(body)).toMatchObject({ outcome: 'ABANDONED' })
    expect(parseAbandonExpeditionResult({ ...body, extra: true })).toBeNull()
  })
})
