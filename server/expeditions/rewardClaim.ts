import { randomUUID } from 'node:crypto'
import {
  parseProductRewardClaim,
  PRODUCT_REWARD_CLAIM_TYPE,
  PRODUCT_REWARD_CLAIM_VERSION,
  serializeProductRewardClaim,
  type ProductRewardClaimPayload,
} from '../../src/domain/productRewardClaim.ts'
import type {
  FinalizeRewardClaimResult,
  PrepareRewardClaimResult,
} from '../../src/domain/expeditionProof.ts'
import { isSupportedBlueprintVersion, ROOM_VERSION, RULES_VERSION } from '../../src/game/replay/versions.ts'
import { nextUtcResetAt } from '../ledger/utcDay.ts'
import { sha256Hex, verifyNimiqSignedCanonicalMessage } from './crypto.ts'
import { ProofError } from './errors.ts'
import type { DurableExpeditionRun, DurableRewardClaim } from './types.ts'

export function requireClaimEligible(run: DurableExpeditionRun): void {
  if (run.terminal?.type !== 'VERIFIED') throw new ProofError('CLAIM_NOT_ELIGIBLE')
  const result = run.terminal.result
  if (run.mission === 'gem-runner' || run.mission === 'chest-hunter') {
    if (result.outcome !== 'VERIFIED_ELIGIBLE' || result.status !== 'COMPLETED' || result.rewardStatus !== 'ELIGIBLE') {
      throw new ProofError('CLAIM_NOT_ELIGIBLE')
    }
    if (!result.missionSatisfied || result.finalHp <= 0) throw new ProofError('CLAIM_NOT_ELIGIBLE')
    return
  }
  if (run.mission !== 'vault-breaker' || result.outcome !== 'VAULT_GAMEPLAY_VERIFIED') {
    throw new ProofError('CLAIM_NOT_ELIGIBLE')
  }
  if (!run.vaultSeal) throw new ProofError('VAULT_SEAL_REQUIRED')
  if (run.vaultSeal.runId !== run.runId || run.vaultSeal.wallet !== run.wallet) {
    throw new ProofError('VAULT_SEAL_MISMATCH')
  }
  if (run.vaultSeal.vaultCheckpointHash !== run.checkpointHash || run.vaultSeal.vaultCheckpointHash !== result.checkpointHash) {
    throw new ProofError('VAULT_SEAL_MISMATCH')
  }
}

export function buildBoundRewardClaimPayload(run: DurableExpeditionRun, claimId: string): ProductRewardClaimPayload {
  requireClaimEligible(run)
  requireBoundVersions(run)
  const transcriptHash = run.terminal?.type === 'VERIFIED' ? run.terminal.result.transcriptHash : run.checkpoint.transcriptHash
  const base = {
    version: PRODUCT_REWARD_CLAIM_VERSION,
    type: PRODUCT_REWARD_CLAIM_TYPE,
    claimId,
    wallet: run.wallet,
    runId: run.runId,
    dayKey: run.dayKey,
    runChallenge: run.runChallenge,
    rulesVersion: run.blueprint.rulesVersion,
    roomVersion: run.blueprint.roomVersion,
    blueprintVersion: run.blueprint.blueprintVersion,
    blueprintId: run.blueprint.blueprintId,
    blueprintHash: run.blueprint.blueprintHash,
    transcriptHash,
  }
  if (run.mission === 'vault-breaker') {
    if (!run.vaultSeal) throw new ProofError('VAULT_SEAL_REQUIRED')
    return { ...base, mission: 'vault-breaker', vaultSealHash: run.vaultSeal.vaultSealHash }
  }
  if (run.mission === 'gem-runner' || run.mission === 'chest-hunter') {
    return { ...base, mission: run.mission }
  }
  throw new ProofError('CLAIM_NOT_ELIGIBLE')
}

export function createPreparedRewardClaim(run: DurableExpeditionRun, now: Date): DurableRewardClaim {
  requireClaimWindow(run, now)
  const claimId = randomUUID()
  const payload = buildBoundRewardClaimPayload(run, claimId)
  const canonicalPayload = serializeProductRewardClaim(payload)
  return {
    claimId,
    runId: run.runId,
    wallet: run.wallet,
    mission: run.mission,
    dayKey: run.dayKey,
    canonicalPayload,
    claimPayloadHash: sha256Hex(canonicalPayload),
    status: 'PREPARED',
    publicKey: null,
    signature: null,
    createdAt: now.toISOString(),
    expiresAt: nextUtcResetAt(run.dayKey),
    finalizedAt: null,
    reservationNumber: null,
  }
}

