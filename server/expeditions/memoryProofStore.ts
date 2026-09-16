import { randomBytes, randomUUID } from 'node:crypto'
import { DAILY_EXPEDITION_LIMIT, DAILY_REWARD_SLOTS } from '../../src/domain/dailyLedger.ts'
import { parseProductVaultSeal } from '../../src/domain/productVaultSeal.ts'
import type {
  ProductActiveExpedition,
  ProductGameplayStartResponse,
  StartResult,
} from '../../src/domain/expeditionProof.ts'
import { hashBlueprint, hashReplayState, hashTranscript } from '../../src/game/replay/canonical.ts'
import { createInitialRun } from '../../src/game/replay/engine.ts'
import { TRANSCRIPT_VERSION } from '../../src/game/replay/versions.ts'
import type {
  ExpeditionBlueprint,
  ExpeditionTranscript,
} from '../../src/game/replay/types.ts'
import { createInitialCheckpoint, isRecoverableInitialRun } from './runProof.ts'
import { validateExpeditionBlueprint } from '../../src/game/replay/validator.ts'
import { applyCheckpointBatch } from './checkpoint.ts'
import { prepareProductVaultSeal, verifyProductVaultSeal } from './vaultSeal.ts'
import { abandonExpeditionRun, verifyExpeditionRun } from './verify.ts'
import { ProofError } from './errors.ts'
import { isPrevalidatedRoom01Bootstrap } from './room01BootstrapPrevalidation.ts'
import {
  fingerprintStartAuthorization,
  hashChallenge,
  parseStartPayload,
} from './canonical.ts'
import { verifyNimiqSignedCanonicalMessage } from './crypto.ts'
import {
  createRunSessionCapability,
  hashRunSessionCapability,
  requireRunSession,
  type RunSessionRecord,
} from './session.ts'
import {
  createPreparedRewardClaim,
  toFinalizeResult,
  toPrepareResult,
  verifySignedRewardClaim,
} from './rewardClaim.ts'
import type {
  Clock,
  DurableExpeditionRun,
  DurableRewardClaim,
  DurableRunTerminal,
  DurableStartChallenge,
  DurableVaultSealProof,
  MemoryProofService,
  MemoryProofSnapshot,
  StartAuthorizationResult,
} from './types.ts'
import { nextUtcResetAt, utcDayKey } from '../ledger/utcDay.ts'
import { normalizeNimiqWallet } from '../ledger/wallet.ts'

const validatedBlueprintHashes = new Set<string>()
let publicationValidationRuns = 0
let publicationValidationCacheHits = 0
let publicationValidationPrevalidatedHits = 0

export function publicationValidationStats(): {
  readonly runs: number
  readonly cacheHits: number
  readonly prevalidatedHits: number
  readonly cachedHashes: number
} {
  return {
    runs: publicationValidationRuns,
    cacheHits: publicationValidationCacheHits,
    prevalidatedHits: publicationValidationPrevalidatedHits,
    cachedHashes: validatedBlueprintHashes.size,
  }
}

class AsyncMutex {
  private tail: Promise<void> = Promise.resolve()

  run<T>(fn: () => T | Promise<T>): Promise<T> {
    const current = this.tail.then(fn, fn)
    this.tail = current.then(() => undefined, () => undefined)
    return current
  }
}

