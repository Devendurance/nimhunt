import { KeyPair } from '@nimiq/core'
import { describe, expect, it } from 'vitest'
import { hashBlueprint } from '../../src/game/replay/canonical.ts'
import { createRoom01Blueprint } from '../../src/game/world/room01.ts'
import { serializeStartPayload, type StartExpeditionPayload } from './canonical.ts'
import { nimiqSignedMessageHash } from './crypto.ts'
import { createMemoryProofService } from './memoryProofStore.ts'

function clock(start = '2026-09-09T12:00:00.000Z') {
  let current = new Date(start)
  return {
    now: () => current,
    set(value: string) {
      current = new Date(value)
    },
  }
}

function publishedBlueprint(dayKey = '2026-09-09', mission: 'gem-runner' | 'chest-hunter' | 'vault-breaker' = 'gem-runner') {
  const source = createRoom01Blueprint(dayKey, mission, `bootstrap-${dayKey}-${mission}`)
  return { ...source, status: 'PUBLISHED' as const, blueprintHash: hashBlueprint(source) }
}

function fixture(options: { readonly now?: string; readonly dayKey?: string } = {}) {
  const time = clock(options.now ?? '2026-09-09T12:00:00.000Z')
  const dayKey = options.dayKey ?? '2026-09-09'
  const service = createMemoryProofService({ clock: time, blueprints: [publishedBlueprint(dayKey)] })
  const keyPair = KeyPair.generate()
  const wallet = keyPair.toAddress().toUserFriendlyAddress()
  return { time, service, keyPair, wallet }
}

async function signedStart(service: ReturnType<typeof createMemoryProofService>, keyPair: KeyPair, wallet: string, changes: Partial<StartExpeditionPayload> = {}) {
  const challenge = await service.issueStartChallenge(wallet, 'gem-runner')
  const request = createSignedRequest(keyPair, wallet, challenge, changes)
  return { challenge, payload: JSON.parse(request.payload) as StartExpeditionPayload, request, result: await service.authorizeStart(request) }
}

async function signedRequest(service: ReturnType<typeof createMemoryProofService>, keyPair: KeyPair, wallet: string, changes: Partial<StartExpeditionPayload> = {}) {
  const challenge = await service.issueStartChallenge(wallet, 'gem-runner')
  return { challenge, request: createSignedRequest(keyPair, wallet, challenge, changes) }
}

function createSignedRequest(
  keyPair: KeyPair,
  wallet: string,
  challenge: { readonly challenge: string; readonly dayKey: string; readonly blueprintId: string; readonly blueprintHash: string },
  changes: Partial<StartExpeditionPayload>,
) {
  const payload: StartExpeditionPayload = {
    version: 1,
    type: 'NIMHUNT_START_EXPEDITION',
    wallet,
    mission: 'gem-runner',
    dayKey: challenge.dayKey,
    challenge: challenge.challenge,
    blueprintId: challenge.blueprintId,
    blueprintHash: challenge.blueprintHash,
    ...changes,
  }
  const canonicalPayload = serializeStartPayload(payload)
  const request = {
    payload: canonicalPayload,
    publicKey: keyPair.publicKey.toHex(),
    signature: keyPair.sign(nimiqSignedMessageHash(canonicalPayload)).toHex(),
  }
  return request
}

