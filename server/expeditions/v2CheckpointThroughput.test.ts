import { KeyPair } from '@nimiq/core'
import { describe, expect, it } from 'vitest'
import { createV2Blueprint } from '../../src/game/angkorV2Proof/blueprint.ts'
import { hashBlueprint } from '../../src/game/replay/canonical.ts'
import { createRoom01Blueprint } from '../../src/game/world/room01.ts'
import {
  LEGACY_MAX_CHECKPOINT_BATCH_ACTIONS,
  V2_MAX_CHECKPOINT_BATCH_ACTIONS,
} from '../../src/game/replay/versions.ts'
import { serializeStartPayload, type StartExpeditionPayload } from './canonical.ts'
import { applyCheckpointBatch } from './checkpoint.ts'
import { nimiqSignedMessageHash } from './crypto.ts'
import { dispatchExpeditionHttp, MAX_EXPEDITION_BODY_BYTES, type ExpeditionHttpSecurity } from './http.ts'
import { createMemoryProofService } from './memoryProofStore.ts'
import { RUN_SESSION_COOKIE } from './session.ts'
import type { MissionType } from '../../src/game/replay/types.ts'

const SECURITY: ExpeditionHttpSecurity = {
  expectedOrigin: 'https://hunt.example',
  expectedHost: 'hunt.example',
  expectedProtocol: 'https',
  secureCookie: true,
}

function headers(cookie?: string) {
  return {
    origin: SECURITY.expectedOrigin,
    host: SECURITY.expectedHost,
    protocol: SECURITY.expectedProtocol,
    'content-type': 'application/json',
    cookie,
  }
}

function ticks(start: number, count: number, stageId = 'outer-ruins') {
  return Array.from({ length: count }, (_, index) => ({ seq: start + index, type: 'V2_TICK' as const, stageId }))
}

function moves(start: number, count: number) {
  return Array.from({ length: count }, (_, index) => ({
    seq: start + index,
    type: 'MOVE' as const,
    direction: (index % 2 ? 'RIGHT' : 'LEFT') as 'LEFT' | 'RIGHT',
  }))
}

async function startMission(mission: MissionType, kind: 'legacy' | 'v2') {
  let current = new Date('2026-10-04T12:00:00.000Z')
  const blueprint = kind === 'v2'
    ? createV2Blueprint('2026-10-04', mission)
    : { ...createRoom01Blueprint('2026-10-04', mission, 'legacy-throughput'), status: 'PUBLISHED' as const, blueprintHash: hashBlueprint(createRoom01Blueprint('2026-10-04', mission, 'legacy-throughput')) }
  const service = createMemoryProofService({ clock: { now: () => current }, blueprints: [blueprint] })
  const keyPair = KeyPair.generate()
  const wallet = keyPair.toAddress().toUserFriendlyAddress()
  const challenge = await service.issueStartChallenge(wallet, mission)
  const payload: StartExpeditionPayload = {
    version: 1,
    type: 'NIMHUNT_START_EXPEDITION',
    wallet,
    mission,
    dayKey: challenge.dayKey,
    challenge: challenge.challenge,
    blueprintId: challenge.blueprintId,
    blueprintHash: challenge.blueprintHash,
  }
  const canonicalPayload = serializeStartPayload(payload)
  const authorized = await service.authorizeStart({
    payload: canonicalPayload,
    publicKey: keyPair.publicKey.toHex(),
    signature: keyPair.sign(nimiqSignedMessageHash(canonicalPayload)).toHex(),
  })
  service.markGameplayStarted(authorized.start.runId, authorized.session)
  current = new Date('2026-10-04T12:00:30.000Z')
  const run = service.getRun(authorized.start.runId)
  if (!run) throw new Error('RUN_MISSING')
  return {
    service,
    authorized,
    run,
    cookie: `${RUN_SESSION_COOKIE}=${authorized.sessionCapability}`,
    setNow: (value: string) => { current = new Date(value) },
  }
}

function worstCaseV2CheckpointBody(actionCount = V2_MAX_CHECKPOINT_BATCH_ACTIONS) {
  return JSON.stringify({
    runId: 'r'.repeat(128),
    previousCheckpointHash: 'a'.repeat(64),
    actions: Array.from({ length: actionCount }, (_, index) => ({
      seq: 29_937 + index,
      type: 'V2_MOVE',
      stageId: 's'.repeat(40),
      direction: 'RIGHT',
    })),
  })
}