export function createMemoryProofService(options: {
  readonly clock?: Clock
  readonly blueprints?: readonly ExpeditionBlueprint[]
} = {}): MemoryProofService {
  const clock = options.clock ?? { now: () => new Date() }
  const mutex = new AsyncMutex()
  const blueprints = new Map<string, ExpeditionBlueprint>()
  const challenges = new Map<string, DurableStartChallenge>()
  const runs = new Map<string, DurableExpeditionRun>()
  const sessions = new Map<string, RunSessionRecord>()
  const attempts = new Map<string, number>()
  const reservedSlots = new Map<string, number>()
  const walletRewards = new Map<string, number>()
  const claims = new Map<string, DurableRewardClaim>()
  const claimsByRun = new Map<string, string>()

  const service: MemoryProofService = {
    registerBlueprint(blueprint) {
      const existing = blueprints.get(blueprint.blueprintId)
      if (existing && isPublishedOrRetired(existing)) {
        if (blueprintFingerprint(existing) !== blueprintFingerprint(blueprint)) throw new ProofError('BLUEPRINT_IMMUTABLE')
        return
      }
      if (blueprint.status === 'PUBLISHED') {
        validateForPublication(blueprint)
        ensureNoOtherPublished(blueprint)
      }
      if (blueprint.status === 'RETIRED' && (!existing || existing.status !== 'PUBLISHED')) {
        throw new ProofError('BLUEPRINT_LIFECYCLE_INVALID')
      }
      blueprints.set(blueprint.blueprintId, cloneBlueprint(blueprint))
    },

    publishBlueprint(blueprintId) {
      const current = getBlueprint(blueprintId)
      if (current.status !== 'VALIDATED') throw new ProofError('BLUEPRINT_LIFECYCLE_INVALID')
      validateForPublication(current)
      ensureNoOtherPublished(current)
      blueprints.set(blueprintId, { ...cloneBlueprint(current), status: 'PUBLISHED' })
    },

    retireBlueprint(blueprintId) {
      const current = getBlueprint(blueprintId)
      if (current.status !== 'PUBLISHED') throw new ProofError('BLUEPRINT_LIFECYCLE_INVALID')
      blueprints.set(blueprintId, { ...cloneBlueprint(current), status: 'RETIRED' })
    },

    getPublishedBlueprint(dayKey, mission) {
      const blueprint = [...blueprints.values()].find(candidate =>
        candidate.status === 'PUBLISHED' && candidate.dayKey === dayKey && candidate.mission === mission,
      )
      return blueprint ? cloneBlueprint(blueprint) : null
    },

    async issueStartChallenge(wallet, mission) {
      let normalizedWallet: string
      try {
        normalizedWallet = normalizeNimiqWallet(wallet)
      } catch {
        throw new ProofError('INVALID_WALLET')
      }
      const now = clock.now()
      const dayKey = utcDayKey(now)
      const blueprint = service.getPublishedBlueprint(dayKey, mission)
      if (!blueprint) throw new ProofError('DAILY_BLUEPRINT_UNAVAILABLE')

      const challenge = randomBytes(32).toString('base64url')
      const challengeHash = hashChallenge(challenge)
      const nextResetAt = nextUtcResetAt(dayKey)
      const fiveMinuteExpiry = new Date(now.getTime() + 5 * 60 * 1_000)
      const resetAt = new Date(nextResetAt)
      const expiresAt = fiveMinuteExpiry.getTime() < resetAt.getTime() ? fiveMinuteExpiry : resetAt
      challenges.set(challengeHash, {
        challengeHash,
        wallet: normalizedWallet,
        mission,
        dayKey,
        blueprintId: blueprint.blueprintId,
        blueprintHash: blueprint.blueprintHash,
        createdAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
        consumedAt: null,
        runId: null,
        authorizationFingerprint: null,
        response: null,
      })
      return {
        wallet: normalizedWallet,
        challenge,
        blueprintId: blueprint.blueprintId,
        blueprintHash: blueprint.blueprintHash,
        dayKey,
        expiresAt: expiresAt.toISOString(),
      }
    },

    authorizeStart(input) {
      const parsed = parseStartPayload(input.payload)
      if (!parsed) return Promise.reject(new ProofError('START_CHALLENGE_INVALID'))

      const verification = verifyNimiqSignedCanonicalMessage({
        payload: input.payload,
        wallet: parsed.wallet,
        payloadWallet: parsed.wallet,
        publicKey: input.publicKey,
        signature: input.signature,
      })
      if (verification.reason === 'INVALID_SIGNATURE') return Promise.reject(new ProofError('INVALID_SIGNATURE'))
      if (!verification.valid) return Promise.reject(new ProofError('START_CHALLENGE_INVALID'))

      const fingerprint = fingerprintStartAuthorization(input)
      return mutex.run(() => authorizeWithinLock(parsed, fingerprint))
    },

    getRun(runId) {
      const run = runs.get(runId)
      return run ? cloneRun(run) : null
    },

    getWalletDailyStatus(wallet) {
      const normalizedWallet = normalizeNimiqWallet(wallet)
      const dayKey = utcDayKey(clock.now())
      const expeditionsStarted = attempts.get(walletKey(dayKey, normalizedWallet)) ?? 0
      return {
        dayKey,
        expeditionsStarted,
        expeditionsRemaining: DAILY_EXPEDITION_LIMIT - expeditionsStarted,
        rewardAlreadyReserved: (walletRewards.get(walletKey(dayKey, normalizedWallet)) ?? 0) >= 1,
        nextResetAt: nextUtcResetAt(dayKey),
      }
    },

    snapshot() {
      return {
        blueprints: [...blueprints.values()].map(cloneBlueprint),
        challenges: [...challenges.values()].map(cloneChallenge),
        runs: [...runs.values()].map(cloneRun),
        sessions: [...sessions.values()].map(session => ({ ...session })),
      } satisfies MemoryProofSnapshot
    },

    authenticateSession(raw) {
      const hash = hashRunSessionCapability(raw)
      const record = sessions.get(hash)
      try {
        return requireRunSession(raw, record ?? null, clock.now())
      } catch (error) {
        if (error instanceof Error && (error.message === 'INVALID_SESSION' || error.message === 'SESSION_EXPIRED' || error.message === 'SESSION_REVOKED')) {
          throw new ProofError(error.message)
        }
        throw error
      }
    },

    getActiveExpedition(runId, session) {
      const { run, now } = requireAuthenticatedRun(runId, session)
      if (run.gameplayStartedAt || run.status !== 'STARTED' || now.getTime() >= new Date(run.expiresAt).getTime()) {
        throw new ProofError('ACTIVE_RUN_UNAVAILABLE')
      }
      if (!isRecoverableInitialRun(run)) throw new ProofError('ACTIVE_RUN_UNAVAILABLE')

      return {
        runId: run.runId,
        dayKey: run.dayKey,
        mission: run.mission,
        status: run.status,
        startedAt: run.startedAt,
        expiresAt: run.expiresAt,
        gameplayStartedAt: run.gameplayStartedAt,
        rulesVersion: run.blueprint.rulesVersion,
        roomVersion: run.blueprint.roomVersion,
        blueprintVersion: run.blueprint.blueprintVersion,
        blueprintId: run.blueprint.blueprintId,
        blueprintHash: run.blueprint.blueprintHash,
        blueprint: cloneBlueprint(run.blueprint),
        state: cloneReplayState(run.state),
        checkpoint: { ...run.checkpoint },
      } satisfies ProductActiveExpedition
    },

    markGameplayStarted(runId, session) {
      const { run, now } = requireAuthenticatedRun(runId, session)
      if (run.status !== 'STARTED' || now.getTime() >= new Date(run.expiresAt).getTime()) {
        throw new ProofError('RUN_SESSION_INVALID')
      }
      if (run.gameplayStartedAt) return { runId, outcome: 'GAMEPLAY_ALREADY_STARTED' } satisfies ProductGameplayStartResponse
      if (!isRecoverableInitialRun(run)) throw new ProofError('ACTIVE_RUN_UNAVAILABLE')

      runs.set(runId, { ...run, gameplayStartedAt: now.toISOString() })
      return { runId, outcome: 'GAMEPLAY_STARTED' } satisfies ProductGameplayStartResponse
    },

    appendCheckpoint(input) {
      return mutex.run(() => {
        const { run, now } = requireAuthenticatedRun(input.runId, input.session)
        if (!run.gameplayStartedAt || run.status !== 'STARTED' || run.terminal || now.getTime() >= new Date(run.expiresAt).getTime()) {
          throw new ProofError('RUN_NOT_ACTIVE')
        }
        const result = applyCheckpointBatch(run, {
          previousCheckpointHash: input.previousCheckpointHash,
          actions: input.actions,
        })
        runs.set(input.runId, result.run)
        return result.acknowledgement
      })
    },

    verifyExpedition(input) {
      return mutex.run(() => {
        const { run, now } = requireAuthenticatedRun(input.runId, input.session)
        if (now.getTime() >= new Date(run.expiresAt).getTime() && !run.terminal) {
          throw new ProofError('RUN_NOT_ACTIVE')
        }
        const result = verifyExpeditionRun(run, { checkpointHash: input.checkpointHash, now })
        runs.set(input.runId, result.run)
        return result.result
      })
    },

    abandonExpedition(input) {
      return mutex.run(() => {
        const { run, now } = requireAuthenticatedRun(input.runId, input.session)
        if (now.getTime() >= new Date(run.expiresAt).getTime() && !run.terminal) {
          throw new ProofError('RUN_NOT_ACTIVE')
        }
        const result = abandonExpeditionRun(run, { checkpointHash: input.checkpointHash, now })
        runs.set(input.runId, result.run)
        return result.result
      })
    },

    prepareVaultSeal(runId, session) {
      return mutex.run(() => {
        const { run } = requireAuthenticatedRun(runId, session)
        return prepareProductVaultSeal(run)
      })
    },

    verifyVaultSeal(input) {
      return mutex.run(() => {
        const parsed = parseProductVaultSeal(input.payload)
        if (!parsed) throw new ProofError('VAULT_SEAL_MISMATCH')
        const { run, now } = requireAuthenticatedRun(parsed.runId, input.session)
        const result = verifyProductVaultSeal(run, {
          payload: input.payload,
          publicKey: input.publicKey,
          signature: input.signature,
          now,
        })
        runs.set(run.runId, result.run)
        return result.result
      })
    },

    prepareRewardClaim(runId, session) {
      return mutex.run(() => {
        const { run, now } = requireAuthenticatedRun(runId, session)
        const existingId = claimsByRun.get(runId)
        if (existingId) {
          const existing = claims.get(existingId)
          if (!existing) throw new ProofError('CLAIM_NOT_FOUND')
          if (existing.status === 'PREPARED' && now.getTime() >= new Date(existing.expiresAt).getTime()) {
            claims.set(existing.claimId, { ...existing, status: 'EXPIRED' })
            throw new ProofError('CLAIM_WINDOW_EXPIRED')
          }
          return toPrepareResult(existing)
        }
        const prepared = createPreparedRewardClaim(run, now)
        const already = (walletRewards.get(walletKey(run.dayKey, run.wallet)) ?? 0) >= 1
        const soldOut = (reservedSlots.get(run.dayKey) ?? 0) >= DAILY_REWARD_SLOTS
        const claim: DurableRewardClaim = already
          ? { ...prepared, status: 'ALREADY_REWARDED', finalizedAt: now.toISOString() }
          : soldOut
            ? { ...prepared, status: 'SOLD_OUT', finalizedAt: now.toISOString() }
            : prepared
        claims.set(claim.claimId, claim)
        claimsByRun.set(run.runId, claim.claimId)
        return toPrepareResult(claim)
      })
    },

    finalizeRewardClaim(input) {
      return mutex.run(() => {
        const stored = claims.get(input.claimId)
        if (!stored) throw new ProofError('CLAIM_NOT_FOUND')
        const { run, now } = requireAuthenticatedRun(stored.runId, input.session)
        if (stored.status === 'RESERVED' || stored.status === 'SOLD_OUT' || stored.status === 'ALREADY_REWARDED') {
          if (stored.canonicalPayload !== input.payload) throw new ProofError('CLAIM_MISMATCH')
          return toFinalizeResult(stored, {
            remainingSlots: DAILY_REWARD_SLOTS - (reservedSlots.get(run.dayKey) ?? 0),
            reservationNumber: stored.reservationNumber,
          })
        }
        verifySignedRewardClaim(run, stored, {
          claimId: input.claimId,
          payload: input.payload,
          publicKey: input.publicKey,
          signature: input.signature,
          now,
        })
        const walletKeyName = walletKey(run.dayKey, run.wallet)
        const already = (walletRewards.get(walletKeyName) ?? 0) >= 1
        if (already) {
          const claim: DurableRewardClaim = {
            ...stored,
            status: 'ALREADY_REWARDED',
            publicKey: input.publicKey,
            signature: input.signature,
            finalizedAt: now.toISOString(),
          }
          claims.set(claim.claimId, claim)
          return toFinalizeResult(claim, {
            remainingSlots: DAILY_REWARD_SLOTS - (reservedSlots.get(run.dayKey) ?? 0),
            reservationNumber: null,
          })
        }
        const current = reservedSlots.get(run.dayKey) ?? 0
        if (current >= DAILY_REWARD_SLOTS) {
          const claim: DurableRewardClaim = {
            ...stored,
            status: 'SOLD_OUT',
            publicKey: input.publicKey,
            signature: input.signature,
            finalizedAt: now.toISOString(),
          }
          claims.set(claim.claimId, claim)
          return toFinalizeResult(claim, { remainingSlots: 0, reservationNumber: null })
        }
        const reservationNumber = current + 1
        reservedSlots.set(run.dayKey, reservationNumber)
        walletRewards.set(walletKeyName, 1)
        const claim: DurableRewardClaim = {
          ...stored,
          status: 'RESERVED',
          publicKey: input.publicKey,
          signature: input.signature,
          finalizedAt: now.toISOString(),
          reservationNumber,
        }
        claims.set(claim.claimId, claim)
        return toFinalizeResult(claim, {
          remainingSlots: DAILY_REWARD_SLOTS - reservationNumber,
          reservationNumber,
        })
      })
    },

    getRewardClaim(claimId, session) {
      requireAuthenticatedRun(session.runId, session)
      const claim = claims.get(claimId)
      if (!claim || claim.runId !== session.runId) throw new ProofError('CLAIM_NOT_FOUND')
      return claim
    },

    getReservedRewardClaim(session) {
      requireAuthenticatedRun(session.runId, session)
      for (const claim of claims.values()) {
        if (claim.runId === session.runId && claim.status === 'RESERVED') return claim
      }
      return null
    },
  }

  for (const blueprint of options.blueprints ?? []) service.registerBlueprint(blueprint)

  return service

  function authorizeWithinLock(
    payload: NonNullable<ReturnType<typeof parseStartPayload>>,
    fingerprint: string,
  ): StartAuthorizationResult {
    const challengeHash = hashChallenge(payload.challenge)
    const challenge = challenges.get(challengeHash)
    if (!challenge) throw new ProofError('START_CHALLENGE_INVALID')

    if (challenge.consumedAt) {
      if (challenge.authorizationFingerprint !== fingerprint || !challenge.response || !challenge.runId) {
        throw new ProofError('START_CHALLENGE_INVALID')
      }
      const run = runs.get(challenge.runId)
      if (!run) throw new ProofError('START_CHALLENGE_INVALID')
      return issueSession(run, challenge.response, 'START_ALREADY_CREATED')
    }

    const now = clock.now()
    if (utcDayKey(now) !== challenge.dayKey) throw new ProofError('START_CHALLENGE_DAY_EXPIRED')
    if (now.getTime() >= new Date(challenge.expiresAt).getTime()) throw new ProofError('START_CHALLENGE_EXPIRED')
    if (payload.wallet !== challenge.wallet
      || payload.mission !== challenge.mission
      || payload.dayKey !== challenge.dayKey
      || payload.blueprintId !== challenge.blueprintId
      || payload.blueprintHash !== challenge.blueprintHash) {
      throw new ProofError('START_CHALLENGE_INVALID')
    }

    const blueprint = service.getPublishedBlueprint(challenge.dayKey, challenge.mission)
    if (!blueprint
      || blueprint.blueprintId !== challenge.blueprintId
      || blueprint.blueprintHash !== challenge.blueprintHash) {
      throw new ProofError('START_CHALLENGE_INVALID')
    }

    const key = walletKey(challenge.dayKey, challenge.wallet)
    const attemptsUsed = attempts.get(key) ?? 0
    if (attemptsUsed >= DAILY_EXPEDITION_LIMIT) throw new ProofError('DAILY_EXPEDITION_LIMIT_REACHED')

    const runId = randomUUID()
    const runChallenge = randomBytes(32).toString('hex')
    const initialState = createInitialRun({
      mission: blueprint.mission,
      rulesVersion: blueprint.rulesVersion,
      roomVersion: blueprint.roomVersion,
      blueprint,
    })
    const transcript: ExpeditionTranscript = {
      version: TRANSCRIPT_VERSION,
      runId,
      wallet: challenge.wallet,
      mission: challenge.mission,
      rulesVersion: blueprint.rulesVersion,
      roomVersion: blueprint.roomVersion,
      blueprintVersion: blueprint.blueprintVersion,
      blueprintId: blueprint.blueprintId,
      blueprintHash: blueprint.blueprintHash,
      actions: [],
    }
    const initialStateHash = hashReplayState(initialState)
    const initialTranscriptHash = hashTranscript(transcript)
    const checkpoint = createInitialCheckpoint(runId, runChallenge, initialStateHash, initialTranscriptHash)
    const nextResetAt = nextUtcResetAt(challenge.dayKey)
    const run: DurableExpeditionRun = {
      runId,
      dayKey: challenge.dayKey,
      wallet: challenge.wallet,
      mission: challenge.mission,
      status: 'STARTED',
      rewardStatus: 'NONE',
      startedAt: now.toISOString(),
      expiresAt: nextResetAt,
      gameplayStartedAt: null,
      runChallenge,
      blueprint: cloneBlueprint(blueprint),
      state: initialState,
      checkpoint,
      initialStateHash,
      initialTranscriptHash,
      initialCheckpointHash: checkpoint.checkpointHash,
      checkpointHash: checkpoint.checkpointHash,
      seq: 0,
      actions: [],
      batches: [],
      terminal: null,
      vaultSeal: null,
    }
    const start: StartResult = {
      runId,
      runChallenge,
      attemptsRemaining: DAILY_EXPEDITION_LIMIT - attemptsUsed - 1,
      rulesVersion: blueprint.rulesVersion,
      roomVersion: blueprint.roomVersion,
      blueprintVersion: blueprint.blueprintVersion,
      blueprintId: blueprint.blueprintId,
      blueprintHash: blueprint.blueprintHash,
      blueprint: cloneBlueprint(blueprint),
      dayKey: challenge.dayKey,
      nextResetAt,
    }
    const session = createSession(runId, challenge.wallet, now, new Date(nextResetAt))
    const consumed: DurableStartChallenge = {
      ...challenge,
      consumedAt: now.toISOString(),
      runId,
      authorizationFingerprint: fingerprint,
      response: start,
    }

    attempts.set(key, attemptsUsed + 1)
    runs.set(runId, run)
    sessions.set(session.record.sessionHash, session.record)
    challenges.set(challengeHash, consumed)
    return {
      outcome: 'START_CREATED',
      start,
      sessionCapability: session.raw,
      session: session.record,
    }
  }

  function issueSession(run: DurableExpeditionRun, start: StartResult, outcome: StartAuthorizationResult['outcome']): StartAuthorizationResult {
    const session = createSession(run.runId, run.wallet, clock.now(), new Date(run.expiresAt))
    sessions.set(session.record.sessionHash, session.record)
    return { outcome, start, sessionCapability: session.raw, session: session.record }
  }

  function createSession(runId: string, wallet: string, createdAt: Date, expiresAt: Date): { raw: string; record: RunSessionRecord } {
    const capability = createRunSessionCapability()
    const record: RunSessionRecord = {
      sessionHash: hashRunSessionCapability(capability.raw),
      runId,
      wallet,
      createdAt: createdAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      revokedAt: null,
    }
    return { raw: capability.raw, record }
  }

  function getBlueprint(blueprintId: string): ExpeditionBlueprint {
    const blueprint = blueprints.get(blueprintId)
    if (!blueprint) throw new ProofError('BLUEPRINT_INVALID')
    return blueprint
  }

  function ensureNoOtherPublished(blueprint: ExpeditionBlueprint): void {
    const existing = [...blueprints.values()].find(candidate =>
      candidate.blueprintId !== blueprint.blueprintId
      && candidate.status === 'PUBLISHED'
      && candidate.dayKey === blueprint.dayKey
      && candidate.mission === blueprint.mission,
    )
    if (existing) throw new ProofError('BLUEPRINT_ALREADY_PUBLISHED')
  }

  function requireAuthenticatedRun(runId: string, session: RunSessionRecord): { run: DurableExpeditionRun; now: Date } {
    const now = clock.now()
    const storedSession = sessions.get(session.sessionHash)
    const run = runs.get(runId)
    if (!storedSession
      || storedSession.runId !== runId
      || storedSession.runId !== session.runId
      || storedSession.wallet !== session.wallet
      || storedSession.revokedAt
      || now.getTime() >= new Date(storedSession.expiresAt).getTime()
      || !run
      || run.runId !== storedSession.runId
      || run.wallet !== storedSession.wallet) {
      throw new ProofError('RUN_SESSION_INVALID')
    }
    return { run, now }
  }
}

