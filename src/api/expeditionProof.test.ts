import { describe, expect, it, vi } from 'vitest'
import { createInitialRun } from '../game/replay/engine.ts'
import { createRoom01Blueprint } from '../game/world/room01.ts'
import type { ExpeditionBlueprint, ExpeditionCheckpoint, ReplayState } from '../game/replay/types.ts'
import {
  authorizeStart,
  fetchActiveExpedition,
  markGameplayStarted,
  parseActiveExpedition,
  parseCheckpointAcknowledgement,
  parseGameplayStartResponse,
  parseVerifyExpeditionResult,
  verifyExpedition,
  parseStartChallengeResponse,
  parseStartResult,
  requestStartChallenge,
  submitCheckpoint,
  ExpeditionProofApiError,
} from './expeditionProof.ts'

function blueprint(): ExpeditionBlueprint {
  const source = createRoom01Blueprint('2026-09-09', 'gem-runner', 'api-blueprint')
  return { ...source, status: 'PUBLISHED', blueprintHash: 'a'.repeat(64) }
}

function stateFor(value: ExpeditionBlueprint): ReplayState {
  return createInitialRun({
    mission: value.mission,
    rulesVersion: value.rulesVersion,
    roomVersion: value.roomVersion,
    blueprint: value,
  })
}

function checkpoint(): ExpeditionCheckpoint {
  return {
    version: 1,
    runId: 'run-1',
    runChallenge: 'run-challenge',
    seq: 0,
    previousCheckpointHash: null,
    stateHash: 'b'.repeat(64),
    transcriptHash: 'c'.repeat(64),
    checkpointHash: 'd'.repeat(64),
  }
}

function activeResponse() {
  const value = blueprint()
  return {
    ok: true as const,
    runId: 'run-1',
    dayKey: '2026-09-09',
    mission: 'gem-runner' as const,
    status: 'STARTED' as const,
    startedAt: '2026-09-09T12:00:00.000Z',
    expiresAt: '2026-09-10T00:00:00.000Z',
    gameplayStartedAt: null,
    rulesVersion: value.rulesVersion,
    roomVersion: value.roomVersion,
    blueprintVersion: value.blueprintVersion,
    blueprintId: value.blueprintId,
    blueprintHash: value.blueprintHash,
    blueprint: value,
    state: stateFor(value),
    checkpoint: checkpoint(),
  }
}

function response(value: unknown, ok = true, status = ok ? 200 : 400): Response {
  return { ok, status, json: async () => value } as Response
}

