import { KeyPair } from '@nimiq/core'
import { describe, expect, it } from 'vitest'
import { parseProductVaultSeal, serializeProductVaultSeal } from '../../src/domain/productVaultSeal.ts'
import { VAULT_SEAL_TYPE, buildVaultSealPayload, serializeVaultSeal } from '../../src/domain/vaultSeal.ts'
import { hashBlueprint } from '../../src/game/replay/canonical.ts'
import { createRoom01Blueprint } from '../../src/game/world/room01.ts'
import type { Direction, MoveAction } from '../../src/game/replay/types.ts'
import { PREVALIDATED_ROOM_01_BOOTSTRAP_WINNING_SEQUENCES } from './room01BootstrapPrevalidation.ts'
import { serializeStartPayload, type StartExpeditionPayload } from './canonical.ts'
import { nimiqSignedMessageHash } from './crypto.ts'
import { dispatchExpeditionHttp, type ExpeditionHttpSecurity } from './http.ts'
import { createMemoryProofService } from './memoryProofStore.ts'
import { serializeRunSessionCookie } from './session.ts'
import { verifyTreasureSeal } from '../verifyTreasureSeal.ts'

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

async function startPlaying(
  mission: 'gem-runner' | 'chest-hunter' | 'vault-breaker',
  options: {
    readonly service?: ReturnType<typeof createMemoryProofService>
    readonly keyPair?: KeyPair
    readonly wallet?: string
    readonly blueprintId?: string
  } = {},
) {
  const keyPair = options.keyPair ?? KeyPair.generate()
  const wallet = options.wallet ?? keyPair.toAddress().toUserFriendlyAddress()
  const service = options.service ?? createMemoryProofService({
    clock: { now: () => new Date('2026-09-09T12:00:00.000Z') },
    blueprints: [publishedBlueprint(mission, options.blueprintId ?? `vault-seal-${mission}`)],
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
  return { service, keyPair, wallet, mission, authorized, cookie }
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

async function verifyVaultGameplay(mission: 'vault-breaker' | 'gem-runner' | 'chest-hunter' = 'vault-breaker') {
  const started = await startPlaying(mission)
  const run = await playSequence(
    started.service,
    started.authorized.session,
    started.authorized.start.runId,
    PREVALIDATED_ROOM_01_BOOTSTRAP_WINNING_SEQUENCES[mission],
  )
  const verified = await started.service.verifyExpedition({
    runId: run.runId,
    session: started.authorized.session,
    checkpointHash: run.checkpointHash,
  })
  return { ...started, run: started.service.getRun(run.runId)!, verified }
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

describe('run-bound product Vault seal', () => {
  it('requires VAULT_GAMEPLAY_VERIFIED before prepare', async () => {
    const started = await startPlaying('vault-breaker')
    await expect(started.service.prepareVaultSeal(started.authorized.start.runId, started.authorized.session))
      .rejects.toMatchObject({ code: 'VAULT_SEAL_REQUIRED' })
    const gem = await verifyVaultGameplay('gem-runner')
    await expect(gem.service.prepareVaultSeal(gem.authorized.start.runId, gem.authorized.session))
      .rejects.toMatchObject({ code: 'RUN_MISMATCH' })
  }, 15_000)

  it('prepares an idempotent canonical product payload bound to the frozen checkpoint', async () => {
    const ready = await verifyVaultGameplay()
    const first = await ready.service.prepareVaultSeal(ready.run.runId, ready.authorized.session)
    const second = await ready.service.prepareVaultSeal(ready.run.runId, ready.authorized.session)
    expect(first).toEqual(second)
    expect(first.runId).toBe(ready.run.runId)
    expect(first.vaultSealHash).toMatch(/^[0-9a-f]{64}$/)
    const parsed = parseProductVaultSeal(first.canonicalPayload)
    expect(parsed).toMatchObject({
      version: 1,
      type: 'NIMHUNT_VAULT_SEAL_V1',
      wallet: ready.wallet,
      runId: ready.run.runId,
      mission: 'vault-breaker',
      world: 'ANGKOR_RUINS',
      room: 'ROOM_01',
      objective: 'TEMPLE_VAULT',
      runChallenge: ready.run.runChallenge,
      rulesVersion: 'nimhunt-rules-v1',
      roomVersion: 'angkor-room-01-v1',
      blueprintVersion: 'angkor-blueprint-v1',
      blueprintId: ready.run.blueprint.blueprintId,
      blueprintHash: ready.run.blueprint.blueprintHash,
      vaultCheckpointHash: ready.run.checkpointHash,
    })
    expect(first.canonicalPayload).toBe(serializeProductVaultSeal(parsed!))
    expect(ready.service.getWalletDailyStatus(ready.wallet).expeditionsRemaining).toBe(2)
  }, 15_000)

  it('rejects wrong mission, wallet, runChallenge, blueprint, and foreign checkpoints', async () => {
    const ready = await verifyVaultGameplay()
    const prepared = await ready.service.prepareVaultSeal(ready.run.runId, ready.authorized.session)
    const parsed = parseProductVaultSeal(prepared.canonicalPayload)!
    const other = await verifyVaultGameplay()

    await expect(ready.service.verifyVaultSeal({
      session: ready.authorized.session,
      ...signPayload(ready.keyPair, prepared.canonicalPayload.replace('vault-breaker', 'gem-runner')),
    })).rejects.toMatchObject({ code: 'VAULT_SEAL_MISMATCH' })

    const wrongWallet = serializeProductVaultSeal({ ...parsed, wallet: other.wallet })
    await expect(ready.service.verifyVaultSeal({
      session: ready.authorized.session,
      ...signPayload(ready.keyPair, wrongWallet),
    })).rejects.toMatchObject({ code: 'WALLET_MISMATCH' })

    const wrongChallenge = serializeProductVaultSeal({ ...parsed, runChallenge: other.run.runChallenge })
    await expect(ready.service.verifyVaultSeal({
      session: ready.authorized.session,
      ...signPayload(ready.keyPair, wrongChallenge),
    })).rejects.toMatchObject({ code: 'VAULT_SEAL_MISMATCH' })

    const wrongBlueprint = serializeProductVaultSeal({ ...parsed, blueprintHash: 'aa'.repeat(32) })
    await expect(ready.service.verifyVaultSeal({
      session: ready.authorized.session,
      ...signPayload(ready.keyPair, wrongBlueprint),
    })).rejects.toMatchObject({ code: 'VAULT_SEAL_MISMATCH' })

    const foreignCheckpoint = serializeProductVaultSeal({ ...parsed, vaultCheckpointHash: other.run.checkpointHash })
    await expect(ready.service.verifyVaultSeal({
      session: ready.authorized.session,
      ...signPayload(ready.keyPair, foreignCheckpoint),
    })).rejects.toMatchObject({ code: 'CHECKPOINT_MISMATCH' })

    const initialCheckpoint = serializeProductVaultSeal({ ...parsed, vaultCheckpointHash: ready.run.initialCheckpointHash })
    await expect(ready.service.verifyVaultSeal({
      session: ready.authorized.session,
      ...signPayload(ready.keyPair, initialCheckpoint),
    })).rejects.toMatchObject({ code: 'CHECKPOINT_MISMATCH' })
    expect(ready.service.getRun(ready.run.runId)?.vaultSeal).toBeNull()
  }, 15_000)

  it('rejects an invalid signature but keeps the seal retryable', async () => {
    const ready = await verifyVaultGameplay()
    const prepared = await ready.service.prepareVaultSeal(ready.run.runId, ready.authorized.session)
    const signed = signPayload(ready.keyPair, prepared.canonicalPayload)
    await expect(ready.service.verifyVaultSeal({
      session: ready.authorized.session,
      payload: signed.payload,
      publicKey: signed.publicKey,
      signature: flipHex(signed.signature),
    })).rejects.toMatchObject({ code: 'INVALID_SIGNATURE' })
    expect(ready.service.getRun(ready.run.runId)?.vaultSeal).toBeNull()

    const verified = await ready.service.verifyVaultSeal({
      session: ready.authorized.session,
      ...signed,
    })
    expect(verified.runId).toBe(ready.run.runId)
    expect(verified.wallet).toBe(ready.wallet)
    expect(verified.canonicalPayload).toBe(prepared.canonicalPayload)
    expect(verified.vaultCheckpointHash).toBe(ready.run.checkpointHash)
    expect(verified.vaultSealHash).toBe(prepared.vaultSealHash)
  }, 15_000)

  it('rejects a derived address mismatch', async () => {
    const ready = await verifyVaultGameplay()
    const prepared = await ready.service.prepareVaultSeal(ready.run.runId, ready.authorized.session)
    const other = KeyPair.generate()
    await expect(ready.service.verifyVaultSeal({
      session: ready.authorized.session,
      ...signPayload(other, prepared.canonicalPayload),
    })).rejects.toMatchObject({ code: 'ADDRESS_MISMATCH' })
    expect(ready.service.getRun(ready.run.runId)?.vaultSeal).toBeNull()
  }, 15_000)

  it('verifies a valid signature, is idempotent, and cannot satisfy another run', async () => {
    const ready = await verifyVaultGameplay()
    const prepared = await ready.service.prepareVaultSeal(ready.run.runId, ready.authorized.session)
    const signed = signPayload(ready.keyPair, prepared.canonicalPayload)
    const first = await ready.service.verifyVaultSeal({ session: ready.authorized.session, ...signed })
    const retry = await ready.service.verifyVaultSeal({ session: ready.authorized.session, ...signed })
    expect(retry).toEqual(first)
    expect(ready.service.getRun(ready.run.runId)?.vaultSeal?.canonicalPayload).toBe(prepared.canonicalPayload)
    expect(ready.service.getWalletDailyStatus(ready.wallet).expeditionsRemaining).toBe(2)

    const otherKey = KeyPair.generate()
    const other = await startPlaying('vault-breaker', {
      service: ready.service,
      keyPair: otherKey,
      wallet: otherKey.toAddress().toUserFriendlyAddress(),
    })
    const otherRun = await playSequence(
      ready.service,
      other.authorized.session,
      other.authorized.start.runId,
      PREVALIDATED_ROOM_01_BOOTSTRAP_WINNING_SEQUENCES['vault-breaker'],
    )
    await ready.service.verifyExpedition({
      runId: otherRun.runId,
      session: other.authorized.session,
      checkpointHash: otherRun.checkpointHash,
    })
    await expect(ready.service.verifyVaultSeal({
      session: other.authorized.session,
      ...signed,
    })).rejects.toMatchObject({ code: 'RUN_SESSION_INVALID' })
    expect(ready.service.getRun(otherRun.runId)?.vaultSeal).toBeNull()

    const otherPrepared = await ready.service.prepareVaultSeal(otherRun.runId, other.authorized.session)
    expect(otherPrepared.canonicalPayload).not.toBe(prepared.canonicalPayload)
    await expect(ready.service.appendCheckpoint({
      runId: ready.run.runId,
      session: ready.authorized.session,
      previousCheckpointHash: ready.run.checkpointHash,
      actions: moves(ready.run.seq + 1, ['LEFT']),
    })).rejects.toMatchObject({ code: 'RUN_NOT_ACTIVE' })
  }, 15_000)

  it('does not consume another attempt or append checkpoints after Vault gameplay is frozen', async () => {
    const ready = await verifyVaultGameplay()
    expect(ready.service.getWalletDailyStatus(ready.wallet).expeditionsRemaining).toBe(2)
    const before = ready.service.getRun(ready.run.runId)!
    await expect(ready.service.appendCheckpoint({
      runId: before.runId,
      session: ready.authorized.session,
      previousCheckpointHash: before.checkpointHash,
      actions: moves(before.seq + 1, ['LEFT']),
    })).rejects.toMatchObject({ code: 'RUN_NOT_ACTIVE' })
    const prepared = await ready.service.prepareVaultSeal(before.runId, ready.authorized.session)
    await ready.service.verifyVaultSeal({
      session: ready.authorized.session,
      ...signPayload(ready.keyPair, prepared.canonicalPayload),
    })
    const after = ready.service.getRun(before.runId)!
    expect(after.seq).toBe(before.seq)
    expect(after.checkpointHash).toBe(before.checkpointHash)
    expect(after.batches).toHaveLength(before.batches.length)
    expect(after.terminal?.type).toBe('VERIFIED')
    if (after.terminal?.type !== 'VERIFIED') throw new Error('TERMINAL_MISSING')
    expect(after.terminal.result.outcome).toBe('VAULT_GAMEPLAY_VERIFIED')
    expect(ready.service.getWalletDailyStatus(ready.wallet).expeditionsRemaining).toBe(2)
  }, 15_000)

  it('serves authenticated prepare/verify HTTP without broadening the preview verifier', async () => {
    const ready = await verifyVaultGameplay()
    const prepared = await dispatchExpeditionHttp(ready.service, {
      method: 'POST',
      path: '/api/expeditions/vault-seal/prepare',
      headers: headers(ready.cookie),
      body: { runId: ready.run.runId },
    }, SECURITY)
    expect(prepared.status).toBe(200)
    const preparedBody = prepared.body as { ok: true; canonicalPayload: string; vaultSealHash: string }
    expect(preparedBody.canonicalPayload).toContain('NIMHUNT_VAULT_SEAL_V1')

    const signed = signPayload(ready.keyPair, preparedBody.canonicalPayload)
    const verified = await dispatchExpeditionHttp(ready.service, {
      method: 'POST',
      path: '/api/expeditions/vault-seal/verify',
      headers: headers(ready.cookie),
      body: signed,
    }, SECURITY)
    expect(verified.status).toBe(200)
    expect(verified.body).toMatchObject({
      ok: true,
      runId: ready.run.runId,
      wallet: ready.wallet,
      vaultSealHash: preparedBody.vaultSealHash,
    })

    const preview = verifyTreasureSeal({
      payload: preparedBody.canonicalPayload,
      wallet: ready.wallet,
      publicKey: signed.publicKey,
      signature: signed.signature,
    })
    expect(preview.valid).toBe(false)
    expect(preview.reason).toBe('UNSUPPORTED_MESSAGE_TYPE')
    expect(VAULT_SEAL_TYPE).toBe('NIMHUNT_VAULT_SEAL_PREVIEW')
    expect(serializeVaultSeal(buildVaultSealPayload(ready.wallet))).toContain('NIMHUNT_VAULT_SEAL_PREVIEW')
  }, 15_000)
})
