import { KeyPair } from '@nimiq/core'
import { describe, expect, it } from 'vitest'
import { hashBlueprint } from '../../src/game/replay/canonical.ts'
import { createRoom01Blueprint } from '../../src/game/world/room01.ts'
import { serializeStartPayload, type StartExpeditionPayload } from './canonical.ts'
import { nimiqSignedMessageHash } from './crypto.ts'
import { createMemoryProofService } from './memoryProofStore.ts'

function createFixture() {
  let current = new Date('2026-09-09T12:00:00.000Z')
  const source = createRoom01Blueprint('2026-09-09', 'gem-runner', 'active-blueprint')
  const blueprint = { ...source, status: 'PUBLISHED' as const, blueprintHash: hashBlueprint(source) }
  const service = createMemoryProofService({ clock: { now: () => current }, blueprints: [blueprint] })
  const keyPair = KeyPair.generate()
  const wallet = keyPair.toAddress().toUserFriendlyAddress()
  return {
    service,
    keyPair,
    wallet,
    setNow(value: string) {
      current = new Date(value)
    },
  }
}

async function signedStart(service: ReturnType<typeof createMemoryProofService>, keyPair: KeyPair, wallet: string) {
  const challenge = await service.issueStartChallenge(wallet, 'gem-runner')
  const payload: StartExpeditionPayload = {
    version: 1,
    type: 'NIMHUNT_START_EXPEDITION',
    wallet: challenge.wallet,
    mission: 'gem-runner',
    dayKey: challenge.dayKey,
    challenge: challenge.challenge,
    blueprintId: challenge.blueprintId,
    blueprintHash: challenge.blueprintHash,
  }
  const canonicalPayload = serializeStartPayload(payload)
  const request = {
    payload: canonicalPayload,
    publicKey: keyPair.publicKey.toHex(),
    signature: keyPair.sign(nimiqSignedMessageHash(canonicalPayload)).toHex(),
  }
  return { result: await service.authorizeStart(request), request }
}

describe('authenticated active expedition recovery', () => {
  it('returns only a matching pre-mount run for its authenticated session', async () => {
    const fixture = createFixture()
    const started = await signedStart(fixture.service, fixture.keyPair, fixture.wallet)
    const session = fixture.service.authenticateSession(started.result.sessionCapability)
    expect(fixture.service.getActiveExpedition(started.result.start.runId, session)).toMatchObject({
      runId: started.result.start.runId,
      mission: 'gem-runner',
      status: 'STARTED',
      gameplayStartedAt: null,
      state: { seq: 0, run: { runStatus: 'PLAYING' } },
      checkpoint: { seq: 0 },
    })
  })

  it('marks gameplay start once and makes the same operation idempotent', async () => {
    const fixture = createFixture()
    const started = await signedStart(fixture.service, fixture.keyPair, fixture.wallet)
    const session = fixture.service.authenticateSession(started.result.sessionCapability)
    const runId = started.result.start.runId

    expect(fixture.service.markGameplayStarted(runId, session)).toEqual({ runId, outcome: 'GAMEPLAY_STARTED' })
    expect(fixture.service.markGameplayStarted(runId, session)).toEqual({ runId, outcome: 'GAMEPLAY_ALREADY_STARTED' })
    expect(fixture.service.getWalletDailyStatus(fixture.wallet)).toMatchObject({
      expeditionsStarted: 1,
      expeditionsRemaining: 2,
      rewardAlreadyReserved: false,
      nextResetAt: '2026-09-10T00:00:00.000Z',
    })
  })

  it('rejects active recovery after gameplay has started', async () => {
    const fixture = createFixture()
    const started = await signedStart(fixture.service, fixture.keyPair, fixture.wallet)
    const session = fixture.service.authenticateSession(started.result.sessionCapability)
    const runId = started.result.start.runId

    fixture.service.markGameplayStarted(runId, session)

    expect(() => fixture.service.getActiveExpedition(runId, session)).toThrow('ACTIVE_RUN_UNAVAILABLE')
  })

  it('rejects a missing or mismatched run without exposing another run', async () => {
    const fixture = createFixture()
    const started = await signedStart(fixture.service, fixture.keyPair, fixture.wallet)
    const session = fixture.service.authenticateSession(started.result.sessionCapability)

    expect(() => fixture.service.getActiveExpedition('missing-run', session)).toThrow('RUN_SESSION_INVALID')
    expect(() => fixture.service.markGameplayStarted('missing-run', session)).toThrow('RUN_SESSION_INVALID')
    expect(() => fixture.service.getActiveExpedition(`${started.result.start.runId}-other`, session)).toThrow('RUN_SESSION_INVALID')
    expect(() => fixture.service.getActiveExpedition(started.result.start.runId, { ...session, runId: 'forged-run' })).toThrow('RUN_SESSION_INVALID')
  })

  it('rejects an expired active session without changing the attempt count', async () => {
    const fixture = createFixture()
    const started = await signedStart(fixture.service, fixture.keyPair, fixture.wallet)
    const session = fixture.service.authenticateSession(started.result.sessionCapability)
    fixture.setNow('2026-09-10T00:00:00.000Z')

    expect(() => fixture.service.getActiveExpedition(started.result.start.runId, session)).toThrow('RUN_SESSION_INVALID')
    expect(fixture.service.getWalletDailyStatus(fixture.wallet).expeditionsStarted).toBe(0)
  })
})
