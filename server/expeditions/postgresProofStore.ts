import { randomBytes, randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { parseProductVaultSeal } from '../../src/domain/productVaultSeal.ts'
import type {
  CheckpointAcknowledgement,
  ProductActiveExpedition,
  ProductGameplayStartResponse,
  StartChallengeResponse,
  StartResult,
  VerifyExpeditionResult,
} from '../../src/domain/expeditionProof.ts'
import { hashBlueprint, hashReplayState, hashTranscript } from '../../src/game/replay/canonical.ts'
import { createInitialRun } from '../../src/game/replay/engine.ts'
import { CHECKPOINT_VERSION, TRANSCRIPT_VERSION } from '../../src/game/replay/versions.ts'
import type {
  ExpeditionBlueprint,
  ExpeditionCheckpoint,
  ExpeditionTranscript,
  MissionType,
  MoveAction,
  ReplayState,
} from '../../src/game/replay/types.ts'
import { applyCheckpointBatch } from './checkpoint.ts'
import {
  fingerprintStartAuthorization,
  hashChallenge,
  parseStartPayload,
} from './canonical.ts'
import { verifyNimiqSignedCanonicalMessage } from './crypto.ts'
import { ProofError } from './errors.ts'
import { createSupabaseProofRpcClient, readProofRpc, type ProofRpcClient } from './proofDb.ts'
import { createInitialCheckpoint, isRecoverableInitialRun } from './runProof.ts'
import {
  createRunSessionCapability,
  hashRunSessionCapability,
  requireRunSession,
  type RunSessionRecord,
} from './session.ts'
import type {
  DurableCheckpointBatch,
  DurableExpeditionRun,
  DurableRewardClaim,
  DurableRunStatus,
  DurableRewardStatus,
  DurableRunTerminal,
  DurableStartChallenge,
  DurableVaultSealProof,
  MemoryProofSnapshot,
  ProofService,
  StartAuthorizationResult,
} from './types.ts'
import {
  createPreparedRewardClaim,
  toFinalizeResult,
  toPrepareResult,
  verifySignedRewardClaim,
} from './rewardClaim.ts'
import { prepareProductVaultSeal, verifyProductVaultSeal } from './vaultSeal.ts'
import { abandonExpeditionRun, verifyExpeditionRun } from './verify.ts'
import { nextUtcResetAt, utcDayKey } from '../ledger/utcDay.ts'
import { normalizeNimiqWallet } from '../ledger/wallet.ts'

export async function createPostgresProofService(options: {
  readonly rpc: ProofRpcClient
  readonly blueprints?: readonly ExpeditionBlueprint[]
}): Promise<ProofService> {
  const rpc = options.rpc
  const service: ProofService = {
    async registerBlueprint(blueprint) {
      if (blueprint.status !== 'PUBLISHED') throw new ProofError('BLUEPRINT_LIFECYCLE_INVALID')
      const expectedHash = hashBlueprint(blueprint)
      if (blueprint.blueprintHash !== expectedHash) throw new ProofError('BLUEPRINT_INVALID')
      readProofRpc(await rpc.rpc('register_published_blueprint', {
        p_day_key: blueprint.dayKey,
        p_mission_type: blueprint.mission,
        p_rules_version: blueprint.rulesVersion,
        p_room_version: blueprint.roomVersion,
        p_blueprint_version: blueprint.blueprintVersion,
        p_blueprint_id: blueprint.blueprintId,
        p_blueprint_hash: blueprint.blueprintHash,
        p_canonical_blueprint: blueprint,
      }))
    },

    async publishBlueprint() {
      throw new ProofError('BLUEPRINT_LIFECYCLE_INVALID')
    },

    async retireBlueprint() {
      throw new ProofError('BLUEPRINT_LIFECYCLE_INVALID')
    },

    async getPublishedBlueprint(dayKey, mission) {
      const payload = await rpc.rpc('get_published_blueprint', {
        p_day_key: dayKey,
        p_mission_type: mission,
      })
      if (typeof payload === 'object' && payload !== null && 'ok' in payload && payload.ok === false) return null
      const result = readProofRpc(payload)
      return asBlueprint(result.blueprint)
    },

    async issueStartChallenge(wallet, mission) {
      let normalizedWallet: string
      try {
        normalizedWallet = normalizeNimiqWallet(wallet)
      } catch {
        throw new ProofError('INVALID_WALLET')
      }
      const dayKey = utcDayKey(new Date())
      const published = await service.getPublishedBlueprint(dayKey, mission)
      if (!published) throw new ProofError('DAILY_BLUEPRINT_UNAVAILABLE')

      const challenge = randomBytes(32).toString('base64url')
      const created = readProofRpc(await rpc.rpc('create_start_challenge', {
        p_wallet: normalizedWallet,
        p_mission_type: mission,
        p_challenge_hash: hashChallenge(challenge),
        p_blueprint_id: published.blueprintId,
        p_blueprint_hash: published.blueprintHash,
      }))
      return {
        wallet: normalizedWallet,
        challenge,
        blueprintId: asString(created.blueprint_id),
        blueprintHash: asString(created.blueprint_hash),
        dayKey: asDayKey(created.day_key),
        expiresAt: asIso(created.expires_at),
      } satisfies StartChallengeResponse
    },

    async authorizeStart(input) {
      const parsed = parseStartPayload(input.payload)
      if (!parsed) throw new ProofError('START_CHALLENGE_INVALID')

      const verification = verifyNimiqSignedCanonicalMessage({
        payload: input.payload,
        wallet: parsed.wallet,
        payloadWallet: parsed.wallet,
        publicKey: input.publicKey,
        signature: input.signature,
      })
      if (verification.reason === 'INVALID_SIGNATURE') throw new ProofError('INVALID_SIGNATURE')
      if (!verification.valid) throw new ProofError('START_CHALLENGE_INVALID')

      const fingerprint = fingerprintStartAuthorization(input)
      const published = await service.getPublishedBlueprint(parsed.dayKey, parsed.mission)
      const canCreate = Boolean(
        published
        && published.blueprintId === parsed.blueprintId
        && published.blueprintHash === parsed.blueprintHash,
      )

      const runId = randomUUID()
      const runChallenge = randomBytes(32).toString('hex')
      const dummyHash = '0'.repeat(64)
      const initialState = canCreate && published
        ? createInitialRun({
          mission: published.mission,
          rulesVersion: published.rulesVersion,
          roomVersion: published.roomVersion,
          blueprint: published,
        })
        : { seq: 0 }
      const transcript: ExpeditionTranscript | null = canCreate && published
        ? {
          version: TRANSCRIPT_VERSION,
          runId,
          wallet: parsed.wallet,
          mission: parsed.mission,
          rulesVersion: published.rulesVersion,
          roomVersion: published.roomVersion,
          blueprintVersion: published.blueprintVersion,
          blueprintId: published.blueprintId,
          blueprintHash: published.blueprintHash,
          actions: [],
        }
        : null
      const initialStateHash = transcript ? hashReplayState(initialState as ReplayState) : dummyHash
      const initialTranscriptHash = transcript ? hashTranscript(transcript) : dummyHash
      const checkpoint = transcript
        ? createInitialCheckpoint(runId, runChallenge, initialStateHash, initialTranscriptHash)
        : { checkpointHash: dummyHash }
      const capability = createRunSessionCapability()
      const sessionHash = hashRunSessionCapability(capability.raw)
      const sessionExpiresAt = nextUtcResetAt(parsed.dayKey)

      const authorized = readProofRpc(await rpc.rpc('start_expedition_authorized', {
        p_challenge_hash: hashChallenge(parsed.challenge),
        p_authorization_fingerprint: fingerprint,
        p_wallet: parsed.wallet,
        p_mission_type: parsed.mission,
        p_day_key: parsed.dayKey,
        p_blueprint_id: parsed.blueprintId,
        p_blueprint_hash: parsed.blueprintHash,
        p_run_id: runId,
        p_run_challenge: runChallenge,
        p_run_session_hash: sessionHash,
        p_initial_state_hash: initialStateHash,
        p_initial_transcript_hash: initialTranscriptHash,
        p_initial_checkpoint_hash: checkpoint.checkpointHash,
        p_initial_state: initialState,
        p_session_expires_at: sessionExpiresAt,
      }))

      const start = asStartResult(authorized.response)
      const outcome = authorized.outcome === 'START_ALREADY_CREATED' ? 'START_ALREADY_CREATED' : 'START_CREATED'
      if (outcome === 'START_ALREADY_CREATED') {
        const retryCapability = createRunSessionCapability()
        const retryHash = hashRunSessionCapability(retryCapability.raw)
        const bound = readProofRpc(await rpc.rpc('bind_run_session', {
          p_run_id: start.runId,
          p_wallet: parsed.wallet,
          p_run_session_hash: retryHash,
          p_expires_at: start.nextResetAt,
        }))
        return {
          outcome,
          start,
          sessionCapability: retryCapability.raw,
          session: {
            sessionHash: retryHash,
            runId: start.runId,
            wallet: parsed.wallet,
            createdAt: asIso(bound.created_at),
            expiresAt: asIso(bound.expires_at),
            revokedAt: null,
          },
        } satisfies StartAuthorizationResult
      }

      return {
        outcome,
        start,
        sessionCapability: capability.raw,
        session: {
          sessionHash,
          runId: start.runId,
          wallet: parsed.wallet,
          createdAt: new Date().toISOString(),
          expiresAt: sessionExpiresAt,
          revokedAt: null,
        },
      } satisfies StartAuthorizationResult
    },

    async authenticateSession(raw) {
      const hash = hashRunSessionCapability(raw)
      const payload = await rpc.rpc('get_run_session', { p_run_session_hash: hash })
      if (typeof payload === 'object' && payload !== null && 'ok' in payload && payload.ok === false) {
        throw new ProofError('INVALID_SESSION')
      }
      const result = readProofRpc(payload)
      const record: RunSessionRecord = {
        sessionHash: asString(result.session_hash),
        runId: asString(result.run_id),
        wallet: asString(result.wallet),
        createdAt: asIso(result.created_at),
        expiresAt: asIso(result.expires_at),
        revokedAt: result.revoked_at == null ? null : asIso(result.revoked_at),
      }
      try {
        return requireRunSession(raw, record, new Date())
      } catch (error) {
        if (error instanceof Error && (error.message === 'INVALID_SESSION' || error.message === 'SESSION_EXPIRED' || error.message === 'SESSION_REVOKED')) {
          throw new ProofError(error.message)
        }
        throw error
      }
    },

    async getActiveExpedition(runId, session) {
      const { run, now } = await requireAuthenticatedRun(rpc, runId, session)
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
        blueprint: run.blueprint,
        state: run.state,
        checkpoint: run.checkpoint,
      } satisfies ProductActiveExpedition
    },

    async markGameplayStarted(runId, session) {
      const { run, now } = await requireAuthenticatedRun(rpc, runId, session)
      if (run.status !== 'STARTED' || now.getTime() >= new Date(run.expiresAt).getTime()) {
        throw new ProofError('RUN_SESSION_INVALID')
      }
      if (run.gameplayStartedAt) return { runId, outcome: 'GAMEPLAY_ALREADY_STARTED' } satisfies ProductGameplayStartResponse
      if (!isRecoverableInitialRun(run)) throw new ProofError('ACTIVE_RUN_UNAVAILABLE')
      const started = readProofRpc(await rpc.rpc('mark_gameplay_started', {
        p_run_id: runId,
        p_run_session_hash: session.sessionHash,
      }))
      const outcome = started.outcome === 'GAMEPLAY_ALREADY_STARTED' ? 'GAMEPLAY_ALREADY_STARTED' : 'GAMEPLAY_STARTED'
      return { runId, outcome } satisfies ProductGameplayStartResponse
    },

    async appendCheckpoint(input) {
      const { run, now } = await requireAuthenticatedRun(rpc, input.runId, input.session)
      if (!run.gameplayStartedAt || run.status !== 'STARTED' || run.terminal || now.getTime() >= new Date(run.expiresAt).getTime()) {
        throw new ProofError('RUN_NOT_ACTIVE')
      }
      const applied = applyCheckpointBatch(run, {
        previousCheckpointHash: input.previousCheckpointHash,
        actions: input.actions,
      })
      const persisted = readProofRpc(await rpc.rpc('append_checkpoint_batch', {
        p_run_id: input.runId,
        p_run_session_hash: input.session.sessionHash,
        p_previous_checkpoint_hash: input.previousCheckpointHash,
        p_actions: input.actions,
        p_seq_start: applied.acknowledgement.seqStart,
        p_seq_end: applied.acknowledgement.seqEnd,
        p_batch_fingerprint: applied.acknowledgement.batchFingerprint,
        p_transcript_hash: applied.acknowledgement.transcriptHash,
        p_state_hash: applied.acknowledgement.stateHash,
        p_checkpoint_hash: applied.acknowledgement.checkpointHash,
        p_replay_snapshot: applied.run.state,
        p_acknowledgement: applied.acknowledgement,
      }))
      return asAcknowledgement(persisted.acknowledgement, applied.acknowledgement)
    },

    async verifyExpedition(input) {
      const { run, now } = await requireAuthenticatedRun(rpc, input.runId, input.session)
      if (now.getTime() >= new Date(run.expiresAt).getTime() && !run.terminal) {
        throw new ProofError('RUN_NOT_ACTIVE')
      }
      const verified = verifyExpeditionRun(run, { checkpointHash: input.checkpointHash, now })
      const persisted = readProofRpc(await rpc.rpc('persist_run_terminal', {
        p_run_id: input.runId,
        p_run_session_hash: input.session.sessionHash,
        p_checkpoint_hash: input.checkpointHash,
        p_status: verified.run.status,
        p_reward_status: verified.run.rewardStatus,
        p_terminal: verified.run.terminal,
      }))
      if (persisted.existing === true && persisted.terminal) {
        return asVerifiedTerminal(persisted.terminal)
      }
      return verified.result
    },

    async abandonExpedition(input) {
      const { run, now } = await requireAuthenticatedRun(rpc, input.runId, input.session)
      if (now.getTime() >= new Date(run.expiresAt).getTime() && !run.terminal) {
        throw new ProofError('RUN_NOT_ACTIVE')
      }
      const abandoned = abandonExpeditionRun(run, { checkpointHash: input.checkpointHash, now })
      readProofRpc(await rpc.rpc('persist_run_terminal', {
        p_run_id: input.runId,
        p_run_session_hash: input.session.sessionHash,
        p_checkpoint_hash: input.checkpointHash,
        p_status: abandoned.run.status,
        p_reward_status: abandoned.run.rewardStatus,
        p_terminal: abandoned.run.terminal,
      }))
      return abandoned.result
    },

    async prepareVaultSeal(runId, session) {
      const { run } = await requireAuthenticatedRun(rpc, runId, session)
      return prepareProductVaultSeal(run)
    },

    async prepareRewardClaim(runId, session) {
      const { run, now } = await requireAuthenticatedRun(rpc, runId, session)
      const prepared = createPreparedRewardClaim(run, now)
      const persisted = readProofRpc(await rpc.rpc('prepare_reward_claim', {
        p_run_id: run.runId,
        p_run_session_hash: session.sessionHash,
        p_wallet: run.wallet,
        p_mission: run.mission,
        p_day_key: run.dayKey,
        p_claim_id: prepared.claimId,
        p_canonical_payload: prepared.canonicalPayload,
        p_claim_payload_hash: prepared.claimPayloadHash,
        p_expires_at: prepared.expiresAt,
      }))
      return toPrepareResult(asRewardClaim(asRecord(persisted.claim)))
    },

    async finalizeRewardClaim(input) {
      const { run, now } = await requireAuthenticatedRun(rpc, input.session.runId, input.session)
      const loadedClaim = readProofRpc(await rpc.rpc('get_reward_claim', {
        p_claim_id: input.claimId,
        p_run_session_hash: input.session.sessionHash,
      }))
      const stored = asRewardClaim(asRecord(loadedClaim.claim))
      const remaining = asNumber(asRecord(loadedClaim.claim).remaining_slots)
      if (stored.status === 'RESERVED' || stored.status === 'SOLD_OUT' || stored.status === 'ALREADY_REWARDED') {
        if (stored.canonicalPayload !== input.payload || stored.runId !== run.runId) throw new ProofError('CLAIM_MISMATCH')
        return toFinalizeResult(stored, {
          remainingSlots: remaining,
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
      const persisted = readProofRpc(await rpc.rpc('finalize_reward_claim', {
        p_claim_id: input.claimId,
        p_run_id: run.runId,
        p_run_session_hash: input.session.sessionHash,
        p_wallet: run.wallet,
        p_canonical_payload: input.payload,
        p_claim_payload_hash: stored.claimPayloadHash,
        p_public_key: input.publicKey,
        p_signature: input.signature,
      }))
      const claim = asRewardClaim(asRecord(persisted.claim))
      return toFinalizeResult(claim, {
        remainingSlots: asNumber(asRecord(persisted.claim).remaining_slots),
        reservationNumber: claim.reservationNumber,
      })
    },

    async getRewardClaim(claimId, session) {
      await requireAuthenticatedRun(rpc, session.runId, session)
      const loaded = readProofRpc(await rpc.rpc('get_reward_claim', {
        p_claim_id: claimId,
        p_run_session_hash: session.sessionHash,
      }))
      return asRewardClaim(asRecord(loaded.claim))
    },

    async getReservedRewardClaim(session) {
      await requireAuthenticatedRun(rpc, session.runId, session)
      try {
        const loaded = readProofRpc(await rpc.rpc('get_reserved_reward_claim_for_session', {
          p_run_session_hash: session.sessionHash,
        }))
        const claim = asRewardClaim(asRecord(loaded.claim))
        return claim.status === 'RESERVED' ? claim : null
      } catch (error) {
        if (error instanceof ProofError && error.code === 'CLAIM_NOT_FOUND') return null
        throw error
      }
    },

    async verifyVaultSeal(input) {
      const parsed = parseProductVaultSeal(input.payload)
      if (!parsed) throw new ProofError('VAULT_SEAL_MISMATCH')
      const { run, now } = await requireAuthenticatedRun(rpc, parsed.runId, input.session)
      const verified = verifyProductVaultSeal(run, {
        payload: input.payload,
        publicKey: input.publicKey,
        signature: input.signature,
        now,
      })
      const persisted = readProofRpc(await rpc.rpc('persist_vault_seal', {
        p_run_id: run.runId,
        p_run_session_hash: input.session.sessionHash,
        p_wallet: run.wallet,
        p_canonical_payload: verified.run.vaultSeal?.canonicalPayload ?? input.payload,
        p_vault_seal_hash: verified.run.vaultSeal?.vaultSealHash ?? '',
        p_public_key: verified.run.vaultSeal?.publicKey ?? input.publicKey,
        p_signature: verified.run.vaultSeal?.signature ?? input.signature,
        p_vault_checkpoint_hash: verified.run.vaultSeal?.vaultCheckpointHash ?? parsed.vaultCheckpointHash,
        p_verified_at: verified.run.vaultSeal?.verifiedAt ?? now.toISOString(),
      }))
      if (persisted.existing === true && persisted.seal) {
        return {
          runId: asString((persisted.seal as Record<string, unknown>).run_id),
          wallet: asString((persisted.seal as Record<string, unknown>).wallet),
          canonicalPayload: asString((persisted.seal as Record<string, unknown>).canonical_payload),
          vaultSealHash: asString((persisted.seal as Record<string, unknown>).vault_seal_hash),
          publicKey: asString((persisted.seal as Record<string, unknown>).public_key),
          vaultCheckpointHash: asString((persisted.seal as Record<string, unknown>).vault_checkpoint_hash),
          verifiedAt: asIso((persisted.seal as Record<string, unknown>).verified_at),
        }
      }
      return verified.result
    },

    async getRun(runId) {
      return loadRun(rpc, runId)
    },

    async getWalletDailyStatus(wallet) {
      const normalizedWallet = normalizeNimiqWallet(wallet)
      const status = readProofRpc(await rpc.rpc('get_wallet_daily_status', { p_wallet: normalizedWallet }))
      return {
        dayKey: asDayKey(status.day_key),
        expeditionsStarted: asNumber(status.expeditions_started),
        expeditionsRemaining: asNumber(status.expeditions_remaining),
        rewardAlreadyReserved: Boolean(status.reward_already_reserved),
        nextResetAt: asIso(status.next_reset_at),
      }
    },

    async snapshot() {
      const payload = readProofRpc(await rpc.rpc('load_proof_snapshot', {}))
      const runIds = Array.isArray(payload.run_ids) ? payload.run_ids.map(value => asString(value)) : []
      const runs: DurableExpeditionRun[] = []
      for (const runId of runIds) {
        const run = await loadRun(rpc, runId)
        if (run) runs.push(run)
      }
      return {
        blueprints: Array.isArray(payload.blueprints) ? payload.blueprints.map(asBlueprint) : [],
        challenges: Array.isArray(payload.challenges) ? payload.challenges.map(asChallenge) : [],
        runs,
        sessions: Array.isArray(payload.sessions) ? payload.sessions.map(asSession) : [],
      } satisfies MemoryProofSnapshot
    },
  }

  for (const blueprint of options.blueprints ?? []) await service.registerBlueprint(blueprint)
  return service
}

export async function createSupabaseProofService(options: {
  readonly client: SupabaseClient
  readonly blueprints?: readonly ExpeditionBlueprint[]
}): Promise<ProofService> {
  return createPostgresProofService({
    rpc: createSupabaseProofRpcClient(options.client),
    blueprints: options.blueprints,
  })
}

async function requireAuthenticatedRun(
  rpc: ProofRpcClient,
  runId: string,
  session: RunSessionRecord,
): Promise<{ run: DurableExpeditionRun; now: Date }> {
  const now = new Date()
  const payload = await rpc.rpc('get_run_session', { p_run_session_hash: session.sessionHash })
  if (typeof payload === 'object' && payload !== null && 'ok' in payload && payload.ok === false) {
    throw new ProofError('RUN_SESSION_INVALID')
  }
  const stored = readProofRpc(payload)
  const run = await loadRun(rpc, runId)
  if (asString(stored.run_id) !== runId
    || asString(stored.run_id) !== session.runId
    || asString(stored.wallet) !== session.wallet
    || stored.revoked_at
    || now.getTime() >= new Date(asIso(stored.expires_at)).getTime()
    || !run
    || run.runId !== asString(stored.run_id)
    || run.wallet !== asString(stored.wallet)) {
    throw new ProofError('RUN_SESSION_INVALID')
  }
  return { run, now }
}

async function loadRun(rpc: ProofRpcClient, runId: string): Promise<DurableExpeditionRun | null> {
  const payload = await rpc.rpc('load_expedition_run', { p_run_id: runId })
  if (typeof payload === 'object' && payload !== null && 'ok' in payload && payload.ok === false) return null
  const result = readProofRpc(payload)
  return mapRun(result)
}

function mapRun(payload: Record<string, unknown>): DurableExpeditionRun {
  const row = asRecord(payload.run)
  const batches = asBatchList(payload.batches)
  const actions = batches.flatMap(batch => batch.actions.map(action => ({ ...action })))
  const blueprint = asBlueprint(row.canonical_blueprint)
  const state = asReplayState(row.replay_snapshot)
  const seq = asNumber(row.checkpoint_seq)
  const checkpointHash = asString(row.checkpoint_hash)
  const lastBatch = batches[batches.length - 1]
  const checkpoint: ExpeditionCheckpoint = {
    version: CHECKPOINT_VERSION,
    runId: asString(row.id),
    runChallenge: asString(row.run_challenge),
    seq,
    previousCheckpointHash: lastBatch ? lastBatch.previousCheckpointHash : null,
    stateHash: lastBatch ? lastBatch.stateHash : asString(row.initial_state_hash),
    transcriptHash: lastBatch ? lastBatch.transcriptHash : asString(row.initial_transcript_hash),
    checkpointHash,
  }
  const dayKey = asDayKey(row.day_key)
  return {
    runId: asString(row.id),
    dayKey,
    wallet: asString(row.wallet),
    mission: asMission(row.mission_type),
    status: asRunStatus(row.status),
    rewardStatus: asRewardStatus(row.reward_status),
    startedAt: asIso(row.started_at),
    expiresAt: nextUtcResetAt(dayKey),
    gameplayStartedAt: row.gameplay_started_at == null ? null : asIso(row.gameplay_started_at),
    runChallenge: asString(row.run_challenge),
    blueprint,
    state,
    checkpoint,
    initialStateHash: asString(row.initial_state_hash),
    initialTranscriptHash: asString(row.initial_transcript_hash),
    initialCheckpointHash: asString(row.initial_checkpoint_hash),
    checkpointHash,
    seq,
    actions,
    batches,
    terminal: asTerminal(row.terminal),
    vaultSeal: asVaultSeal(payload.vault_seal),
  }
}

function asBatchList(value: unknown): DurableCheckpointBatch[] {
  if (!Array.isArray(value)) return []
  return value.map(item => {
    const row = asRecord(item)
    const acknowledgement = asAcknowledgement(row.acknowledgement)
    return {
      previousCheckpointHash: asString(row.previous_checkpoint_hash),
      seqStart: asNumber(row.seq_start),
      seqEnd: asNumber(row.seq_end),
      actions: asActions(row.actions),
      batchFingerprint: asString(row.batch_fingerprint),
      transcriptHash: asString(row.transcript_hash),
      stateHash: asString(row.state_hash),
      checkpointHash: asString(row.checkpoint_hash),
      acknowledgement,
    }
  })
}

function asAcknowledgement(value: unknown, fallback?: CheckpointAcknowledgement): CheckpointAcknowledgement {
  if (fallback && (value === undefined || value === null)) return fallback
  const row = asRecord(value)
  return {
    runId: asString(row.runId),
    seqStart: asNumber(row.seqStart),
    seqEnd: asNumber(row.seqEnd),
    previousCheckpointHash: asString(row.previousCheckpointHash),
    transcriptHash: asString(row.transcriptHash),
    stateHash: asString(row.stateHash),
    batchFingerprint: asString(row.batchFingerprint),
    acknowledgedSeq: asNumber(row.acknowledgedSeq),
    checkpointHash: asString(row.checkpointHash),
    hp: asNumber(row.hp),
    gemsCollected: asNumber(row.gemsCollected),
    chestsOpened: asNumber(row.chestsOpened),
    hasTempleKey: Boolean(row.hasTempleKey),
    objectiveReached: Boolean(row.objectiveReached),
    missionSatisfied: Boolean(row.missionSatisfied),
    dead: Boolean(row.dead),
  }
}

function asStartResult(value: unknown): StartResult {
  const row = asRecord(value)
  return {
    runId: asString(row.runId),
    runChallenge: asString(row.runChallenge),
    attemptsRemaining: asNumber(row.attemptsRemaining),
    rulesVersion: asString(row.rulesVersion),
    roomVersion: asString(row.roomVersion),
    blueprintVersion: asString(row.blueprintVersion),
    blueprintId: asString(row.blueprintId),
    blueprintHash: asString(row.blueprintHash),
    blueprint: asBlueprint(row.blueprint),
    dayKey: asDayKey(row.dayKey),
    nextResetAt: asIso(row.nextResetAt),
  }
}

function asChallenge(value: unknown): DurableStartChallenge {
  const row = asRecord(value)
  return {
    challengeHash: asString(row.challenge_hash),
    wallet: asString(row.wallet),
    mission: asMission(row.mission_type),
    dayKey: asDayKey(row.day_key),
    blueprintId: asString(row.blueprint_id),
    blueprintHash: asString(row.blueprint_hash),
    createdAt: asIso(row.created_at),
    expiresAt: asIso(row.expires_at),
    consumedAt: row.consumed_at == null ? null : asIso(row.consumed_at),
    runId: row.run_id == null ? null : asString(row.run_id),
    authorizationFingerprint: row.authorization_fingerprint == null ? null : asString(row.authorization_fingerprint),
    response: row.canonical_response == null ? null : asStartResult(row.canonical_response),
  }
}

function asSession(value: unknown): RunSessionRecord {
  const row = asRecord(value)
  return {
    sessionHash: asString(row.session_hash),
    runId: asString(row.run_id),
    wallet: asString(row.wallet),
    createdAt: asIso(row.created_at),
    expiresAt: asIso(row.expires_at),
    revokedAt: row.revoked_at == null ? null : asIso(row.revoked_at),
  }
}

function asRewardClaim(value: unknown): DurableRewardClaim {
  const row = asRecord(value)
  const status = row.status
  if (status !== 'PREPARED' && status !== 'RESERVED' && status !== 'SOLD_OUT' && status !== 'ALREADY_REWARDED' && status !== 'EXPIRED') {
    throw new ProofError('PROOF_LOST')
  }
  return {
    claimId: asString(row.claim_id),
    runId: asString(row.run_id),
    wallet: asString(row.wallet),
    mission: asMission(row.mission),
    dayKey: asDayKey(row.day_key),
    canonicalPayload: asString(row.canonical_payload),
    claimPayloadHash: asString(row.claim_payload_hash),
    status,
    publicKey: row.public_key == null ? null : asString(row.public_key),
    signature: row.signature == null ? null : asString(row.signature),
    createdAt: asIso(row.created_at),
    expiresAt: asIso(row.expires_at),
    finalizedAt: row.finalized_at == null ? null : asIso(row.finalized_at),
    reservationNumber: row.reservation_number == null ? null : asNumber(row.reservation_number),
  }
}

function asVaultSeal(value: unknown): DurableVaultSealProof | null {
  if (value == null) return null
  const row = asRecord(value)
  return {
    runId: asString(row.run_id),
    wallet: asString(row.wallet),
    canonicalPayload: asString(row.canonical_payload),
    vaultSealHash: asString(row.vault_seal_hash),
    publicKey: asString(row.public_key),
    signature: asString(row.signature),
    verifiedAt: asIso(row.verified_at),
    vaultCheckpointHash: asString(row.vault_checkpoint_hash),
  }
}

function asTerminal(value: unknown): DurableRunTerminal | null {
  if (value == null) return null
  const row = asRecord(value)
  if (row.type === 'VERIFIED') {
    return { type: 'VERIFIED', result: asVerifyResult(row.result) }
  }
  if (row.type === 'ABANDONED') {
    const result = asRecord(row.result)
    return {
      type: 'ABANDONED',
      result: {
        runId: asString(result.runId),
        checkpointHash: asString(result.checkpointHash),
        outcome: result.outcome === 'FAILED' ? 'FAILED' : 'ABANDONED',
        status: result.status === 'FAILED' ? 'FAILED' : 'ABANDONED',
        rewardStatus: 'NONE',
      },
    }
  }
  throw new ProofError('PROOF_LOST')
}

function asVerifiedTerminal(value: unknown): VerifyExpeditionResult {
  const terminal = asTerminal(value)
  if (!terminal || terminal.type !== 'VERIFIED') throw new ProofError('PROOF_LOST')
  return terminal.result
}

function asVerifyResult(value: unknown): VerifyExpeditionResult {
  const row = asRecord(value)
  const outcome = row.outcome
  if (outcome !== 'VERIFIED_ELIGIBLE' && outcome !== 'VAULT_GAMEPLAY_VERIFIED' && outcome !== 'FAILED') {
    throw new ProofError('PROOF_LOST')
  }
  const status = row.status
  if (status !== 'STARTED' && status !== 'COMPLETED' && status !== 'FAILED') throw new ProofError('PROOF_LOST')
  const rewardStatus = row.rewardStatus === 'ELIGIBLE' ? 'ELIGIBLE' : 'NONE'
  return {
    runId: asString(row.runId),
    checkpointHash: asString(row.checkpointHash),
    outcome,
    status,
    rewardStatus,
    finalHp: asNumber(row.finalHp),
    gemsCollected: asNumber(row.gemsCollected),
    chestsOpened: asNumber(row.chestsOpened),
    objectiveReached: Boolean(row.objectiveReached),
    hasTempleKey: Boolean(row.hasTempleKey),
    missionSatisfied: Boolean(row.missionSatisfied),
    finalSeq: asNumber(row.finalSeq),
    transcriptHash: asString(row.transcriptHash),
    stateHash: asString(row.stateHash),
    verifiedAt: asIso(row.verifiedAt),
  }
}

function asActions(value: unknown): MoveAction[] {
  if (!Array.isArray(value)) throw new ProofError('PROOF_LOST')
  return value.map(item => {
    const row = asRecord(item)
    if (row.type !== 'MOVE') throw new ProofError('PROOF_LOST')
    const direction = row.direction
    if (direction !== 'UP' && direction !== 'DOWN' && direction !== 'LEFT' && direction !== 'RIGHT') {
      throw new ProofError('PROOF_LOST')
    }
    return { seq: asNumber(row.seq), type: 'MOVE', direction }
  })
}

function asBlueprint(value: unknown): ExpeditionBlueprint {
  const row = asRecord(value)
  return JSON.parse(JSON.stringify(row)) as ExpeditionBlueprint
}

function asReplayState(value: unknown): ReplayState {
  const row = asRecord(value)
  return JSON.parse(JSON.stringify(row)) as ReplayState
}

function asMission(value: unknown): MissionType {
  if (value === 'gem-runner' || value === 'chest-hunter' || value === 'vault-breaker') return value
  throw new ProofError('PROOF_LOST')
}

function asRunStatus(value: unknown): DurableRunStatus {
  if (value === 'STARTED' || value === 'COMPLETED' || value === 'FAILED' || value === 'ABANDONED') return value
  throw new ProofError('PROOF_LOST')
}

function asRewardStatus(value: unknown): DurableRewardStatus {
  if (value === 'NONE' || value === 'ELIGIBLE') return value
  throw new ProofError('PROOF_LOST')
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new ProofError('PROOF_LOST')
  return value as Record<string, unknown>
}

function asString(value: unknown): string {
  if (typeof value === 'string' && value.length > 0) return value
  throw new ProofError('PROOF_LOST')
}

function asNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value)
  throw new ProofError('PROOF_LOST')
}

function asDayKey(value: unknown): string {
  return asString(value).slice(0, 10)
}

function asIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString()
  const text = asString(value)
  const parsed = new Date(text)
  if (Number.isNaN(parsed.getTime())) throw new ProofError('PROOF_LOST')
  return parsed.toISOString()
}
