import { KeyPair } from '@nimiq/core'
import { describe, expect, it } from 'vitest'
import { dispatchExpeditionHttp, type ExpeditionHttpSecurity } from '../expeditions/http.ts'
import { createMemoryProofService } from '../expeditions/memoryProofStore.ts'
import { describeSessionCookie, parseRunSessionCookie, parseWalletRecoverySessionCookie, serializeRunSessionCookie } from '../expeditions/session.ts'
import { hashBlueprint } from '../../src/game/replay/canonical.ts'
import { createRoom01Blueprint } from '../../src/game/world/room01.ts'
import { PREVALIDATED_ROOM_01_BOOTSTRAP_WINNING_SEQUENCES } from '../expeditions/room01BootstrapPrevalidation.ts'
import { serializeStartPayload } from '../expeditions/canonical.ts'
import { serializeWalletRecoveryPayload } from '../expeditions/walletRecovery.ts'
import { nimiqSignedMessageHash } from '../expeditions/crypto.ts'
import type { Direction, MoveAction } from '../../src/game/replay/types.ts'
import { WALLET_DAILY_STATUS_PATH } from '../../src/domain/dailyLedger.ts'
import { RECOVER_SESSION_CHALLENGE_PATH } from '../../src/domain/walletRecovery.ts'
import { dispatchPayoutHttp } from './http.ts'
import { createMemoryPayoutStore } from './store.ts'

const SECURITY: ExpeditionHttpSecurity = {
  expectedOrigin: 'https://hunt.example',
  expectedHost: 'hunt.example',
  expectedProtocol: 'https',
  secureCookie: true,
}

const LOCAL_SECURITY: ExpeditionHttpSecurity = {
  expectedOrigin: 'http://localhost:5173',
  expectedHost: 'localhost:5173',
  expectedProtocol: 'http',
  secureCookie: false,
  allowAuthorizedLocalHttpOrigins: true,
}