function validateForPublication(blueprint: ExpeditionBlueprint): void {
  const expectedHash = hashBlueprint(blueprint)
  if (blueprint.blueprintHash !== expectedHash) throw new ProofError('BLUEPRINT_INVALID')
  if (validatedBlueprintHashes.has(expectedHash)) {
    publicationValidationCacheHits += 1
    return
  }
  if (isPrevalidatedRoom01Bootstrap(blueprint)) {
    publicationValidationPrevalidatedHits += 1
    validatedBlueprintHashes.add(expectedHash)
    return
  }
  publicationValidationRuns += 1
  if (!validateExpeditionBlueprint(blueprint).valid) throw new ProofError('BLUEPRINT_INVALID')
  validatedBlueprintHashes.add(expectedHash)
}

function isPublishedOrRetired(blueprint: ExpeditionBlueprint): boolean {
  return blueprint.status === 'PUBLISHED' || blueprint.status === 'RETIRED'
}

function blueprintFingerprint(blueprint: ExpeditionBlueprint): string {
  return JSON.stringify({
    rulesVersion: blueprint.rulesVersion,
    roomVersion: blueprint.roomVersion,
    blueprintVersion: blueprint.blueprintVersion,
    dayKey: blueprint.dayKey,
    mission: blueprint.mission,
    blueprintId: blueprint.blueprintId,
    blueprintHash: blueprint.blueprintHash,
    spawn: blueprint.spawn,
    goblins: blueprint.goblins,
    gems: blueprint.gems,
    chests: blueprint.chests,
    sword: blueprint.sword,
    potion: blueprint.potion,
    hazards: blueprint.hazards,
    boulders: blueprint.boulders,
    key: blueprint.key,
    gate: blueprint.gate,
    objective: blueprint.objective,
    missionParameters: blueprint.missionParameters,
    timedHazards: blueprint.timedHazards,
  })
}