describe('version-scoped checkpoint batch authority', () => {
  it('accepts legacy 8 and rejects legacy 9', async () => {
    const { service, authorized, run } = await startMission('gem-runner', 'legacy')
    const eight = await service.appendCheckpoint({
      runId: run.runId,
      session: authorized.session,
      previousCheckpointHash: run.checkpointHash,
      actions: moves(1, LEGACY_MAX_CHECKPOINT_BATCH_ACTIONS),
    })
    expect(eight.seqEnd).toBe(8)
    await expect(service.appendCheckpoint({
      runId: run.runId,
      session: authorized.session,
      previousCheckpointHash: eight.checkpointHash,
      actions: moves(9, 9),
    })).rejects.toMatchObject({ code: 'MALFORMED_REQUEST' })
    expect(service.getRun(run.runId)?.seq).toBe(8)
  }, 15_000)

  it('accepts V2 8, 32 and 64 and rejects V2 65', async () => {
    const started = await startMission('gem-runner', 'v2')
    let hash = started.run.checkpointHash
    const eight = await started.service.appendCheckpoint({
      runId: started.run.runId,
      session: started.authorized.session,
      previousCheckpointHash: hash,
      actions: ticks(1, 8),
    })
    expect(eight.seqEnd).toBe(8)
    hash = eight.checkpointHash
    const thirtyTwo = await started.service.appendCheckpoint({
      runId: started.run.runId,
      session: started.authorized.session,
      previousCheckpointHash: hash,
      actions: ticks(9, 32),
    })
    expect(thirtyTwo.seqEnd).toBe(40)
    hash = thirtyTwo.checkpointHash
    const sixtyFour = await started.service.appendCheckpoint({
      runId: started.run.runId,
      session: started.authorized.session,
      previousCheckpointHash: hash,
      actions: ticks(41, 64),
    })
    expect(sixtyFour.seqEnd).toBe(104)
    await expect(started.service.appendCheckpoint({
      runId: started.run.runId,
      session: started.authorized.session,
      previousCheckpointHash: sixtyFour.checkpointHash,
      actions: ticks(105, 65),
    })).rejects.toMatchObject({ code: 'MALFORMED_REQUEST' })
    expect(started.service.getRun(started.run.runId)?.seq).toBe(104)
    expect(() => applyCheckpointBatch(started.service.getRun(started.run.runId)!, {
      previousCheckpointHash: sixtyFour.checkpointHash,
      actions: ticks(105, 65),
    })).toThrow()
  }, 15_000)

  it('HTTP parsing accepts 64 but never 65, and legacy authority still rejects 9+', async () => {
    const { service, authorized, run, cookie } = await startMission('gem-runner', 'legacy')
    const oversizedParse = await dispatchExpeditionHttp(service, {
      method: 'POST',
      path: '/api/expeditions/checkpoint',
      headers: headers(cookie),
      body: {
        runId: run.runId,
        previousCheckpointHash: run.checkpointHash,
        actions: moves(1, V2_MAX_CHECKPOINT_BATCH_ACTIONS + 1),
      },
    }, SECURITY)
    expect(oversizedParse.status).toBe(400)
    expect(oversizedParse.body).toEqual({ ok: false, error: 'MALFORMED_REQUEST' })

    const sixtyFourLegacy = await dispatchExpeditionHttp(service, {
      method: 'POST',
      path: '/api/expeditions/checkpoint',
      headers: headers(cookie),
      body: {
        runId: run.runId,
        previousCheckpointHash: run.checkpointHash,
        actions: moves(1, 64),
      },
    }, SECURITY)
    expect(sixtyFourLegacy.status).toBe(400)
    expect(sixtyFourLegacy.body).toEqual({ ok: false, error: 'MALFORMED_REQUEST' })

    const nineLegacy = await dispatchExpeditionHttp(service, {
      method: 'POST',
      path: '/api/expeditions/checkpoint',
      headers: headers(cookie),
      body: {
        runId: run.runId,
        previousCheckpointHash: run.checkpointHash,
        actions: moves(1, 9),
      },
    }, SECURITY)
    expect(nineLegacy.status).toBe(400)
    expect(nineLegacy.body).toEqual({ ok: false, error: 'MALFORMED_REQUEST' })

    const eightLegacy = await dispatchExpeditionHttp(service, {
      method: 'POST',
      path: '/api/expeditions/checkpoint',
      headers: headers(cookie),
      body: {
        runId: run.runId,
        previousCheckpointHash: run.checkpointHash,
        actions: moves(1, 8),
      },
    }, SECURITY)
    expect(eightLegacy.status).toBe(200)
    expect(authorized.session.runId).toBe(run.runId)
  }, 15_000)

  it('proves a worst-case valid 64-action V2 checkpoint body fits under 16 KiB', async () => {
    const body = worstCaseV2CheckpointBody()
    const bytes = Buffer.byteLength(body, 'utf8')
    expect(bytes).toBeGreaterThan(4_000)
    expect(bytes).toBeLessThan(MAX_EXPEDITION_BODY_BYTES)
    const tooLarge = await dispatchExpeditionHttp(createMemoryProofService({ clock: { now: () => new Date('2026-10-04T12:00:00.000Z') }, blueprints: [] }), {
      method: 'POST',
      path: '/api/expeditions/checkpoint',
      headers: headers(),
      rawBody: 'x'.repeat(MAX_EXPEDITION_BODY_BYTES + 1),
    }, SECURITY)
    expect(tooLarge.status).toBe(413)
    const within = await dispatchExpeditionHttp(createMemoryProofService({ clock: { now: () => new Date('2026-10-04T12:00:00.000Z') }, blueprints: [] }), {
      method: 'POST',
      path: '/api/expeditions/checkpoint',
      headers: headers(),
      rawBody: body,
    }, SECURITY)
    expect(within.status).not.toBe(413)
    expect(bytes).toBe(Buffer.byteLength(worstCaseV2CheckpointBody(64), 'utf8'))
  })
})