const LAN = {
  origin: 'http://192.168.1.10:5173',
  host: '192.168.1.10:5173',
  protocol: 'http' as const,
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

    const recoveredA = await dispatchPayoutHttp(walletA.service, store, {
      method: 'GET',
      path: '/api/rewards/claim/payout',
      headers: headers(walletA.cookie),
    }, SECURITY)
    expect(recoveredA.status).toBe(200)
    expect(recoveredA.body).toMatchObject({ ok: true, claimId: walletA.claimId, payout: null })
    expect(JSON.stringify(recoveredA.body)).not.toContain(walletB.claimId)
    expect(JSON.stringify(recoveredA.body)).not.toMatch(/10000|aaaaaaaa/i)

    const recoveredB = await dispatchPayoutHttp(walletB.service, store, {
      method: 'GET',
      path: '/api/rewards/claim/payout',
      headers: headers(walletB.cookie),
    }, SECURITY)
    expect(recoveredB.status).toBe(200)
    expect(recoveredB.body).toMatchObject({ ok: true, claimId: walletB.claimId, payout: { payoutId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' } })
    expect(JSON.stringify(recoveredB.body)).not.toContain(walletA.claimId)
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

  it('rejects session-only recovery after the server session expires even if a cookie is still presented', async () => {
    const ready = await reservedClaim()
    const store = seedStore(ready)
    await store.create({
      claimId: ready.claimId,
      payoutId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
      amountLuna: 10000n,
      network: 'mainnet',
    })
    ready.setNow('2026-09-10T00:00:00.000Z')

    const expired = await dispatchPayoutHttp(ready.service, store, {
      method: 'GET',
      path: '/api/rewards/claim/payout',
      headers: headers(ready.cookie),
    }, SECURITY)
    expect(expired.status).toBe(401)
    expect(expired.body).toEqual({ ok: false, error: 'RUN_SESSION_INVALID' })
    expect(JSON.stringify(expired.body)).not.toMatch(/10000|cccccccc/i)
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

  it('does not let an approved wallet read payouts without a recovery signature', async () => {
    const ready = await reservedClaim()
    const store = seedStore(ready)
    await store.create({
      claimId: ready.claimId,
      payoutId: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
      amountLuna: 10000n,
      network: 'mainnet',
    })

    const missing = await dispatchPayoutHttp(ready.service, store, {
      method: 'GET',
      path: '/api/rewards/claim/payout',
      headers: {
        origin: SECURITY.expectedOrigin,
        host: SECURITY.expectedHost,
        protocol: SECURITY.expectedProtocol,
      },
    }, SECURITY)
    expect(missing.status).toBe(401)
    expect(missing.body).toEqual({ ok: false, error: 'RUN_SESSION_INVALID' })
    expect(JSON.stringify(missing.body)).not.toMatch(/10000|dddddddd/i)
  })

  it('restores the reserved payout through a valid wallet recovery session', async () => {
    const ready = await reservedClaim()
    const store = seedStore(ready)
    await store.create({
      claimId: ready.claimId,
      payoutId: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
      amountLuna: 10000n,
      network: 'mainnet',
    })
    const cookie = await recoverWalletCookie(ready)

    const recovered = await dispatchPayoutHttp(ready.service, store, {
      method: 'GET',
      path: '/api/rewards/claim/payout',
      headers: headers(cookie),
    }, SECURITY)
    expect(recovered.status).toBe(200)
    expect(recovered.body).toMatchObject({
      ok: true,
      claimId: ready.claimId,
      payout: { status: 'PENDING', amountLuna: '10000' },
    })
    expect(ready.service.getWalletDailyStatus(ready.wallet).expeditionsStarted).toBe(1)
  })

  it('restores a CONFIRMED payout through a wallet recovery session without a run session', async () => {
    const ready = await reservedClaim()
    const store = seedStore(ready)
    const created = await store.create({
      claimId: ready.claimId,
      payoutId: 'd19bf406-2b81-4c5a-b271-da8eb7587cbd',
      amountLuna: 10000n,
      network: 'mainnet',
    })
    const acquired = await store.acquire()
    const submitted = await store.markSubmitted(acquired!.payoutId, 'c58022f37ed7352f41c29ef9862297a9cfa8c45593456395d7a6eb7a68009ff6')
    const confirmed = await store.markConfirmed(submitted.payoutId, 'c58022f37ed7352f41c29ef9862297a9cfa8c45593456395d7a6eb7a68009ff6')
    const cookie = await recoverWalletCookie(ready)

    expect(parseRunSessionCookie(cookie)).toBeNull()
    expect(parseWalletRecoverySessionCookie(cookie)).toBeTruthy()

    const recovered = await dispatchPayoutHttp(ready.service, store, {
      method: 'GET',
      path: '/api/rewards/claim/payout',
      headers: headers(cookie),
    }, SECURITY)
    expect(recovered.status).toBe(200)
    expect(recovered.body).toEqual({
      ok: true,
      claimId: ready.claimId,
      payout: {
        payoutId: created.payout.payoutId,
        claimId: ready.claimId,
        status: 'CONFIRMED',
        amountLuna: '10000',
        network: 'mainnet',
        txHashSafe: 'c58022f37ed7352f41c29ef9862297a9cfa8c45593456395d7a6eb7a68009ff6',
        submittedAt: submitted.submittedAt,
        confirmedAt: confirmed.confirmedAt,
      },
    })
    expect(ready.service.getWalletDailyStatus(ready.wallet).expeditionsStarted).toBe(1)
    expect(ready.service.snapshot().runs).toHaveLength(1)
  })

  it('fails closed when the wallet recovery session has expired', async () => {
    const ready = await reservedClaim()
    const store = seedStore(ready)
    await store.create({
      claimId: ready.claimId,
      payoutId: 'abababab-abab-abab-abab-abababababab',
      amountLuna: 10000n,
      network: 'mainnet',
    })
    const cookie = await recoverWalletCookie(ready)
    ready.setNow('2026-09-10T00:00:00.000Z')

    const expired = await dispatchPayoutHttp(ready.service, store, {
      method: 'GET',
      path: '/api/rewards/claim/payout',
      headers: headers(cookie),
    }, SECURITY)
    expect(expired.status).toBe(401)
    expect(expired.body).toEqual({ ok: false, error: 'RUN_SESSION_INVALID' })
    expect(JSON.stringify(expired.body)).not.toMatch(/10000|abababab/i)
  })

  it('does not let wallet A recover wallet B payouts', async () => {
    const walletA = await reservedClaim()
    const walletB = await reservedClaim()
    const store = seedStore(walletB)
    await store.create({
      claimId: walletB.claimId,
      payoutId: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
      amountLuna: 10000n,
      network: 'mainnet',
    })
    const cookieA = await recoverWalletCookie(walletA)

    const crossed = await dispatchPayoutHttp(walletA.service, store, {
      method: 'GET',
      path: `/api/rewards/claim/payout?claimId=${walletB.claimId}`,
      headers: headers(cookieA),
    }, SECURITY)
    expect(crossed.status).toBe(404)
    expect(crossed.body).toEqual({ ok: false, error: 'CLAIM_NOT_FOUND' })
    expect(JSON.stringify(crossed.body)).not.toMatch(/10000|ffffffff/i)
    expect(JSON.stringify(crossed.body)).not.toContain(walletB.claimId)
  })

  it('allows localhost and authorized local-LAN payout GETs under the existing dev-only host rule', async () => {
    const ready = await reservedClaim()
    const store = seedStore(ready)
    await store.create({
      claimId: ready.claimId,
      payoutId: 'd19bf406-2b81-4c5a-b271-da8eb7587cbd',
      amountLuna: 10000n,
      network: 'mainnet',
    })

    const localhostRead = await dispatchPayoutHttp(ready.service, store, {
      method: 'GET',
      path: '/api/rewards/claim/payout',
      headers: { ...localHeaders(ready.cookie), origin: LOCAL_SECURITY.expectedOrigin },
      host: LOCAL_SECURITY.expectedHost,
      protocol: 'http',
    }, LOCAL_SECURITY)
    expect(localhostRead.status).toBe(200)
    expect(localhostRead.body).toMatchObject({ ok: true, claimId: ready.claimId, payout: { status: 'PENDING' } })

    const lanRead = await dispatchPayoutHttp(ready.service, store, {
      method: 'GET',
      path: '/api/rewards/claim/payout',
      headers: { ...lanHeaders(ready.cookie) },
      host: LAN.host,
      protocol: 'http',
    }, LOCAL_SECURITY)
    expect(lanRead.status).toBe(200)
    expect(lanRead.body).toMatchObject({ ok: true, claimId: ready.claimId, payout: { status: 'PENDING' } })

    const daily = await dispatchExpeditionHttp(ready.service, {
      method: 'POST',
      path: WALLET_DAILY_STATUS_PATH,
      headers: lanHeaders(),
      host: LAN.host,
      protocol: 'http',
      body: { wallet: ready.wallet },
    }, LOCAL_SECURITY)
    expect(daily.status).toBe(200)
  })

  it('rejects arbitrary LAN/Host spoofs and production host mismatches', async () => {
    const ready = await reservedClaim()
    const store = seedStore(ready)
    await store.create({
      claimId: ready.claimId,
      payoutId: 'd19bf406-2b81-4c5a-b271-da8eb7587cbd',
      amountLuna: 10000n,
      network: 'mainnet',
    })

    const spoofedPublic = await dispatchPayoutHttp(ready.service, store, {
      method: 'GET',
      path: '/api/rewards/claim/payout',
      headers: {
        origin: 'http://203.0.113.10:5173',
        host: '203.0.113.10:5173',
        protocol: 'http',
        cookie: ready.cookie,
      },
      host: '203.0.113.10:5173',
      protocol: 'http',
    }, LOCAL_SECURITY)
    expect(spoofedPublic.status).toBe(400)
    expect(spoofedPublic.body).toEqual({ ok: false, error: 'MALFORMED_REQUEST' })

    const spoofedPort = await dispatchPayoutHttp(ready.service, store, {
      method: 'GET',
      path: '/api/rewards/claim/payout',
      headers: {
        origin: 'http://192.168.1.10:9999',
        host: '192.168.1.10:9999',
        protocol: 'http',
        cookie: ready.cookie,
      },
      host: '192.168.1.10:9999',
      protocol: 'http',
    }, LOCAL_SECURITY)
    expect(spoofedPort.status).toBe(400)
    expect(spoofedPort.body).toEqual({ ok: false, error: 'MALFORMED_REQUEST' })

    const spoofedOrigin = await dispatchPayoutHttp(ready.service, store, {
      method: 'GET',
      path: '/api/rewards/claim/payout',
      headers: {
        origin: 'http://evil.example',
        host: LAN.host,
        protocol: 'http',
        cookie: ready.cookie,
      },
      host: LAN.host,
      protocol: 'http',
    }, LOCAL_SECURITY)
    expect(spoofedOrigin.status).toBe(400)
    expect(spoofedOrigin.body).toEqual({ ok: false, error: 'MALFORMED_REQUEST' })

    const productionMismatch = await dispatchPayoutHttp(ready.service, store, {
      method: 'GET',
      path: '/api/rewards/claim/payout',
      headers: {
        origin: 'https://evil.example',
        host: 'evil.example',
        protocol: 'https',
        cookie: ready.cookie,
      },
      host: 'evil.example',
      protocol: 'https',
    }, SECURITY)
    expect(productionMismatch.status).toBe(400)
    expect(productionMismatch.body).toEqual({ ok: false, error: 'MALFORMED_REQUEST' })

    const productionLan = await dispatchPayoutHttp(ready.service, store, {
      method: 'GET',
      path: '/api/rewards/claim/payout',
      headers: lanHeaders(ready.cookie),
      host: LAN.host,
      protocol: 'http',
    }, SECURITY)
    expect(productionLan.status).toBe(400)
    expect(productionLan.body).toEqual({ ok: false, error: 'MALFORMED_REQUEST' })
    expect(JSON.stringify(spoofedPublic.body)).not.toMatch(/10000|d19bf406/i)
    expect(JSON.stringify(productionMismatch.body)).not.toMatch(/10000|d19bf406/i)
  })

  it('recovers a CONFIRMED LAN payout after RUN_SESSION_INVALID through NIMHUNT_RECOVER_SESSION_V1', async () => {
    const ready = await reservedClaim()
    const store = seedStore(ready)
    const created = await store.create({
      claimId: ready.claimId,
      payoutId: 'd19bf406-2b81-4c5a-b271-da8eb7587cbd',
      amountLuna: 10000n,
      network: 'mainnet',
    })
    const acquired = await store.acquire()
    const submitted = await store.markSubmitted(acquired!.payoutId, 'c58022f37ed7352f41c29ef9862297a9cfa8c45593456395d7a6eb7a68009ff6')
    const confirmed = await store.markConfirmed(submitted.payoutId, 'c58022f37ed7352f41c29ef9862297a9cfa8c45593456395d7a6eb7a68009ff6')

    const missing = await dispatchPayoutHttp(ready.service, store, {
      method: 'GET',
      path: '/api/rewards/claim/payout',
      headers: lanHeaders(),
      host: LAN.host,
      protocol: 'http',
    }, LOCAL_SECURITY)
    expect(missing.status).toBe(401)
    expect(missing.body).toEqual({ ok: false, error: 'RUN_SESSION_INVALID' })
    expect(JSON.stringify(missing.body)).not.toMatch(/10000|d19bf406/i)

    const cookie = await recoverWalletCookie(ready, LOCAL_SECURITY, LAN)
    expect(parseRunSessionCookie(cookie)).toBeNull()
    expect(parseWalletRecoverySessionCookie(cookie)).toBeTruthy()
    expect(describeSessionCookie(cookie)).toEqual({
      header: 'yes',
      name: 'nimhunt_wallet_session',
      secure: 'no',
      sameSite: 'Strict',
      path: '/api',
      maxAgePresent: 'yes',
    })

    const recovered = await dispatchPayoutHttp(ready.service, store, {
      method: 'GET',
      path: '/api/rewards/claim/payout',
      headers: lanHeaders(cookie),
      host: LAN.host,
      protocol: 'http',
    }, LOCAL_SECURITY)
    expect(recovered.status).toBe(200)
    expect(recovered.body).toEqual({
      ok: true,
      claimId: ready.claimId,
      payout: {
        payoutId: created.payout.payoutId,
        claimId: ready.claimId,
        status: 'CONFIRMED',
        amountLuna: '10000',
        network: 'mainnet',
        txHashSafe: 'c58022f37ed7352f41c29ef9862297a9cfa8c45593456395d7a6eb7a68009ff6',
        submittedAt: submitted.submittedAt,
        confirmedAt: confirmed.confirmedAt,
      },
    })
    expect(ready.service.getWalletDailyStatus(ready.wallet).expeditionsStarted).toBe(1)
    expect(ready.service.snapshot().runs).toHaveLength(1)
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

function localHeaders(cookie?: string) {
  return {
    origin: LOCAL_SECURITY.expectedOrigin,
    host: LOCAL_SECURITY.expectedHost,
    protocol: LOCAL_SECURITY.expectedProtocol,
    ...(cookie ? { cookie } : {}),
  }
}

function lanHeaders(cookie?: string) {
  return {
    origin: LAN.origin,
    host: LAN.host,
    protocol: LAN.protocol,
    'content-type': 'application/json',
    ...(cookie ? { cookie } : {}),
  }
}

async function reservedClaim() {
  const keyPair = KeyPair.generate()
  const wallet = keyPair.toAddress().toUserFriendlyAddress()
  let now = new Date('2026-09-09T12:00:00.000Z')
  const service = createMemoryProofService({
    clock: { now: () => now },
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
    keyPair,
    claimId: reserved.claimId,
    runId: reserved.runId,
    dayKey: challenge.dayKey,
    cookie,
    setNow(value: string) {
      now = new Date(value)
    },
  }
}

async function recoverWalletCookie(
  ready: Awaited<ReturnType<typeof reservedClaim>>,
  security: ExpeditionHttpSecurity = SECURITY,
  requestHost: { origin: string; host: string; protocol: 'http' | 'https' } = {
    origin: security.expectedOrigin,
    host: security.expectedHost,
    protocol: security.expectedProtocol,
  },
) {
  const requestHeaders = {
    origin: requestHost.origin,
    host: requestHost.host,
    protocol: requestHost.protocol,
    'content-type': 'application/json',
  }
  const challengeResponse = await dispatchExpeditionHttp(ready.service, {
    method: 'POST',
    path: RECOVER_SESSION_CHALLENGE_PATH,
    headers: requestHeaders,
    host: requestHost.host,
    protocol: requestHost.protocol,
    body: { wallet: ready.wallet },
  }, security)
  expect(challengeResponse.status).toBe(200)
  const challenge = challengeResponse.body as {
    wallet: string
    challenge: string
    issuedAt: string
    expiresAt: string
    purpose: 'reward/daily-state recovery'
  }
  const canonicalPayload = serializeWalletRecoveryPayload({
    version: 1,
    type: 'NIMHUNT_RECOVER_SESSION_V1',
    wallet: challenge.wallet,
    challenge: challenge.challenge,
    issuedAt: challenge.issuedAt,
    expiresAt: challenge.expiresAt,
    purpose: challenge.purpose,
  })
  expect(canonicalPayload).toContain('NIMHUNT_RECOVER_SESSION_V1')
  const recovered = await dispatchExpeditionHttp(ready.service, {
    method: 'POST',
    path: '/api/wallet/recover-session',
    headers: requestHeaders,
    host: requestHost.host,
    protocol: requestHost.protocol,
    body: {
      payload: canonicalPayload,
      publicKey: ready.keyPair.publicKey.toHex(),
      signature: ready.keyPair.sign(nimiqSignedMessageHash(canonicalPayload)).toHex(),
    },
  }, security)
  expect(recovered.status).toBe(200)
  return recovered.headers?.['set-cookie'] ?? ''
}
