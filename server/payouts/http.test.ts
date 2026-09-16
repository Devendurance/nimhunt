import { KeyPair } from '@nimiq/core'
import { describe, expect, it } from 'vitest'
import { dispatchExpeditionHttp, type ExpeditionHttpSecurity } from '../expeditions/http.ts'
import { createMemoryProofService } from '../expeditions/memoryProofStore.ts'
import { serializeRunSessionCookie } from '../expeditions/session.ts'
import { hashBlueprint } from '../../src/game/replay/canonical.ts'
import { createRoom01Blueprint } from '../../src/game/world/room01.ts'
import { PREVALIDATED_ROOM_01_BOOTSTRAP_WINNING_SEQUENCES } from '../expeditions/room01BootstrapPrevalidation.ts'
import { serializeStartPayload } from '../expeditions/canonical.ts'
import { nimiqSignedMessageHash } from '../expeditions/crypto.ts'
import type { Direction, MoveAction } from '../../src/game/replay/types.ts'
import { dispatchPayoutHttp } from './http.ts'
import { createMemoryPayoutStore } from './store.ts'

const SECURITY: ExpeditionHttpSecurity = {
  expectedOrigin: 'https://hunt.example',
  expectedHost: 'hunt.example',
  expectedProtocol: 'https',
  secureCookie: true,
}

describe('payout HTTP boundary', () => {
  it('allows authenticated reads and rejects public treasury triggers', async () => {
    const ready = await reservedClaim()
    const store = seedStore(ready)
    const created = await store.create({
      claimId: ready.claimId,
      payoutId: '99999999-9999-9999-9999-999999999999',
      amountLuna: 10000n,
      network: 'mainnet',
    })

    const read = await dispatchPayoutHttp(ready.service, store, {
      method: 'GET',
      path: `/api/rewards/claim/payout?claimId=${ready.claimId}`,
      headers: headers(ready.cookie),
    }, SECURITY)
    expect(read.status).toBe(200)
    expect(read.body).toEqual({
      ok: true,
      claimId: ready.claimId,
      payout: {
        payoutId: created.payout.payoutId,
        claimId: ready.claimId,
        status: 'PENDING',
        amountLuna: '10000',
        network: 'mainnet',
        txHashSafe: null,
        submittedAt: null,
        confirmedAt: null,
      },
    })
    expect(JSON.stringify(read.body)).not.toMatch(/private|mnemonic|treasury|failureCode|attemptCount/i)

    const recovered = await dispatchPayoutHttp(ready.service, store, {
      method: 'GET',
      path: '/api/rewards/claim/payout',
      headers: headers(ready.cookie),
    }, SECURITY)
    expect(recovered.status).toBe(200)
    expect(recovered.body).toMatchObject({ ok: true, claimId: ready.claimId, payout: { status: 'PENDING' } })

    const trigger = await dispatchPayoutHttp(ready.service, store, {
      method: 'POST',
      path: `/api/rewards/claim/payout?claimId=${ready.claimId}`,
      headers: headers(ready.cookie),
      rawBody: '{}',
    }, SECURITY)
    expect(trigger.status).toBe(405)

    const anon = await dispatchPayoutHttp(ready.service, store, {
      method: 'GET',
      path: `/api/rewards/claim/payout?claimId=${ready.claimId}`,
      headers: { origin: SECURITY.expectedOrigin, host: SECURITY.expectedHost, protocol: SECURITY.expectedProtocol },
    }, SECURITY)
    expect(anon.status).toBe(401)

    const proofPost = await dispatchExpeditionHttp(ready.service, {
      method: 'POST',
      path: '/api/rewards/claim/payout',
      headers: headers(ready.cookie),
      body: { claimId: ready.claimId },
    }, SECURITY)
    expect(proofPost.status).toBe(404)
  })

  it('does not let wallet A read wallet B payouts', async () => {
    const walletA = await reservedClaim()
    const walletB = await reservedClaim()
    const store = seedStore(walletB)
    await store.create({
      claimId: walletB.claimId,
      payoutId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      amountLuna: 10000n,
      network: 'mainnet',
    })

    const wrongSession = await dispatchPayoutHttp(walletB.service, store, {
      method: 'GET',
      path: `/api/rewards/claim/payout?claimId=${walletB.claimId}`,
      headers: headers(walletA.cookie),
    }, SECURITY)
    expect(wrongSession.status).toBe(401)
    expect(wrongSession.body).toEqual({ ok: false, error: 'RUN_SESSION_INVALID' })

    const stolen = await dispatchPayoutHttp(walletA.service, store, {
      method: 'GET',
      path: `/api/rewards/claim/payout?claimId=${walletB.claimId}`,
      headers: headers(walletA.cookie),
    }, SECURITY)
    expect(stolen.status).toBe(404)
    expect(stolen.body).toEqual({ ok: false, error: 'CLAIM_NOT_FOUND' })
    expect(JSON.stringify(stolen.body)).not.toMatch(/10000|aaaaaaaa/i)
  })

  it('returns a safe pending body when a reserved claim has no payout yet', async () => {
    const ready = await reservedClaim()
    const store = seedStore(ready)
    const read = await dispatchPayoutHttp(ready.service, store, {
      method: 'GET',
      path: `/api/rewards/claim/payout?claimId=${ready.claimId}`,
      headers: headers(ready.cookie),
    }, SECURITY)
    expect(read.status).toBe(200)
    expect(read.body).toEqual({ ok: true, claimId: ready.claimId, payout: null })
  })

  it('returns confirmed public fields without worker or treasury material', async () => {
    const ready = await reservedClaim()
    const store = seedStore(ready)
    const created = await store.create({
      claimId: ready.claimId,
      payoutId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      amountLuna: 10000n,
      network: 'mainnet',
    })
    const acquired = await store.acquire()
    const submitted = await store.markSubmitted(acquired!.payoutId, 'cd'.repeat(32))
    const confirmed = await store.markConfirmed(submitted.payoutId, 'cd'.repeat(32))

    const read = await dispatchPayoutHttp(ready.service, store, {
      method: 'GET',
      path: `/api/rewards/claim/payout?claimId=${ready.claimId}`,
      headers: headers(ready.cookie),
    }, SECURITY)
    expect(read.body).toEqual({
      ok: true,
      claimId: ready.claimId,
      payout: {
        payoutId: created.payout.payoutId,
        claimId: ready.claimId,
        status: 'CONFIRMED',
        amountLuna: '10000',
        network: 'mainnet',
        txHashSafe: 'cd'.repeat(32),
        submittedAt: submitted.submittedAt,
        confirmedAt: confirmed.confirmedAt,
      },
    })
    expect(JSON.stringify(read.body)).not.toMatch(/mnemonic|private_key|treasury|failureCode|worker/i)
  })
})