describe('expedition proof browser API', () => {
  it('parses a complete active response without a session capability', () => {
    expect(parseActiveExpedition(activeResponse())).toMatchObject({
      runId: 'run-1',
      mission: 'gem-runner',
      gameplayStartedAt: null,
      blueprint: { blueprintId: 'api-blueprint' },
      state: { seq: 0, run: { runStatus: 'PLAYING' } },
    })
  })

  it('rejects incomplete, unsupported, mismatched, or post-marker active responses', () => {
    const valid = activeResponse()
    expect(parseActiveExpedition({ ...valid, runId: undefined })).toBeNull()
    expect(parseActiveExpedition({ ...valid, rulesVersion: 'future-rules' })).toBeNull()
    expect(parseActiveExpedition({ ...valid, mission: 'chest-hunter' })).toBeNull()
    expect(parseActiveExpedition({ ...valid, gameplayStartedAt: '2026-09-09T12:01:00.000Z' })).toBeNull()
    expect(parseActiveExpedition({ ...valid, blueprint: { ...valid.blueprint, chests: [] } })).toBeNull()
    expect(parseActiveExpedition({ ...valid, sessionCapability: 'never-expose' })).toBeNull()
  })

  it('parses strict challenge, start, and gameplay-start responses', () => {
    const value = blueprint()
    const challenge = parseStartChallengeResponse({
      ok: true,
      wallet: 'NQ00 TEST WALLET',
      challenge: 'challenge',
      blueprintId: value.blueprintId,
      blueprintHash: value.blueprintHash,
      dayKey: value.dayKey,
      expiresAt: '2026-09-09T12:05:00.000Z',
    })
    expect(challenge?.wallet).toBe('NQ00 TEST WALLET')

    const start = parseStartResult({
      ok: true,
      outcome: 'START_CREATED',
      runId: 'run-1',
      runChallenge: 'run-challenge',
      attemptsRemaining: 2,
      rulesVersion: value.rulesVersion,
      roomVersion: value.roomVersion,
      blueprintVersion: value.blueprintVersion,
      blueprintId: value.blueprintId,
      blueprintHash: value.blueprintHash,
      blueprint: value,
      dayKey: value.dayKey,
      nextResetAt: '2026-09-10T00:00:00.000Z',
    })
    expect(start?.outcome).toBe('START_CREATED')
    expect(parseGameplayStartResponse({ ok: true, runId: 'run-1', outcome: 'GAMEPLAY_ALREADY_STARTED' })).toEqual({
      runId: 'run-1',
      outcome: 'GAMEPLAY_ALREADY_STARTED',
    })
    expect(parseGameplayStartResponse({ ok: true, runId: 'run-1', outcome: 'GAMEPLAY_STARTED', extra: true })).toBeNull()
  })

  it('uses same-origin no-store requests and strict request bodies', async () => {
    const value = blueprint()
    const fetcher = vi.fn().mockResolvedValue(response({
      ok: true,
      wallet: 'NQ00 TEST WALLET',
      challenge: 'challenge',
      blueprintId: value.blueprintId,
      blueprintHash: value.blueprintHash,
      dayKey: value.dayKey,
      expiresAt: '2026-09-09T12:05:00.000Z',
    }))

    await requestStartChallenge('NQ00 TEST WALLET', 'gem-runner', fetcher)

    expect(fetcher).toHaveBeenCalledWith('/api/expeditions/start-challenge', {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({ wallet: 'NQ00 TEST WALLET', mission: 'gem-runner' }),
    })
  })

  it('preserves known start-challenge error envelopes instead of collapsing them to MALFORMED_RESPONSE', async () => {
    const cases = [
      ['MALFORMED_REQUEST', 400],
      ['INVALID_WALLET', 400],
      ['DAILY_BLUEPRINT_UNAVAILABLE', 503],
      ['PROOF_UNAVAILABLE', 503],
    ] as const

    for (const [code, status] of cases) {
      const fetcher = vi.fn().mockResolvedValue(response({ ok: false, error: code }, false, status))
      await expect(requestStartChallenge('NQ00 TEST WALLET', 'gem-runner', fetcher)).rejects.toMatchObject({ code })
    }
  })

  it('fails closed on extra fields, non-JSON bodies, and unknown error strings', async () => {
    const extra = vi.fn().mockResolvedValue(response({
      ok: true,
      wallet: 'NQ00 TEST WALLET',
      challenge: 'challenge',
      blueprintId: 'blueprint-1',
      blueprintHash: 'a'.repeat(64),
      dayKey: '2026-09-09',
      expiresAt: '2026-09-09T12:05:00.000Z',
      mission: 'gem-runner',
    }))
    await expect(requestStartChallenge('NQ00 TEST WALLET', 'gem-runner', extra)).rejects.toMatchObject({ code: 'MALFORMED_RESPONSE' })

    const html = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'text/html' },
      json: async () => {
        throw new SyntaxError('Unexpected token <')
      },
    } as unknown as Response)
    await expect(requestStartChallenge('NQ00 TEST WALLET', 'gem-runner', html)).rejects.toMatchObject({ code: 'MALFORMED_RESPONSE' })

    const unknown = vi.fn().mockResolvedValue(response({ ok: false, error: 'NOT_A_KNOWN_CODE' }, false, 400))
    await expect(requestStartChallenge('NQ00 TEST WALLET', 'gem-runner', unknown)).rejects.toMatchObject({ code: 'MALFORMED_RESPONSE' })
  })

  it('maps network and known server failures without retaining response bodies', async () => {
    const network = vi.fn().mockRejectedValue(new Error('private transport detail'))
    await expect(fetchActiveExpedition('run-1', network)).rejects.toMatchObject({ code: 'NETWORK_ERROR' })

    const unavailable = vi.fn().mockResolvedValue(response({ ok: false, error: 'PROOF_UNAVAILABLE' }, false, 503))
    await expect(markGameplayStarted('run-1', unavailable)).rejects.toMatchObject({ code: 'PROOF_UNAVAILABLE' })
    await expect(markGameplayStarted('run-1', unavailable)).rejects.not.toHaveProperty('details')
    expect(unavailable).toHaveBeenCalledWith('/api/expeditions/gameplay-start', expect.objectContaining({
      credentials: 'same-origin',
      cache: 'no-store',
      body: JSON.stringify({ runId: 'run-1' }),
    }))
  })

  it('rejects malformed successful responses and preserves exact signed start fields', async () => {
    const malformed = vi.fn().mockResolvedValue(response({ ok: true, runId: 'missing-fields' }))
    await expect(fetchActiveExpedition('run-1', malformed)).rejects.toBeInstanceOf(ExpeditionProofApiError)

    const startValue = blueprint()
    const signed = {
      payload: 'canonical-payload',
      publicKey: 'public-key',
      signature: 'signature',
    }
    const startFetcher = vi.fn().mockResolvedValue(response({
      ok: true,
      outcome: 'START_ALREADY_CREATED',
      runId: 'run-1',
      runChallenge: 'run-challenge',
      attemptsRemaining: 2,
      rulesVersion: startValue.rulesVersion,
      roomVersion: startValue.roomVersion,
      blueprintVersion: startValue.blueprintVersion,
      blueprintId: startValue.blueprintId,
      blueprintHash: startValue.blueprintHash,
      blueprint: startValue,
      dayKey: startValue.dayKey,
      nextResetAt: '2026-09-10T00:00:00.000Z',
    }))

    await authorizeStart(signed, startFetcher)
    expect(startFetcher).toHaveBeenCalledWith('/api/expeditions/start', expect.objectContaining({
      body: JSON.stringify(signed),
    }))
  })

  it('parses a server-derived checkpoint acknowledgement and rejects extra fields', async () => {
    const body = {
      ok: true,
      runId: 'run-1',
      acknowledgedSeq: 1,
      seqStart: 1,
      seqEnd: 1,
      previousCheckpointHash: 'a'.repeat(64),
      checkpointHash: 'b'.repeat(64),
      transcriptHash: 'c'.repeat(64),
      stateHash: 'd'.repeat(64),
      batchFingerprint: 'e'.repeat(64),
      hp: 100,
      gemsCollected: 1,
      chestsOpened: 0,
      hasTempleKey: false,
      objectiveReached: false,
      missionSatisfied: false,
      dead: false,
    }
    expect(parseCheckpointAcknowledgement(body)).toMatchObject({ runId: 'run-1', acknowledgedSeq: 1, gemsCollected: 1 })
    expect(parseCheckpointAcknowledgement({ ...body, hp: 1, extra: true })).toBeNull()

    const fetcher = vi.fn().mockResolvedValue(response(body))
    await submitCheckpoint({
      runId: 'run-1',
      previousCheckpointHash: 'a'.repeat(64),
      actions: [{ seq: 1, type: 'MOVE', direction: 'LEFT' }],
    }, fetcher)
    expect(fetcher).toHaveBeenCalledWith('/api/expeditions/checkpoint', expect.objectContaining({
      credentials: 'same-origin',
      cache: 'no-store',
      body: JSON.stringify({
        runId: 'run-1',
        previousCheckpointHash: 'a'.repeat(64),
        actions: [{ seq: 1, type: 'MOVE', direction: 'LEFT' }],
      }),
    }))
  })

  it('treats a non-JSON checkpoint response as MALFORMED_RESPONSE', async () => {
    const html = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'text/html' },
      json: async () => {
        throw new SyntaxError('Unexpected token <')
      },
    } as unknown as Response)
    await expect(submitCheckpoint({
      runId: 'run-1',
      previousCheckpointHash: 'a'.repeat(64),
      actions: [{ seq: 1, type: 'MOVE', direction: 'LEFT' }],
    }, html)).rejects.toMatchObject({ code: 'MALFORMED_RESPONSE' })
  })

  it('parses a server-derived verify result and rejects extra HUD fields', async () => {
    const body = {
      ok: true,
      runId: 'run-1',
      checkpointHash: 'a'.repeat(64),
      outcome: 'VERIFIED_ELIGIBLE',
      status: 'COMPLETED',
      rewardStatus: 'ELIGIBLE',
      finalHp: 80,
      gemsCollected: 6,
      chestsOpened: 0,
      objectiveReached: false,
      hasTempleKey: false,
      missionSatisfied: true,
      finalSeq: 15,
      transcriptHash: 'b'.repeat(64),
      stateHash: 'c'.repeat(64),
      verifiedAt: '2026-09-09T12:10:00.000Z',
    }
    expect(parseVerifyExpeditionResult(body)).toMatchObject({ outcome: 'VERIFIED_ELIGIBLE', finalHp: 80 })
    expect(parseVerifyExpeditionResult({ ...body, hp: 100 })).toBeNull()
    expect(parseVerifyExpeditionResult({ ...body, extra: true })).toBeNull()

    const fetcher = vi.fn().mockResolvedValue(response(body))
    await verifyExpedition({ runId: 'run-1', checkpointHash: 'a'.repeat(64) }, fetcher)
    expect(fetcher).toHaveBeenCalledWith('/api/expeditions/verify', expect.objectContaining({
      credentials: 'same-origin',
      body: JSON.stringify({ runId: 'run-1', checkpointHash: 'a'.repeat(64) }),
    }))
  })
})
