import { KeyPair } from '@nimiq/core'
import { describe, expect, it } from 'vitest'
import { hashBlueprint } from '../../src/game/replay/canonical.ts'
import { createRoom01Blueprint } from '../../src/game/world/room01.ts'
import type { Direction, MoveAction } from '../../src/game/replay/types.ts'
import { PREVALIDATED_ROOM_01_BOOTSTRAP_WINNING_SEQUENCES } from './room01BootstrapPrevalidation.ts'
import { serializeStartPayload, type StartExpeditionPayload } from './canonical.ts'
import { nimiqSignedMessageHash } from './crypto.ts'
import { dispatchExpeditionHttp, type ExpeditionHttpSecurity } from './http.ts'
import { createMemoryProofService } from './memoryProofStore.ts'
import { createRateLimiter } from './rateLimit.ts'
import { hashInstallId, minimumPlausibleCompletionMs } from './riskGate.ts'
import { serializeRunSessionCookie } from './session.ts'

const SECURITY: ExpeditionHttpSecurity = {
  expectedOrigin: 'https://hunt.example',
  expectedHost: 'hunt.example',
  expectedProtocol: 'https',
  secureCookie: true,
}

function publishedBlueprint(id: string) {
  const source = createRoom01Blueprint('2026-09-09', 'gem-runner', id)
  return { ...source, status: 'PUBLISHED' as const, blueprintHash: hashBlueprint(source) }
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

function createClock(initial = '2026-09-09T12:00:00.000Z') {
  let current = new Date(initial)
  return {
    now: () => current,
    advance(ms: number) {
      current = new Date(current.getTime() + ms)
    },
  }
}

async function startRun(
  clock: ReturnType<typeof createClock>,
  options: {
    readonly service?: ReturnType<typeof createMemoryProofService>
    readonly keyPair?: KeyPair
    readonly wallet?: string
    readonly risk?: { installId: string }
    readonly blueprintId?: string
  } = {},
) {
  const keyPair = options.keyPair ?? KeyPair.generate()
  const wallet = options.wallet ?? keyPair.toAddress().toUserFriendlyAddress()
  const service = options.service ?? createMemoryProofService({
    clock,
    blueprints: [publishedBlueprint(options.blueprintId ?? `risk-${wallet.slice(-8)}`)],
  })
  const challenge = await service.issueStartChallenge(wallet, 'gem-runner', options.risk)
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
  const authorized = await service.authorizeStart({
    payload: canonicalPayload,
    publicKey: keyPair.publicKey.toHex(),
    signature: keyPair.sign(nimiqSignedMessageHash(canonicalPayload)).toHex(),
    risk: options.risk,
  })
  service.markGameplayStarted(authorized.start.runId, authorized.session)
  return { service, keyPair, wallet, authorized, clock }
}

async function completeRun(
  started: Awaited<ReturnType<typeof startRun>>,
  humanTiming: boolean,
) {
  const encoded = PREVALIDATED_ROOM_01_BOOTSTRAP_WINNING_SEQUENCES['gem-runner']
  const directions = decodeSequence(encoded)
  for (let index = 0; index < directions.length; index += 8) {
    const current = started.service.getRun(started.authorized.start.runId)
    if (!current) throw new Error('RUN_MISSING')
    await started.service.appendCheckpoint({
      runId: started.authorized.start.runId,
      session: started.authorized.session,
      previousCheckpointHash: current.checkpointHash,
      actions: moves(index + 1, directions.slice(index, index + 8)),
    })
  }
  const run = started.service.getRun(started.authorized.start.runId)
  if (!run) throw new Error('RUN_MISSING')
  if (humanTiming) started.clock.advance((minimumPlausibleCompletionMs(run.seq) ?? 0) + 1_000)
  await started.service.verifyExpedition({
    runId: run.runId,
    session: started.authorized.session,
    checkpointHash: run.checkpointHash,
  })
  return started.service.getRun(run.runId)!
}

describe('pre-reservation risk gate', () => {
  it('passes a real-human-like run and preserves the 69-slot reservation', async () => {
    const started = await startRun(createClock())
    const run = await completeRun(started, true)
    const prepared = await started.service.prepareRewardClaim(run.runId, started.authorized.session, {
      installId: '11111111-1111-4111-8111-111111111111',
    })
    expect(prepared.outcome).toBe('PREPARED')
    if (prepared.outcome !== 'PREPARED') throw new Error('PREPARED_REQUIRED')
    const reserved = await started.service.finalizeRewardClaim({
      session: started.authorized.session,
      claimId: prepared.claimId,
      payload: prepared.canonicalPayload,
      publicKey: started.keyPair.publicKey.toHex(),
      signature: started.keyPair.sign(nimiqSignedMessageHash(prepared.canonicalPayload)).toHex(),
      risk: { installId: '11111111-1111-4111-8111-111111111111' },
    })
    expect(reserved).toMatchObject({ outcome: 'RESERVED', reservationNumber: 1, remainingSlots: 68, totalSlots: 69 })
  })

  it('blocks an impossible-speed run without consuming a slot', async () => {
    const started = await startRun(createClock())
    const run = await completeRun(started, false)
    const blocked = await started.service.prepareRewardClaim(run.runId, started.authorized.session)
    expect(blocked).toMatchObject({ outcome: 'BLOCK', runId: run.runId, reasonCategory: 'TIMING' })
    expect(started.service.getWalletDailyStatus(started.wallet).rewardAlreadyReserved).toBe(false)
  })

  it('does not review 1-2 wallets on one install solely from count', async () => {
    const clock = createClock()
    const installId = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'
    const first = await startRun(clock, { risk: { installId }, blueprintId: 'risk-a' })
    const firstRun = await completeRun(first, true)
    const firstPrepared = await first.service.prepareRewardClaim(firstRun.runId, first.authorized.session, { installId })
    expect(firstPrepared.outcome).toBe('PREPARED')

    const second = await startRun(clock, {
      service: first.service,
      risk: { installId },
      blueprintId: 'risk-a',
    })
    const secondRun = await completeRun(second, true)
    const secondPrepared = await first.service.prepareRewardClaim(secondRun.runId, second.authorized.session, { installId })
    expect(secondPrepared.outcome).toBe('PREPARED')
  })

  it('reviews a third wallet on the same install without consuming a slot', async () => {
    const clock = createClock()
    const installId = 'bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb'
    const service = createMemoryProofService({
      clock,
      blueprints: [publishedBlueprint('risk-fanout')],
    })
    const wallets = []
    for (let index = 0; index < 3; index += 1) {
      const started = await startRun(clock, { service, risk: { installId }, blueprintId: 'risk-fanout' })
      const run = await completeRun(started, true)
      wallets.push({ started, run })
    }
    const reviewed = await service.prepareRewardClaim(
      wallets[2]!.run.runId,
      wallets[2]!.started.authorized.session,
      { installId },
    )
    expect(reviewed).toMatchObject({ outcome: 'REVIEW', runId: wallets[2]!.run.runId })
    expect(service.getWalletDailyStatus(wallets[2]!.started.wallet).rewardAlreadyReserved).toBe(false)
    expect(hashInstallId(installId)).toMatch(/^[0-9a-f]{64}$/)
  })

  it('blocks a concurrent active run without consuming a slot', async () => {
    const clock = createClock()
    const first = await startRun(clock, { blueprintId: 'risk-concurrent' })
    const second = await startRun(clock, {
      service: first.service,
      keyPair: first.keyPair,
      wallet: first.wallet,
      blueprintId: 'risk-concurrent',
    })
    const run = await completeRun(second, true)
    const blocked = await first.service.prepareRewardClaim(run.runId, second.authorized.session)
    expect(blocked).toMatchObject({ outcome: 'BLOCK', reasonCategory: 'SESSION' })
    expect(first.service.getWalletDailyStatus(first.wallet).rewardAlreadyReserved).toBe(false)
  })

  it('isolates wallet A assessment data from wallet B', async () => {
    const clock = createClock()
    const a = await startRun(clock, { risk: { installId: 'cccccccc-1111-4111-8111-cccccccccccc' }, blueprintId: 'risk-iso' })
    const aRun = await completeRun(a, true)
    await a.service.prepareRewardClaim(aRun.runId, a.authorized.session, {
      installId: 'cccccccc-1111-4111-8111-cccccccccccc',
    })
    const b = await startRun(clock, { service: a.service, blueprintId: 'risk-iso' })
    const bRun = await completeRun(b, true)
    const prepared = await a.service.prepareRewardClaim(bRun.runId, b.authorized.session)
    expect(prepared.outcome).toBe('PREPARED')
  })

  it('rate-limits start-challenge bursts without slowing a normal prepare', async () => {
    const limiter = createRateLimiter()
    const security = { ...SECURITY, rateLimiter: limiter }
    const started = await startRun(createClock(), { blueprintId: 'risk-rate' })
    const run = await completeRun(started, true)
    const cookie = serializeRunSessionCookie(
      started.authorized.sessionCapability,
      new Date(started.authorized.session.expiresAt),
      new Date(started.authorized.session.createdAt),
      true,
    )
    const headers = {
      origin: SECURITY.expectedOrigin,
      host: SECURITY.expectedHost,
      protocol: SECURITY.expectedProtocol,
      'content-type': 'application/json',
      cookie,
    }
    let limited = 0
    for (let index = 0; index < 31; index += 1) {
      const response = await dispatchExpeditionHttp(started.service, {
        method: 'POST',
        path: '/api/expeditions/start-challenge',
        headers,
        body: { wallet: started.wallet, mission: 'gem-runner' },
      }, security)
      if (response.status === 429) {
        expect(response.body).toEqual({ ok: false, error: 'RATE_LIMITED' })
        limited += 1
      }
    }
    expect(limited).toBeGreaterThan(0)
    const prepared = await dispatchExpeditionHttp(started.service, {
      method: 'POST',
      path: '/api/rewards/claim/prepare',
      headers,
      body: { runId: run.runId },
    }, security)
    expect(prepared.status).toBe(200)
    expect(prepared.body).toMatchObject({ ok: true, outcome: 'PREPARED' })
  })
})