export function requireBoundRewardClaim(run: DurableExpeditionRun, payload: ProductRewardClaimPayload): void {
  requireClaimEligible(run)
  requireBoundVersions(run)
  if (payload.runId !== run.runId) throw new ProofError('RUN_MISMATCH')
  if (payload.wallet !== run.wallet) throw new ProofError('WALLET_MISMATCH')
  if (payload.mission !== run.mission) throw new ProofError('CLAIM_MISMATCH')
  if (payload.dayKey !== run.dayKey) throw new ProofError('CLAIM_MISMATCH')
  if (payload.runChallenge !== run.runChallenge) throw new ProofError('CLAIM_MISMATCH')
  if (payload.rulesVersion !== run.blueprint.rulesVersion) throw new ProofError('CLAIM_MISMATCH')
  if (payload.roomVersion !== run.blueprint.roomVersion) throw new ProofError('CLAIM_MISMATCH')
  if (payload.blueprintVersion !== run.blueprint.blueprintVersion) throw new ProofError('CLAIM_MISMATCH')
  if (payload.blueprintId !== run.blueprint.blueprintId) throw new ProofError('CLAIM_MISMATCH')
  if (payload.blueprintHash !== run.blueprint.blueprintHash) throw new ProofError('CLAIM_MISMATCH')
  const transcriptHash = run.terminal?.type === 'VERIFIED' ? run.terminal.result.transcriptHash : run.checkpoint.transcriptHash
  if (payload.transcriptHash !== transcriptHash) throw new ProofError('CLAIM_MISMATCH')
  if (run.mission === 'vault-breaker') {
    if (!('vaultSealHash' in payload) || !run.vaultSeal || payload.vaultSealHash !== run.vaultSeal.vaultSealHash) {
      throw new ProofError('VAULT_SEAL_MISMATCH')
    }
  } else if ('vaultSealHash' in payload) {
    throw new ProofError('CLAIM_MISMATCH')
  }
}

export function verifySignedRewardClaim(
  run: DurableExpeditionRun,
  claim: DurableRewardClaim,
  input: {
    readonly claimId: string
    readonly payload: string
    readonly publicKey: string
    readonly signature: string
    readonly now: Date
  },
): void {
  if (claim.claimId !== input.claimId || claim.runId !== run.runId) throw new ProofError('CLAIM_MISMATCH')
  requireClaimWindow(claim, input.now)
  const parsed = parseProductRewardClaim(input.payload)
  if (!parsed) throw new ProofError('CLAIM_MISMATCH')
  if (serializeProductRewardClaim(parsed) !== claim.canonicalPayload || sha256Hex(input.payload) !== claim.claimPayloadHash) {
    throw new ProofError('CLAIM_MISMATCH')
  }
  if (parsed.claimId !== claim.claimId) throw new ProofError('CLAIM_MISMATCH')
  requireBoundRewardClaim(run, parsed)

  const verification = verifyNimiqSignedCanonicalMessage({
    payload: input.payload,
    wallet: run.wallet,
    payloadWallet: parsed.wallet,
    publicKey: input.publicKey,
    signature: input.signature,
  })
  if (verification.reason === 'INVALID_SIGNATURE') throw new ProofError('INVALID_SIGNATURE')
  if (verification.reason === 'ADDRESS_MISMATCH') throw new ProofError('ADDRESS_MISMATCH')
  if (verification.reason === 'INVALID_WALLET') throw new ProofError('WALLET_MISMATCH')
  if (!verification.valid) throw new ProofError('CLAIM_MISMATCH')
  if (verification.wallet !== run.wallet || verification.wallet !== parsed.wallet || verification.wallet !== claim.wallet) {
    throw new ProofError('ADDRESS_MISMATCH')
  }
}

export function toPrepareResult(claim: DurableRewardClaim): PrepareRewardClaimResult {
  if (claim.status === 'PREPARED') {
    return {
      outcome: 'PREPARED',
      claimId: claim.claimId,
      runId: claim.runId,
      canonicalPayload: claim.canonicalPayload,
      claimPayloadHash: claim.claimPayloadHash,
      expiresAt: claim.expiresAt,
    }
  }
  if (claim.status === 'RESERVED' || claim.status === 'SOLD_OUT' || claim.status === 'ALREADY_REWARDED') {
    return {
      outcome: claim.status,
      claimId: claim.claimId,
      runId: claim.runId,
      expiresAt: claim.expiresAt,
      reservationNumber: claim.reservationNumber,
      remainingSlots: null,
      totalSlots: 69,
    }
  }
  throw new ProofError('CLAIM_WINDOW_EXPIRED')
}

export function toFinalizeResult(
  claim: DurableRewardClaim,
  extras: { readonly remainingSlots: number | null; readonly reservationNumber: number | null } = {
    remainingSlots: claim.status === 'SOLD_OUT' ? 0 : null,
    reservationNumber: claim.reservationNumber,
  },
): FinalizeRewardClaimResult {
  if (claim.status !== 'RESERVED' && claim.status !== 'SOLD_OUT' && claim.status !== 'ALREADY_REWARDED') {
    throw new ProofError(claim.status === 'EXPIRED' ? 'CLAIM_WINDOW_EXPIRED' : 'CLAIM_NOT_ELIGIBLE')
  }
  return {
    outcome: claim.status,
    claimId: claim.claimId,
    runId: claim.runId,
    reservationNumber: extras.reservationNumber,
    remainingSlots: extras.remainingSlots,
    totalSlots: 69,
    finalizedAt: claim.finalizedAt ?? claim.createdAt,
  }
}

function requireBoundVersions(run: DurableExpeditionRun): void {
  if (run.blueprint.rulesVersion !== RULES_VERSION
    || run.blueprint.roomVersion !== ROOM_VERSION
    || !isSupportedBlueprintVersion(run.blueprint.blueprintVersion)) {
    throw new ProofError('CLAIM_MISMATCH')
  }
}

function requireClaimWindow(value: { readonly dayKey?: string; readonly expiresAt?: string }, now: Date): void {
  const expiresAt = value.expiresAt ?? (value.dayKey ? nextUtcResetAt(value.dayKey) : null)
  if (!expiresAt || now.getTime() >= new Date(expiresAt).getTime()) throw new ProofError('CLAIM_WINDOW_EXPIRED')
}