function seedStore(ready: Awaited<ReturnType<typeof reservedClaim>>) {
  const store = createMemoryPayoutStore()
  store.seedClaim({
    claimId: ready.claimId,
    runId: ready.runId,
    wallet: ready.wallet,
    dayKey: ready.dayKey,
    status: 'RESERVED',
    publicKey: 'pk',
    signature: 'sig',
    finalizedAt: new Date().toISOString(),
  })
  return store
}

function publishedBlueprint(mission: 'gem-runner' | 'chest-hunter' | 'vault-breaker', id: string) {
  const source = createRoom01Blueprint('2026-09-09', mission, id)
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

function headers(cookie: string) {
  return {
    origin: SECURITY.expectedOrigin,
    host: SECURITY.expectedHost,
    protocol: SECURITY.expectedProtocol,
    cookie,
  }
}

async function reservedClaim() {
  const keyPair = KeyPair.generate()
  const wallet = keyPair.toAddress().toUserFriendlyAddress()
  const service = createMemoryProofService({
    clock: { now: () => new Date('2026-09-09T12:00:00.000Z') },
    blueprints: [
      publishedBlueprint('gem-runner', 'payout-gem'),
      publishedBlueprint('chest-hunter', 'payout-chest'),
      publishedBlueprint('vault-breaker', 'payout-vault'),
    ],
  })
  const challenge = await service.issueStartChallenge(wallet, 'gem-runner')
  const startPayload = serializeStartPayload({
    version: 1,
    type: 'NIMHUNT_START_EXPEDITION',
    wallet,
    mission: 'gem-runner',
    dayKey: challenge.dayKey,
    challenge: challenge.challenge,
    blueprintId: challenge.blueprintId,
    blueprintHash: challenge.blueprintHash,
  })
  const authorized = await service.authorizeStart({
    payload: startPayload,
    publicKey: keyPair.publicKey.toHex(),
    signature: keyPair.sign(nimiqSignedMessageHash(startPayload)).toHex(),
  })
  service.markGameplayStarted(authorized.start.runId, authorized.session)
  const directions = decodeSequence(PREVALIDATED_ROOM_01_BOOTSTRAP_WINNING_SEQUENCES['gem-runner'])
  for (let index = 0; index < directions.length; index += 8) {
    const current = service.getRun(authorized.start.runId)!
    await service.appendCheckpoint({
      runId: authorized.start.runId,
      session: authorized.session,
      previousCheckpointHash: current.checkpointHash,
      actions: moves(index + 1, directions.slice(index, index + 8)),
    })
  }
  const run = service.getRun(authorized.start.runId)!
  await service.verifyExpedition({
    runId: run.runId,
    session: authorized.session,
    checkpointHash: run.checkpointHash,
  })
  const prepared = await service.prepareRewardClaim(run.runId, authorized.session)
  if (prepared.outcome !== 'PREPARED') throw new Error('PREPARED_REQUIRED')
  const reserved = await service.finalizeRewardClaim({
    session: authorized.session,
    claimId: prepared.claimId,
    payload: prepared.canonicalPayload,
    publicKey: keyPair.publicKey.toHex(),
    signature: keyPair.sign(nimiqSignedMessageHash(prepared.canonicalPayload)).toHex(),
  })
  const cookie = serializeRunSessionCookie(
    authorized.sessionCapability,
    new Date(authorized.session.expiresAt),
    new Date(authorized.session.createdAt),
    true,
  )
  return {
    service,
    wallet,
    claimId: reserved.claimId,
    runId: reserved.runId,
    dayKey: challenge.dayKey,
    cookie,
  }
}