describe('atomic signed expedition start', () => {
  it('bounds a challenge to five minutes and the next UTC midnight', async () => {
    const first = fixture({ now: '2026-09-09T12:00:00.000Z' })
    const midday = await first.service.issueStartChallenge(first.wallet, 'gem-runner')
    expect(midday.expiresAt).toBe('2026-09-09T12:05:00.000Z')

    const boundary = fixture({ now: '2026-09-09T23:58:00.000Z' })
    const late = await boundary.service.issueStartChallenge(boundary.wallet, 'gem-runner')
    expect(late.expiresAt).toBe('2026-09-10T00:00:00.000Z')
  }, 15_000)

  it('creates one durable run, deterministic initial checkpoint, and hashed session binding', async () => {
    const { service, keyPair, wallet } = fixture()
    const started = await signedStart(service, keyPair, wallet)

    expect(started.result.outcome).toBe('START_CREATED')
    expect(started.result.start.attemptsRemaining).toBe(2)
    expect(started.result.start.rulesVersion).toBe('nimhunt-rules-v1')
    expect(started.result.start.blueprint).toMatchObject({ status: 'PUBLISHED', mission: 'gem-runner' })
    expect(started.result.sessionCapability).toMatch(/^[A-Za-z0-9_-]+$/)

    const run = service.getRun(started.result.start.runId)
    expect(run).toMatchObject({ seq: 0, status: 'STARTED', runChallenge: started.result.start.runChallenge })
    expect(run?.initialStateHash).toMatch(/^[0-9a-f]{64}$/)
    expect(run?.initialTranscriptHash).toMatch(/^[0-9a-f]{64}$/)
    expect(run?.initialCheckpointHash).toMatch(/^[0-9a-f]{64}$/)
    expect(run?.checkpointHash).toBe(run?.initialCheckpointHash)

    const snapshot = service.snapshot()
    expect(JSON.stringify(snapshot)).not.toContain(started.result.sessionCapability)
    expect(snapshot.sessions[0]?.sessionHash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('returns the same response for an exact retry and consumes one attempt', async () => {
    const { service, keyPair, wallet } = fixture()
    const first = await signedStart(service, keyPair, wallet)
    const retry = await service.authorizeStart(first.request)

    expect(retry.outcome).toBe('START_ALREADY_CREATED')
    expect(retry.start).toEqual(first.result.start)
    expect(retry.sessionCapability).not.toBe(first.result.sessionCapability)
    expect(service.getWalletDailyStatus(wallet).expeditionsStarted).toBe(1)
  })

  it('returns the same successful start after midnight only for the exact authorization', async () => {
    const { service, time, keyPair, wallet } = fixture({ now: '2026-09-09T23:59:00.000Z' })
    const first = await signedStart(service, keyPair, wallet)
    time.set('2026-09-10T00:00:00.000Z')

    const retry = await service.authorizeStart(first.request)
    expect(retry.outcome).toBe('START_ALREADY_CREATED')
    expect(retry.start).toEqual(first.result.start)
    expect(service.getWalletDailyStatus(wallet).expeditionsStarted).toBe(0)
  })

  it('rejects a previous-day unused challenge before expiry and consumes nothing', async () => {
    const { service, time, keyPair, wallet } = fixture({ now: '2026-09-09T23:59:59.000Z' })
    const challenge = await service.issueStartChallenge(wallet, 'gem-runner')
    time.set('2026-09-10T00:00:00.000Z')
    const payload: StartExpeditionPayload = {
      version: 1,
      type: 'NIMHUNT_START_EXPEDITION',
      wallet,
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

    await expect(service.authorizeStart(request)).rejects.toMatchObject({ code: 'START_CHALLENGE_DAY_EXPIRED' })
    expect(service.getWalletDailyStatus(wallet).expeditionsStarted).toBe(0)
  })

  it('rejects invalid signatures, expired challenges, and altered bindings without consuming attempts', async () => {
    const invalid = fixture()
    const issued = await invalid.service.issueStartChallenge(invalid.wallet, 'gem-runner')
    const payload: StartExpeditionPayload = {
      version: 1,
      type: 'NIMHUNT_START_EXPEDITION',
      wallet: invalid.wallet,
      mission: 'gem-runner',
      dayKey: issued.dayKey,
      challenge: issued.challenge,
      blueprintId: issued.blueprintId,
      blueprintHash: issued.blueprintHash,
    }
    const canonicalPayload = serializeStartPayload(payload)
    await expect(invalid.service.authorizeStart({
      payload: canonicalPayload,
      publicKey: invalid.keyPair.publicKey.toHex(),
      signature: '00'.repeat(64),
    })).rejects.toMatchObject({ code: 'INVALID_SIGNATURE' })
    expect(invalid.service.getWalletDailyStatus(invalid.wallet).expeditionsStarted).toBe(0)

    const expired = fixture()
    const expiredChallenge = await signedRequest(expired.service, expired.keyPair, expired.wallet)
    expired.time.set('2026-09-09T12:05:00.000Z')
    await expect(expired.service.authorizeStart(expiredChallenge.request)).rejects.toMatchObject({ code: 'START_CHALLENGE_EXPIRED' })
    expect(expired.service.getWalletDailyStatus(expired.wallet).expeditionsStarted).toBe(0)

    const altered = fixture()
    const alteredStart = await signedRequest(altered.service, altered.keyPair, altered.wallet, { mission: 'chest-hunter' })
    await expect(altered.service.authorizeStart(alteredStart.request)).rejects.toMatchObject({ code: 'START_CHALLENGE_INVALID' })
    expect(altered.service.getWalletDailyStatus(altered.wallet).expeditionsStarted).toBe(0)
  })

  it('rejects signed wallet and blueprint binding changes before consuming an attempt', async () => {
    const walletFixture = fixture()
    const otherKeyPair = KeyPair.generate()
    const otherWallet = otherKeyPair.toAddress().toUserFriendlyAddress()
    const walletChallenge = await walletFixture.service.issueStartChallenge(walletFixture.wallet, 'gem-runner')
    const walletChanged = { request: createSignedRequest(otherKeyPair, otherWallet, walletChallenge, {}) }
    await expect(walletFixture.service.authorizeStart(walletChanged.request)).rejects.toMatchObject({ code: 'START_CHALLENGE_INVALID' })

    const blueprintFixture = fixture()
    const blueprintChanged = await signedRequest(blueprintFixture.service, blueprintFixture.keyPair, blueprintFixture.wallet, { blueprintHash: 'b'.repeat(64) })
    await expect(blueprintFixture.service.authorizeStart(blueprintChanged.request)).rejects.toMatchObject({ code: 'START_CHALLENGE_INVALID' })
    expect(blueprintFixture.service.getWalletDailyStatus(blueprintFixture.wallet).expeditionsStarted).toBe(0)
  })

  it('authenticates a session only for its bound run and wallet', async () => {
    const { service, keyPair, wallet } = fixture()
    const started = await signedStart(service, keyPair, wallet)
    const session = service.authenticateSession(started.result.sessionCapability)

    expect(session).toMatchObject({ runId: started.result.start.runId, wallet })
    expect(() => service.authenticateSession('not-a-session')).toThrow('INVALID_SESSION')
  })

  it('serializes concurrent duplicate starts into one run and rejects a fourth expedition', async () => {
    const { service, keyPair, wallet } = fixture()
    const challenge = await service.issueStartChallenge(wallet, 'gem-runner')
    const payload: StartExpeditionPayload = {
      version: 1,
      type: 'NIMHUNT_START_EXPEDITION',
      wallet,
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
    const duplicate = await Promise.all([service.authorizeStart(request), service.authorizeStart(request)])
    expect(new Set(duplicate.map(result => result.start.runId))).toHaveLength(1)
    expect(service.getWalletDailyStatus(wallet).expeditionsStarted).toBe(1)

    await signedStart(service, keyPair, wallet)
    await signedStart(service, keyPair, wallet)
    await expect(signedStart(service, keyPair, wallet)).rejects.toMatchObject({ code: 'DAILY_EXPEDITION_LIMIT_REACHED' })
    expect(service.getWalletDailyStatus(wallet).expeditionsStarted).toBe(3)
  })
})
