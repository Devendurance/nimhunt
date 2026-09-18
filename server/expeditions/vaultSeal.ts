import type {
  PreparedProductVaultSeal,
  VerifiedProductVaultSeal,
} from '../../src/domain/expeditionProof.js'
import {
  parseProductVaultSeal,
  PRODUCT_VAULT_SEAL_OBJECTIVE,
  PRODUCT_VAULT_SEAL_ROOM,
  PRODUCT_VAULT_SEAL_TYPE,
  PRODUCT_VAULT_SEAL_VERSION,
  PRODUCT_VAULT_SEAL_WORLD,
  serializeProductVaultSeal,
  type ProductVaultSealPayload,
} from '../../src/domain/productVaultSeal.js'
import { isSupportedBlueprintVersion, ROOM_VERSION, RULES_VERSION } from '../../src/game/replay/versions.js'
import { ProofError } from './errors.js'
import { sha256Hex, verifyNimiqSignedCanonicalMessage } from './crypto.js'
import type { DurableExpeditionRun, DurableVaultSealProof } from './types.js'

export function prepareProductVaultSeal(run: DurableExpeditionRun): PreparedProductVaultSeal {
  const payload = buildBoundPayload(run)
  const canonicalPayload = serializeProductVaultSeal(payload)
  return {
    runId: run.runId,
    canonicalPayload,
    vaultSealHash: sha256Hex(canonicalPayload),
  }
}

export function verifyProductVaultSeal(
  run: DurableExpeditionRun,
  input: {
    readonly payload: string
    readonly publicKey: string
    readonly signature: string
    readonly now: Date
  },
): { readonly run: DurableExpeditionRun; readonly result: VerifiedProductVaultSeal } {
  const parsed = parseProductVaultSeal(input.payload)
  if (!parsed) throw new ProofError('VAULT_SEAL_MISMATCH')
  requireBoundPayload(run, parsed)

  if (run.vaultSeal) {
    if (run.vaultSeal.canonicalPayload !== input.payload || run.vaultSeal.runId !== parsed.runId) {
      throw new ProofError('VAULT_SEAL_MISMATCH')
    }
    return { run, result: toVerifiedResult(run.vaultSeal) }
  }

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
  if (!verification.valid) throw new ProofError('VAULT_SEAL_MISMATCH')
  if (verification.wallet !== run.wallet || verification.wallet !== parsed.wallet) {
    throw new ProofError('ADDRESS_MISMATCH')
  }

  const proof: DurableVaultSealProof = {
    runId: run.runId,
    wallet: run.wallet,
    canonicalPayload: input.payload,
    vaultSealHash: sha256Hex(input.payload),
    publicKey: input.publicKey,
    signature: input.signature,
    verifiedAt: input.now.toISOString(),
    vaultCheckpointHash: parsed.vaultCheckpointHash,
  }
  return {
    run: { ...run, vaultSeal: proof },
    result: toVerifiedResult(proof),
  }
}

function buildBoundPayload(run: DurableExpeditionRun): ProductVaultSealPayload {
  requireVaultGameplayVerified(run)
  return {
    version: PRODUCT_VAULT_SEAL_VERSION,
    type: PRODUCT_VAULT_SEAL_TYPE,
    wallet: run.wallet,
    runId: run.runId,
    mission: 'vault-breaker',
    world: PRODUCT_VAULT_SEAL_WORLD,
    room: PRODUCT_VAULT_SEAL_ROOM,
    objective: PRODUCT_VAULT_SEAL_OBJECTIVE,
    runChallenge: run.runChallenge,
    rulesVersion: run.blueprint.rulesVersion,
    roomVersion: run.blueprint.roomVersion,
    blueprintVersion: run.blueprint.blueprintVersion,
    blueprintId: run.blueprint.blueprintId,
    blueprintHash: run.blueprint.blueprintHash,
    vaultCheckpointHash: run.checkpointHash,
  }
}

function requireBoundPayload(run: DurableExpeditionRun, payload: ProductVaultSealPayload): void {
  requireVaultGameplayVerified(run)
  if (payload.runId !== run.runId) throw new ProofError('RUN_MISMATCH')
  if (payload.wallet !== run.wallet) throw new ProofError('WALLET_MISMATCH')
  if (payload.mission !== run.mission) throw new ProofError('RUN_MISMATCH')
  if (payload.runChallenge !== run.runChallenge) throw new ProofError('VAULT_SEAL_MISMATCH')
  if (payload.rulesVersion !== run.blueprint.rulesVersion || payload.rulesVersion !== RULES_VERSION) {
    throw new ProofError('VAULT_SEAL_MISMATCH')
  }
  if (payload.roomVersion !== run.blueprint.roomVersion || payload.roomVersion !== ROOM_VERSION) {
    throw new ProofError('VAULT_SEAL_MISMATCH')
  }
  if (payload.blueprintVersion !== run.blueprint.blueprintVersion || !isSupportedBlueprintVersion(payload.blueprintVersion)) {
    throw new ProofError('VAULT_SEAL_MISMATCH')
  }
  if (payload.blueprintId !== run.blueprint.blueprintId) throw new ProofError('VAULT_SEAL_MISMATCH')
  if (payload.blueprintHash !== run.blueprint.blueprintHash) throw new ProofError('VAULT_SEAL_MISMATCH')
  if (payload.vaultCheckpointHash !== run.checkpointHash) throw new ProofError('CHECKPOINT_MISMATCH')
  if (run.terminal?.type !== 'VERIFIED' || payload.vaultCheckpointHash !== run.terminal.result.checkpointHash) {
    throw new ProofError('CHECKPOINT_MISMATCH')
  }
}

function requireVaultGameplayVerified(run: DurableExpeditionRun): void {
  if (run.mission !== 'vault-breaker') throw new ProofError('RUN_MISMATCH')
  if (run.terminal?.type !== 'VERIFIED' || run.terminal.result.outcome !== 'VAULT_GAMEPLAY_VERIFIED') {
    throw new ProofError('VAULT_SEAL_REQUIRED')
  }
  if (run.status !== 'STARTED' || run.rewardStatus !== 'NONE') throw new ProofError('RUN_NOT_ACTIVE')
  if (!run.gameplayStartedAt) throw new ProofError('VAULT_SEAL_REQUIRED')
  if (run.terminal.result.checkpointHash !== run.checkpointHash) throw new ProofError('CHECKPOINT_MISMATCH')
  if (!run.terminal.result.objectiveReached || run.terminal.result.finalHp <= 0) {
    throw new ProofError('CHECKPOINT_MISMATCH')
  }
  if (run.blueprint.rulesVersion !== RULES_VERSION
    || run.blueprint.roomVersion !== ROOM_VERSION
    || !isSupportedBlueprintVersion(run.blueprint.blueprintVersion)) {
    throw new ProofError('VAULT_SEAL_MISMATCH')
  }
}

function toVerifiedResult(proof: DurableVaultSealProof): VerifiedProductVaultSeal {
  return {
    runId: proof.runId,
    wallet: proof.wallet,
    canonicalPayload: proof.canonicalPayload,
    vaultSealHash: proof.vaultSealHash,
    publicKey: proof.publicKey,
    vaultCheckpointHash: proof.vaultCheckpointHash,
    verifiedAt: proof.verifiedAt,
  }
}
