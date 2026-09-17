import { KeyPair } from '@nimiq/core'
import { describe, expect, it } from 'vitest'
import { parseProductRewardClaim, serializeProductRewardClaim } from '../../src/domain/productRewardClaim.ts'
import { hashBlueprint } from '../../src/game/replay/canonical.ts'
import { createRoom01Blueprint } from '../../src/game/world/room01.ts'
import type { Direction, MoveAction } from '../../src/game/replay/types.ts'
import { PREVALIDATED_ROOM_01_BOOTSTRAP_WINNING_SEQUENCES } from './room01BootstrapPrevalidation.ts'
import { serializeStartPayload, type StartExpeditionPayload } from './canonical.ts'
import { nimiqSignedMessageHash } from './crypto.ts'
import { dispatchExpeditionHttp, type ExpeditionHttpSecurity } from './http.ts'
import { createMemoryProofService } from './memoryProofStore.ts'
import { minimumPlausibleCompletionMs } from './riskGate.ts'
import { serializeRunSessionCookie } from './session.ts'

const SECURITY: ExpeditionHttpSecurity = {
  expectedOrigin: 'https://hunt.example',
  expectedHost: 'hunt.example',
  expectedProtocol: 'https',
  secureCookie: true,
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
    'content-type': 'application/json',
    cookie,
  }
}

function createClaimClock(initial = '2026-09-09T12:00:00.000Z') {
  let current = new Date(initial)
  return {
    now: () => current,
    advance(ms: number) {
      current = new Date(current.getTime() + ms)
    },
  }
}

async function startPlaying(
  mission: 'gem-runner' | 'chest-hunter' | 'vault-breaker',
  options: {
    readonly service?: ReturnType<typeof createMemoryProofService>
    readonly keyPair?: KeyPair
    readonly wallet?: string
    readonly blueprintId?: string
    readonly now?: Date
    readonly clock?: { now: () => Date; advance: (ms: number) => void }
  } = {},
) {
  const keyPair = options.keyPair ?? KeyPair.generate()
  const wallet = options.wallet ?? keyPair.toAddress().toUserFriendlyAddress()
  const clock = options.clock ?? createClaimClock((options.now ?? new Date('2026-09-09T12:00:00.000Z')).toISOString())
  const service = options.service ?? createMemoryProofService({
    clock,
    blueprints: [
      publishedBlueprint('gem-runner', options.blueprintId ?? 'claim-gem'),
      publishedBlueprint('chest-hunter', 'claim-chest'),
      publishedBlueprint('vault-breaker', 'claim-vault'),
    ],
  })
  const challenge = await service.issueStartChallenge(wallet, mission)
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
  const authorized = await service.authorizeStart({
    payload: canonicalPayload,
    publicKey: keyPair.publicKey.toHex(),
    signature: keyPair.sign(nimiqSignedMessageHash(canonicalPayload)).toHex(),
  })
  service.markGameplayStarted(authorized.start.runId, authorized.session)
  const cookie = serializeRunSessionCookie(
    authorized.sessionCapability,
    new Date(authorized.session.expiresAt),
    new Date(authorized.session.createdAt),
    true,
  )
  return { service, keyPair, wallet, mission, authorized, cookie, clock }
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
    await service.appendCheckpoint({
      runId,
      session,
      previousCheckpointHash: current.checkpointHash,
      actions: moves(index + 1, directions.slice(index, index + 8)),
    })
  }
  const next = service.getRun(runId)
  if (!next) throw new Error('RUN_MISSING')
  return next
}

async function verifyMission(mission: 'gem-runner' | 'chest-hunter' | 'vault-breaker', options: Parameters<typeof startPlaying>[1] & { readonly humanTiming?: boolean } = {}) {
  const started = await startPlaying(mission, options)
  const run = await playSequence(
    started.service,
    started.authorized.session,
    started.authorized.start.runId,
    PREVALIDATED_ROOM_01_BOOTSTRAP_WINNING_SEQUENCES[mission],
  )
  if (options.humanTiming !== false) {
    started.clock.advance((minimumPlausibleCompletionMs(run.seq) ?? 0) + 1_000)
  }
  const verified = await started.service.verifyExpedition({
    runId: run.runId,
    session: started.authorized.session,
    checkpointHash: run.checkpointHash,
  })
  return { ...started, run: started.service.getRun(run.runId)!, verified }
}