function walletKey(dayKey: string, wallet: string): string {
  return `${dayKey}:${wallet}`
}

function cloneBlueprint(blueprint: ExpeditionBlueprint): ExpeditionBlueprint {
  return JSON.parse(JSON.stringify(blueprint)) as ExpeditionBlueprint
}

function cloneChallenge(challenge: DurableStartChallenge): DurableStartChallenge {
  return challenge.response ? { ...challenge, response: cloneStart(challenge.response) } : { ...challenge }
}

function cloneRun(run: DurableExpeditionRun): DurableExpeditionRun {
  return {
    ...run,
    blueprint: cloneBlueprint(run.blueprint),
    state: JSON.parse(JSON.stringify(run.state)) as DurableExpeditionRun['state'],
    checkpoint: { ...run.checkpoint },
    actions: run.actions.map(action => ({ ...action })),
    batches: run.batches.map(batch => ({
      ...batch,
      actions: batch.actions.map(action => ({ ...action })),
      acknowledgement: { ...batch.acknowledgement },
    })),
    terminal: cloneTerminal(run.terminal),
    vaultSeal: cloneVaultSeal(run.vaultSeal),
  }
}

function cloneVaultSeal(proof: DurableVaultSealProof | null): DurableVaultSealProof | null {
  return proof ? { ...proof } : null
}

function cloneTerminal(terminal: DurableRunTerminal | null): DurableRunTerminal | null {
  if (!terminal) return null
  if (terminal.type === 'VERIFIED') return { type: 'VERIFIED', result: { ...terminal.result } }
  return { type: 'ABANDONED', result: { ...terminal.result } }
}

function cloneReplayState(state: DurableExpeditionRun['state']): DurableExpeditionRun['state'] {
  return JSON.parse(JSON.stringify(state)) as DurableExpeditionRun['state']
}

function cloneStart(start: StartResult): StartResult {
  return { ...start, blueprint: cloneBlueprint(start.blueprint) }
}