async function sealVault(ready: Awaited<ReturnType<typeof verifyMission>>) {
  const prepared = await ready.service.prepareVaultSeal(ready.run.runId, ready.authorized.session)
  await ready.service.verifyVaultSeal({
    session: ready.authorized.session,
    payload: prepared.canonicalPayload,
    publicKey: ready.keyPair.publicKey.toHex(),
    signature: ready.keyPair.sign(nimiqSignedMessageHash(prepared.canonicalPayload)).toHex(),
  })
  return ready.service.getRun(ready.run.runId)!
}

function signPayload(keyPair: KeyPair, payload: string) {
  return {
    payload,
    publicKey: keyPair.publicKey.toHex(),
    signature: keyPair.sign(nimiqSignedMessageHash(payload)).toHex(),
  }
}

function flipHex(value: string): string {
  const next = value.endsWith('0') ? '1' : '0'
  return `${value.slice(0, -1)}${next}`
}

describe('signed product reward claim', () => {
  it('prepares and finalizes an eligible Gem Runner claim without consuming an attempt', async () => {
    const ready = await verifyMission('gem-runner')
    const beforeAttempts = ready.service.getWalletDailyStatus(ready.wallet)
    const beforeRun = ready.service.getRun(ready.run.runId)!
    const first = await ready.service.prepareRewardClaim(ready.run.runId, ready.authorized.session)
    const second = await ready.service.prepareRewardClaim(ready.run.runId, ready.authorized.session)
    expect(first).toEqual(second)
    expect(first.outcome).toBe('PREPARED')
    if (first.outcome !== 'PREPARED') throw new Error('PREPARED_REQUIRED')
    const parsed = parseProductRewardClaim(first.canonicalPayload)
    expect(parsed).toMatchObject({
      version: 1,
      type: 'NIMHUNT_REWARD_CLAIM_V1',
      claimId: first.claimId,
      wallet: ready.wallet,
      runId: ready.run.runId,
      mission: 'gem-runner',
      dayKey: '2026-09-09',
      transcriptHash: ready.verified.transcriptHash,
    })
    expect(first.canonicalPayload).toBe(serializeProductRewardClaim(parsed!))
    expect(first.canonicalPayload).not.toContain('vaultSealHash')

    const finalized = await ready.service.finalizeRewardClaim({
      session: ready.authorized.session,
      claimId: first.claimId,
      ...signPayload(ready.keyPair, first.canonicalPayload),
    })
    expect(finalized.outcome).toBe('RESERVED')
    expect(finalized.reservationNumber).toBe(1)
    expect(ready.service.getWalletDailyStatus(ready.wallet)).toMatchObject({
      expeditionsStarted: beforeAttempts.expeditionsStarted,
      rewardAlreadyReserved: true,
    })
    const after = ready.service.getRun(ready.run.runId)!
    expect(after.batches).toHaveLength(beforeRun.batches.length)
    expect(after.terminal).toEqual(beforeRun.terminal)
    expect(after.seq).toBe(beforeRun.seq)
  }, 15_000)

  it('prepares and finalizes an eligible Chest Hunter claim', async () => {
    const ready = await verifyMission('chest-hunter')
    const prepared = await ready.service.prepareRewardClaim(ready.run.runId, ready.authorized.session)
    expect(prepared.outcome).toBe('PREPARED')
    if (prepared.outcome !== 'PREPARED') throw new Error('PREPARED_REQUIRED')
    expect(parseProductRewardClaim(prepared.canonicalPayload)?.mission).toBe('chest-hunter')
    const finalized = await ready.service.finalizeRewardClaim({
      session: ready.authorized.session,
      claimId: prepared.claimId,
      ...signPayload(ready.keyPair, prepared.canonicalPayload),
    })
    expect(finalized).toMatchObject({ outcome: 'RESERVED', runId: ready.run.runId })
  }, 15_000)

  it('requires a verified Vault seal and rejects seal mismatch', async () => {
    const ready = await verifyMission('vault-breaker')
    await expect(ready.service.prepareRewardClaim(ready.run.runId, ready.authorized.session))
      .rejects.toMatchObject({ code: 'VAULT_SEAL_REQUIRED' })
    await sealVault(ready)
    const prepared = await ready.service.prepareRewardClaim(ready.run.runId, ready.authorized.session)
    expect(prepared.outcome).toBe('PREPARED')
    if (prepared.outcome !== 'PREPARED') throw new Error('PREPARED_REQUIRED')
    const parsed = parseProductRewardClaim(prepared.canonicalPayload)!
    expect(parsed.mission).toBe('vault-breaker')
    expect('vaultSealHash' in parsed).toBe(true)
    const mismatched = serializeProductRewardClaim({ ...parsed, vaultSealHash: 'aa'.repeat(32) } as typeof parsed)
    await expect(ready.service.finalizeRewardClaim({
      session: ready.authorized.session,
      claimId: prepared.claimId,
      ...signPayload(ready.keyPair, mismatched),
    })).rejects.toMatchObject({ code: 'CLAIM_MISMATCH' })
  }, 15_000)

  it('rejects incomplete and unverified runs', async () => {
    const started = await startPlaying('gem-runner')
    await expect(started.service.prepareRewardClaim(started.authorized.start.runId, started.authorized.session))
      .rejects.toMatchObject({ code: 'CLAIM_NOT_ELIGIBLE' })
    const playing = await playSequence(
      started.service,
      started.authorized.session,
      started.authorized.start.runId,
      PREVALIDATED_ROOM_01_BOOTSTRAP_WINNING_SEQUENCES['gem-runner'].slice(0, 8),
    )
    await expect(started.service.verifyExpedition({
      runId: playing.runId,
      session: started.authorized.session,
      checkpointHash: playing.checkpointHash,
    })).rejects.toMatchObject({ code: 'RUN_INCOMPLETE' })
    await expect(started.service.prepareRewardClaim(playing.runId, started.authorized.session))
      .rejects.toMatchObject({ code: 'CLAIM_NOT_ELIGIBLE' })
  }, 15_000)

  it('rejects altered claimId, run, wallet, day, transcript, and blueprint fields', async () => {
    const ready = await verifyMission('gem-runner')
    const prepared = await ready.service.prepareRewardClaim(ready.run.runId, ready.authorized.session)
    if (prepared.outcome !== 'PREPARED') throw new Error('PREPARED_REQUIRED')
    const parsed = parseProductRewardClaim(prepared.canonicalPayload)!
    const other = await verifyMission('chest-hunter')

    for (const payload of [
      serializeProductRewardClaim({ ...parsed, claimId: other.run.runId }),
      serializeProductRewardClaim({ ...parsed, runId: other.run.runId }),
      serializeProductRewardClaim({ ...parsed, wallet: other.wallet }),
      serializeProductRewardClaim({ ...parsed, dayKey: '2026-09-10' }),
      serializeProductRewardClaim({ ...parsed, transcriptHash: other.verified.transcriptHash }),
      serializeProductRewardClaim({ ...parsed, blueprintHash: 'aa'.repeat(32) }),
    ]) {
      await expect(ready.service.finalizeRewardClaim({
        session: ready.authorized.session,
        claimId: prepared.claimId,
        ...signPayload(ready.keyPair, payload),
      })).rejects.toMatchObject({ code: /CLAIM_MISMATCH|WALLET_MISMATCH|RUN_MISMATCH/ })
    }
  }, 15_000)

  it('rejects invalid signatures and address mismatch without consuming a slot', async () => {
    const ready = await verifyMission('gem-runner')
    const prepared = await ready.service.prepareRewardClaim(ready.run.runId, ready.authorized.session)
    if (prepared.outcome !== 'PREPARED') throw new Error('PREPARED_REQUIRED')
    const signed = signPayload(ready.keyPair, prepared.canonicalPayload)
    await expect(ready.service.finalizeRewardClaim({
      session: ready.authorized.session,
      claimId: prepared.claimId,
      payload: signed.payload,
      publicKey: signed.publicKey,
      signature: flipHex(signed.signature),
    })).rejects.toMatchObject({ code: 'INVALID_SIGNATURE' })
    expect(ready.service.getWalletDailyStatus(ready.wallet).rewardAlreadyReserved).toBe(false)

    const other = KeyPair.generate()
    await expect(ready.service.finalizeRewardClaim({
      session: ready.authorized.session,
      claimId: prepared.claimId,
      ...signPayload(other, prepared.canonicalPayload),
    })).rejects.toMatchObject({ code: 'ADDRESS_MISMATCH' })
    expect(ready.service.getWalletDailyStatus(ready.wallet).rewardAlreadyReserved).toBe(false)

    const retry = await ready.service.prepareRewardClaim(ready.run.runId, ready.authorized.session)
    expect(retry.outcome).toBe('PREPARED')
    if (retry.outcome !== 'PREPARED') throw new Error('PREPARED_REQUIRED')
    expect(retry.claimId).toBe(prepared.claimId)
    const reserved = await ready.service.finalizeRewardClaim({
      session: ready.authorized.session,
      claimId: prepared.claimId,
      ...signed,
    })
    expect(reserved.outcome).toBe('RESERVED')
  }, 15_000)

  it('binds claim expiry to the next UTC reset and stays retryable until then', async () => {
    const ready = await verifyMission('gem-runner')
    const prepared = await ready.service.prepareRewardClaim(ready.run.runId, ready.authorized.session)
    expect(prepared.outcome).toBe('PREPARED')
    if (prepared.outcome !== 'PREPARED') throw new Error('PREPARED_REQUIRED')
    expect(prepared.expiresAt).toBe('2026-09-10T00:00:00.000Z')
    expect(ready.service.getWalletDailyStatus(ready.wallet).rewardAlreadyReserved).toBe(false)
  }, 15_000)

  it('finalizes exactly once and blocks a second run for the same wallet/day', async () => {
    const first = await verifyMission('gem-runner')
    const prepared = await first.service.prepareRewardClaim(first.run.runId, first.authorized.session)
    if (prepared.outcome !== 'PREPARED') throw new Error('PREPARED_REQUIRED')
    const signed = signPayload(first.keyPair, prepared.canonicalPayload)
    const reserved = await first.service.finalizeRewardClaim({
      session: first.authorized.session,
      claimId: prepared.claimId,
      ...signed,
    })
    const retry = await first.service.finalizeRewardClaim({
      session: first.authorized.session,
      claimId: prepared.claimId,
      ...signed,
    })
    expect(retry).toEqual(reserved)

    const second = await startPlaying('chest-hunter', {
      service: first.service,
      keyPair: first.keyPair,
      wallet: first.wallet,
    })
    const secondRun = await playSequence(
      first.service,
      second.authorized.session,
      second.authorized.start.runId,
      PREVALIDATED_ROOM_01_BOOTSTRAP_WINNING_SEQUENCES['chest-hunter'],
    )
    first.clock.advance((minimumPlausibleCompletionMs(secondRun.seq) ?? 0) + 1_000)
    await first.service.verifyExpedition({
      runId: secondRun.runId,
      session: second.authorized.session,
      checkpointHash: secondRun.checkpointHash,
    })
    const blocked = await first.service.prepareRewardClaim(secondRun.runId, second.authorized.session)
    expect(blocked.outcome).toBe('ALREADY_REWARDED')
    expect(first.service.getWalletDailyStatus(first.wallet).expeditionsStarted).toBe(2)
  }, 15_000)

  it('serves prepare and finalize over product HTTP without mutating attempts', async () => {
    const ready = await verifyMission('gem-runner')
    const before = ready.service.getWalletDailyStatus(ready.wallet)
    const prepared = await dispatchExpeditionHttp(ready.service, {
      method: 'POST',
      path: '/api/rewards/claim/prepare',
      headers: headers(ready.cookie),
      body: { runId: ready.run.runId },
    }, SECURITY)
    expect(prepared.status).toBe(200)
    expect(prepared.body).toMatchObject({ ok: true, outcome: 'PREPARED', runId: ready.run.runId })
    const body = prepared.body as { claimId: string; canonicalPayload: string }
    const signed = signPayload(ready.keyPair, body.canonicalPayload)
    const finalized = await dispatchExpeditionHttp(ready.service, {
      method: 'POST',
      path: '/api/rewards/claim/finalize',
      headers: headers(ready.cookie),
      body: { claimId: body.claimId, payload: body.canonicalPayload, publicKey: signed.publicKey, signature: signed.signature },
    }, SECURITY)
    expect(finalized.status).toBe(200)
    expect(finalized.body).toMatchObject({ ok: true, outcome: 'RESERVED', totalSlots: 69, reservationNumber: 1 })
    expect(ready.service.getWalletDailyStatus(ready.wallet).expeditionsStarted).toBe(before.expeditionsStarted)
  }, 15_000)
})
