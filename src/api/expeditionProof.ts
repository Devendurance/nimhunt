import {
  ABANDON_EXPEDITION_PATH,
  ACTIVE_EXPEDITION_PATH,
  CHECKPOINT_PATH,
  EXPEDITION_RESULT_PATH,
  FINALIZE_REWARD_CLAIM_PATH,
  GAMEPLAY_START_PATH,
  GET_REWARD_PAYOUT_PATH,
  PREPARE_REWARD_CLAIM_PATH,
  PRODUCT_VAULT_SEAL_PREPARE_PATH,
  PRODUCT_VAULT_SEAL_VERIFY_PATH,
  RECOVER_RUN_SESSION_PATH,
  START_CHALLENGE_PATH,
  START_EXPEDITION_PATH,
  VERIFY_EXPEDITION_PATH,
} from '../domain/expeditionProof.ts'
import {
  RECOVER_SESSION_CHALLENGE_PATH,
  RECOVER_SESSION_PATH,
  type WalletRecoveryChallengeResponse,
} from '../domain/walletRecovery.ts'
import { getOrCreateInstallId, readInstallId } from '../domain/installId.ts'
import { traceWalletRecovery } from '../components/play/walletRecoveryDiagnostics.ts'
import type {
  AbandonExpeditionResult,
  CheckpointAcknowledgement,
  CheckpointRequest,
  ExpeditionProofErrorCode,
  FinalizeRewardClaimResult,
  PreparedProductVaultSeal,
  PrepareRewardClaimResult,
  ProductActiveExpedition,
  RewardPayoutStatus,
  RewardPayoutStatusResult,
  ProductGameplayStartResponse,
  StartChallengeResponse,
  StartResult,
  VerifiedProductVaultSeal,
  VerifyExpeditionRequest,
  VerifyExpeditionResult,
} from '../domain/expeditionProof.ts'
import { parseProductRewardClaim } from '../domain/productRewardClaim.ts'
import { parseProductVaultSeal } from '../domain/productVaultSeal.ts'
import {
  CHECKPOINT_VERSION,
  ROOM_VERSION,
  RULES_VERSION,
  isSupportedBlueprintVersion,
} from '../game/replay/versions.ts'
import type {
  BlueprintBoulder,
  BlueprintChest,
  BlueprintGem,
  BlueprintGoblin,
  BlueprintHazard,
  Direction,
  ExpeditionBlueprint,
  ExpeditionCheckpoint,
  ReplayChestState,
  ReplayCollapsingBoulderState,
  ReplayGoblinState,
  ReplayState,
  TimedHazard,
} from '../game/replay/types.ts'
import type { MissionType } from '../game/replay/types.ts'

export type SignedStartRequest = {
  readonly payload: string
  readonly publicKey: string
  readonly signature: string
}

export type ProductStartResult = StartResult & {
  readonly outcome: 'START_CREATED' | 'START_ALREADY_CREATED'
}

export type ExpeditionProofApiErrorCode = ExpeditionProofErrorCode | 'NETWORK_ERROR' | 'MALFORMED_RESPONSE'

export class ExpeditionProofApiError extends Error {
  readonly code: ExpeditionProofApiErrorCode

  constructor(code: ExpeditionProofApiErrorCode) {
    super(code)
    this.name = 'ExpeditionProofApiError'
    this.code = code
  }
}

export async function requestStartChallenge(
  wallet: string,
  mission: MissionType,
  fetcher: typeof fetch = fetch,
): Promise<StartChallengeResponse> {
  return requestJson(fetcher, START_CHALLENGE_PATH, postRequest(withInstallId({ wallet, mission })), parseStartChallengeResponse)
}

export async function authorizeStart(
  signed: SignedStartRequest,
  fetcher: typeof fetch = fetch,
): Promise<ProductStartResult> {
  return requestJson(fetcher, START_EXPEDITION_PATH, postRequest(withInstallId(signed)), parseStartResult)
}

export async function requestWalletRecoveryChallenge(
  wallet: string,
  fetcher: typeof fetch = fetch,
): Promise<WalletRecoveryChallengeResponse> {
  return requestJson(fetcher, RECOVER_SESSION_CHALLENGE_PATH, postRequest(withInstallId({ wallet })), parseWalletRecoveryChallengeResponse)
}

export async function authorizeWalletRecovery(
  signed: SignedStartRequest,
  fetcher: typeof fetch = fetch,
): Promise<{ readonly ok: true }> {
  traceWalletRecovery('RECOVERY_VERIFY_REQUESTED', { requested: 'yes' })
  return requestJson(fetcher, RECOVER_SESSION_PATH, postRequest(withInstallId(signed)), parseWalletRecoveryResult)
}

export async function fetchActiveExpedition(
  runId: string,
  fetcher: typeof fetch = fetch,
): Promise<ProductActiveExpedition> {
  return requestJson(
    fetcher,
    `${ACTIVE_EXPEDITION_PATH}?runId=${encodeURIComponent(runId)}`,
    getRequest(),
    parseActiveExpedition,
  )
}

export async function fetchExpeditionResult(
  runId: string,
  fetcher: typeof fetch = fetch,
): Promise<VerifyExpeditionResult> {
  return requestJson(
    fetcher,
    `${EXPEDITION_RESULT_PATH}?runId=${encodeURIComponent(runId)}`,
    getRequest(),
    parseVerifyExpeditionResult,
  )
}

export type RecoverRunSessionResult = {
  readonly ok: true
  readonly runId: string
}

export function parseRecoverRunSessionResult(value: unknown): RecoverRunSessionResult | null {
  if (!isRecord(value) || !hasExactKeys(value, ['ok', 'runId'])) return null
  if (value.ok !== true || !isBoundedString(value.runId, 128)) return null
  return { ok: true, runId: value.runId }
}

export async function recoverRunSession(
  runId: string,
  fetcher: typeof fetch = fetch,
): Promise<RecoverRunSessionResult> {
  return requestJson(fetcher, RECOVER_RUN_SESSION_PATH, postRequest({ runId }), parseRecoverRunSessionResult)
}

export async function markGameplayStarted(
  runId: string,
  fetcher: typeof fetch = fetch,
): Promise<ProductGameplayStartResponse> {
  return requestJson(fetcher, GAMEPLAY_START_PATH, postRequest({ runId }), parseGameplayStartResponse)
}

export async function submitCheckpoint(
  request: CheckpointRequest,
  fetcher: typeof fetch = fetch,
): Promise<CheckpointAcknowledgement> {
  const seqStart = request.actions[0]?.seq
  const seqEnd = request.actions[request.actions.length - 1]?.seq
  traceCheckpoint(
    'CHECKPOINT_REQUEST_BEGIN',
    `url=${CHECKPOINT_PATH} seq=${seqStart ?? '?'}-${seqEnd ?? '?'} prev=${truncateHash(request.previousCheckpointHash)} actionCount=${request.actions.length} dirs=${request.actions.map(action => action.type === 'MOVE' ? action.direction : 'TICK').join(',')}`,
  )
  return requestJson(fetcher, CHECKPOINT_PATH, postRequest(request), parseCheckpointAcknowledgement)
}

export async function verifyExpedition(
  request: VerifyExpeditionRequest,
  fetcher: typeof fetch = fetch,
): Promise<VerifyExpeditionResult> {
  return requestJson(fetcher, VERIFY_EXPEDITION_PATH, postRequest(request), parseVerifyExpeditionResult)
}

export async function abandonExpedition(
  request: VerifyExpeditionRequest,
  fetcher: typeof fetch = fetch,
): Promise<AbandonExpeditionResult> {
  return requestJson(fetcher, ABANDON_EXPEDITION_PATH, postRequest(request), parseAbandonExpeditionResult)
}

export async function prepareProductVaultSeal(
  runId: string,
  fetcher: typeof fetch = fetch,
): Promise<PreparedProductVaultSeal> {
  return requestJson(fetcher, PRODUCT_VAULT_SEAL_PREPARE_PATH, postRequest({ runId }), parsePreparedProductVaultSeal)
}

export async function verifyProductVaultSeal(
  signed: SignedStartRequest,
  fetcher: typeof fetch = fetch,
): Promise<VerifiedProductVaultSeal> {
  return requestJson(fetcher, PRODUCT_VAULT_SEAL_VERIFY_PATH, postRequest(signed), parseVerifiedProductVaultSeal)
}

export async function prepareRewardClaim(
  runId: string,
  fetcher: typeof fetch = fetch,
): Promise<PrepareRewardClaimResult> {
  return requestJson(fetcher, PREPARE_REWARD_CLAIM_PATH, postRequest(withInstallId({ runId })), parsePrepareRewardClaimResult)
}

export async function finalizeRewardClaim(
  signed: SignedStartRequest & { readonly claimId: string },
  fetcher: typeof fetch = fetch,
): Promise<FinalizeRewardClaimResult> {
  return requestJson(fetcher, FINALIZE_REWARD_CLAIM_PATH, postRequest(withInstallId(signed)), parseFinalizeRewardClaimResult)
}

export async function fetchRewardPayoutStatus(
  claimId?: string | null,
  fetcher: typeof fetch = fetch,
): Promise<RewardPayoutStatusResult> {
  const path = claimId
    ? `${GET_REWARD_PAYOUT_PATH}?claimId=${encodeURIComponent(claimId)}`
    : GET_REWARD_PAYOUT_PATH
  return requestJson(
    fetcher,
    path,
    getRequest(),
    parseRewardPayoutStatusResult,
  )
}

export function parseWalletRecoveryChallengeResponse(value: unknown): WalletRecoveryChallengeResponse | null {
  if (!isRecord(value) || !hasExactKeys(value, ['ok', 'wallet', 'challenge', 'issuedAt', 'expiresAt', 'purpose'])) return null
  if (value.ok !== true
    || !isBoundedString(value.wallet, 80)
    || !isBoundedString(value.challenge, 256)
    || !/^[A-Za-z0-9_-]+$/.test(value.challenge)
    || !isIsoTimestamp(value.issuedAt)
    || !isIsoTimestamp(value.expiresAt)
    || value.purpose !== 'reward/daily-state recovery') return null
  return {
    wallet: value.wallet,
    challenge: value.challenge,
    issuedAt: value.issuedAt,
    expiresAt: value.expiresAt,
    purpose: 'reward/daily-state recovery',
  }
}

export function parseWalletRecoveryResult(value: unknown): { readonly ok: true } | null {
  if (!isRecord(value) || !hasExactKeys(value, ['ok']) || value.ok !== true) return null
  return { ok: true }
}

export function parseStartChallengeResponse(value: unknown): StartChallengeResponse | null {
  if (!isRecord(value) || !hasExactKeys(value, ['ok', 'wallet', 'challenge', 'blueprintId', 'blueprintHash', 'dayKey', 'expiresAt'])) return null
  if (value.ok !== true
    || !isBoundedString(value.wallet, 80)
    || !isBoundedString(value.challenge, 256)
    || !/^[A-Za-z0-9_-]+$/.test(value.challenge)
    || !isBoundedString(value.blueprintId, 256)
    || !isHash(value.blueprintHash)
    || !isUtcDay(value.dayKey)
    || !isIsoTimestamp(value.expiresAt)) return null
  return value as unknown as StartChallengeResponse
}

export function parseStartResult(value: unknown): ProductStartResult | null {
  if (!isRecord(value) || !hasExactKeys(value, [
    'ok',
    'outcome',
    'runId',
    'runChallenge',
    'attemptsRemaining',
    'rulesVersion',
    'roomVersion',
    'blueprintVersion',
    'blueprintId',
    'blueprintHash',
    'blueprint',
    'dayKey',
    'nextResetAt',
  ])) return null
  if (value.ok !== true || (value.outcome !== 'START_CREATED' && value.outcome !== 'START_ALREADY_CREATED')) return null
  if (!isBoundedString(value.runId, 128)
    || !isBoundedString(value.runChallenge, 256)
    || !/^[A-Za-z0-9_-]+$/.test(value.runChallenge)
    || !isNonNegativeInteger(value.attemptsRemaining)
    || value.attemptsRemaining > 3
    || !isSupportedVersions(value)
    || !isBoundedString(value.blueprintId, 256)
    || !isHash(value.blueprintHash)
    || !isUtcDay(value.dayKey)
    || !isIsoTimestamp(value.nextResetAt)) return null

  const blueprint = parseBlueprint(value.blueprint)
  if (!blueprint || !sameBlueprintIdentity(blueprint, value)) return null
  return value as unknown as ProductStartResult
}

export function parseActiveExpedition(value: unknown): ProductActiveExpedition | null {
  if (!isRecord(value) || !hasExactKeys(value, [
    'ok',
    'runId',
    'dayKey',
    'mission',
    'status',
    'startedAt',
    'expiresAt',
    'gameplayStartedAt',
    'rulesVersion',
    'roomVersion',
    'blueprintVersion',
    'blueprintId',
    'blueprintHash',
    'blueprint',
    'state',
    'checkpoint',
  ])) return null
  if (value.ok !== true
    || !isBoundedString(value.runId, 128)
    || !isUtcDay(value.dayKey)
    || !isMission(value.mission)
    || value.status !== 'STARTED'
    || !isIsoTimestamp(value.startedAt)
    || !isIsoTimestamp(value.expiresAt)
    || value.gameplayStartedAt !== null
    || !isSupportedVersions(value)
    || !isBoundedString(value.blueprintId, 256)
    || !isHash(value.blueprintHash)) return null

  const blueprint = parseBlueprint(value.blueprint)
  const state = parseReplayState(value.state)
  const checkpoint = parseCheckpoint(value.checkpoint)
  if (!blueprint || !state || !checkpoint
    || !sameBlueprintIdentity(blueprint, value)
    || blueprint.mission !== value.mission
    || state.mission !== value.mission
    || state.seq !== 0
    || state.run.runStatus !== 'PLAYING'
    || state.run.missionStatus !== 'IN_PROGRESS'
    || !sameBlueprintIdentity(state.blueprint, blueprint)
    || JSON.stringify(state.blueprint) !== JSON.stringify(blueprint)
    || checkpoint.runId !== value.runId
    || checkpoint.seq !== 0) return null
  return value as unknown as ProductActiveExpedition
}

export function parseGameplayStartResponse(value: unknown): ProductGameplayStartResponse | null {
  if (!isRecord(value) || !hasExactKeys(value, ['ok', 'runId', 'outcome'])) return null
  if (value.ok !== true
    || !isBoundedString(value.runId, 128)
    || (value.outcome !== 'GAMEPLAY_STARTED' && value.outcome !== 'GAMEPLAY_ALREADY_STARTED')) return null
  return { runId: value.runId, outcome: value.outcome }
}

export function parseCheckpointAcknowledgement(value: unknown): CheckpointAcknowledgement | null {
  if (!isRecord(value) || !hasExactKeys(value, [
    'ok',
    'runId',
    'acknowledgedSeq',
    'seqStart',
    'seqEnd',
    'previousCheckpointHash',
    'checkpointHash',
    'transcriptHash',
    'stateHash',
    'batchFingerprint',
    'hp',
    'gemsCollected',
    'chestsOpened',
    'hasTempleKey',
    'objectiveReached',
    'missionSatisfied',
    'dead',
  ])) return null
  if (value.ok !== true
    || !isBoundedString(value.runId, 128)
    || !isPositiveInteger(value.acknowledgedSeq)
    || !isPositiveInteger(value.seqStart)
    || !isPositiveInteger(value.seqEnd)
    || value.seqEnd < value.seqStart
    || value.acknowledgedSeq !== value.seqEnd
    || !isHash(value.previousCheckpointHash)
    || !isHash(value.checkpointHash)
    || !isHash(value.transcriptHash)
    || !isHash(value.stateHash)
    || !isHash(value.batchFingerprint)
    || !isFiniteNumber(value.hp)
    || value.hp < 0
    || value.hp > 100
    || !isNonNegativeInteger(value.gemsCollected)
    || !isNonNegativeInteger(value.chestsOpened)
    || typeof value.hasTempleKey !== 'boolean'
    || typeof value.objectiveReached !== 'boolean'
    || typeof value.missionSatisfied !== 'boolean'
    || typeof value.dead !== 'boolean') return null
  return {
    runId: value.runId,
    acknowledgedSeq: value.acknowledgedSeq,
    seqStart: value.seqStart,
    seqEnd: value.seqEnd,
    previousCheckpointHash: value.previousCheckpointHash,
    checkpointHash: value.checkpointHash,
    transcriptHash: value.transcriptHash,
    stateHash: value.stateHash,
    batchFingerprint: value.batchFingerprint,
    hp: value.hp,
    gemsCollected: value.gemsCollected,
    chestsOpened: value.chestsOpened,
    hasTempleKey: value.hasTempleKey,
    objectiveReached: value.objectiveReached,
    missionSatisfied: value.missionSatisfied,
    dead: value.dead,
  }
}

export function parseVerifyExpeditionResult(value: unknown): VerifyExpeditionResult | null {
  if (!isRecord(value) || !hasExactKeys(value, [
    'ok',
    'runId',
    'checkpointHash',
    'outcome',
    'status',
    'rewardStatus',
    'finalHp',
    'gemsCollected',
    'chestsOpened',
    'objectiveReached',
    'hasTempleKey',
    'missionSatisfied',
    'finalSeq',
    'transcriptHash',
    'stateHash',
    'verifiedAt',
  ])) return null
  if (value.ok !== true
    || !isBoundedString(value.runId, 128)
    || !isHash(value.checkpointHash)
    || (value.outcome !== 'VERIFIED_ELIGIBLE' && value.outcome !== 'VAULT_GAMEPLAY_VERIFIED' && value.outcome !== 'FAILED')
    || (value.status !== 'STARTED' && value.status !== 'COMPLETED' && value.status !== 'FAILED')
    || (value.rewardStatus !== 'NONE' && value.rewardStatus !== 'ELIGIBLE')
    || !isFiniteNumber(value.finalHp)
    || value.finalHp < 0
    || value.finalHp > 100
    || !isNonNegativeInteger(value.gemsCollected)
    || !isNonNegativeInteger(value.chestsOpened)
    || typeof value.objectiveReached !== 'boolean'
    || typeof value.hasTempleKey !== 'boolean'
    || typeof value.missionSatisfied !== 'boolean'
    || !isNonNegativeInteger(value.finalSeq)
    || !isHash(value.transcriptHash)
    || !isHash(value.stateHash)
    || !isIsoTimestamp(value.verifiedAt)) return null
  if (value.outcome === 'VERIFIED_ELIGIBLE' && (value.status !== 'COMPLETED' || value.rewardStatus !== 'ELIGIBLE' || !value.missionSatisfied)) return null
  if (value.outcome === 'VAULT_GAMEPLAY_VERIFIED' && (value.status !== 'STARTED' || value.rewardStatus !== 'NONE' || value.missionSatisfied)) return null
  if (value.outcome === 'FAILED' && (value.status !== 'FAILED' || value.rewardStatus !== 'NONE' || value.missionSatisfied || value.finalHp !== 0)) return null
  return {
    runId: value.runId,
    checkpointHash: value.checkpointHash,
    outcome: value.outcome,
    status: value.status,
    rewardStatus: value.rewardStatus,
    finalHp: value.finalHp,
    gemsCollected: value.gemsCollected,
    chestsOpened: value.chestsOpened,
    objectiveReached: value.objectiveReached,
    hasTempleKey: value.hasTempleKey,
    missionSatisfied: value.missionSatisfied,
    finalSeq: value.finalSeq,
    transcriptHash: value.transcriptHash,
    stateHash: value.stateHash,
    verifiedAt: value.verifiedAt,
  }
}

export function parseAbandonExpeditionResult(value: unknown): AbandonExpeditionResult | null {
  if (!isRecord(value) || !hasExactKeys(value, ['ok', 'runId', 'checkpointHash', 'outcome', 'status', 'rewardStatus'])) return null
  if (value.ok !== true
    || !isBoundedString(value.runId, 128)
    || !isHash(value.checkpointHash)
    || (value.outcome !== 'ABANDONED' && value.outcome !== 'FAILED')
    || value.status !== value.outcome
    || value.rewardStatus !== 'NONE') return null
  const outcome = value.outcome === 'FAILED' ? 'FAILED' as const : 'ABANDONED' as const
  return {
    runId: value.runId,
    checkpointHash: value.checkpointHash,
    outcome,
    status: outcome,
    rewardStatus: 'NONE',
  }
}

export function parsePreparedProductVaultSeal(value: unknown): PreparedProductVaultSeal | null {
  if (!isRecord(value) || !hasExactKeys(value, ['ok', 'runId', 'canonicalPayload', 'vaultSealHash'])) return null
  if (value.ok !== true
    || !isBoundedString(value.runId, 128)
    || !isBoundedString(value.canonicalPayload, 4_096)
    || !isHash(value.vaultSealHash)) return null
  const parsed = parseProductVaultSeal(value.canonicalPayload)
  if (!parsed || parsed.runId !== value.runId) return null
  return {
    runId: value.runId,
    canonicalPayload: value.canonicalPayload,
    vaultSealHash: value.vaultSealHash,
  }
}

export function parseVerifiedProductVaultSeal(value: unknown): VerifiedProductVaultSeal | null {
  if (!isRecord(value) || !hasExactKeys(value, [
    'ok',
    'runId',
    'wallet',
    'canonicalPayload',
    'vaultSealHash',
    'publicKey',
    'vaultCheckpointHash',
    'verifiedAt',
  ])) return null
  if (value.ok !== true
    || !isBoundedString(value.runId, 128)
    || !isBoundedString(value.wallet, 80)
    || !isBoundedString(value.canonicalPayload, 4_096)
    || !isHash(value.vaultSealHash)
    || !isBoundedString(value.publicKey, 130)
    || !isHash(value.vaultCheckpointHash)
    || !isIsoTimestamp(value.verifiedAt)) return null
  const parsed = parseProductVaultSeal(value.canonicalPayload)
  if (!parsed
    || parsed.runId !== value.runId
    || parsed.wallet !== value.wallet
    || parsed.vaultCheckpointHash !== value.vaultCheckpointHash) return null
  return {
    runId: value.runId,
    wallet: value.wallet,
    canonicalPayload: value.canonicalPayload,
    vaultSealHash: value.vaultSealHash,
    publicKey: value.publicKey,
    vaultCheckpointHash: value.vaultCheckpointHash,
    verifiedAt: value.verifiedAt,
  }
}

export function parsePrepareRewardClaimResult(value: unknown): PrepareRewardClaimResult | null {
  if (!isRecord(value) || value.ok !== true) return null
  if (value.outcome === 'PREPARED') {
    if (!hasExactKeys(value, ['ok', 'outcome', 'claimId', 'runId', 'canonicalPayload', 'claimPayloadHash', 'expiresAt'])) return null
    if (!isBoundedString(value.claimId, 128) || !isBoundedString(value.runId, 128) || !isBoundedString(value.canonicalPayload, 4_096) || !isHash(value.claimPayloadHash) || !isIsoTimestamp(value.expiresAt)) {
      return null
    }
    const parsed = parseProductRewardClaim(value.canonicalPayload)
    if (!parsed || parsed.claimId !== value.claimId || parsed.runId !== value.runId) return null
    return {
      outcome: 'PREPARED',
      claimId: value.claimId,
      runId: value.runId,
      canonicalPayload: value.canonicalPayload,
      claimPayloadHash: value.claimPayloadHash,
      expiresAt: value.expiresAt,
    }
  }
  if (value.outcome === 'REVIEW') {
    if (!hasExactKeys(value, ['ok', 'outcome', 'runId']) || !isBoundedString(value.runId, 128)) return null
    return { outcome: 'REVIEW', runId: value.runId }
  }
  if (value.outcome === 'BLOCK') {
    if (!hasExactKeys(value, ['ok', 'outcome', 'runId', 'reasonCategory']) || !isBoundedString(value.runId, 128)) return null
    if (value.reasonCategory !== 'TIMING' && value.reasonCategory !== 'SESSION' && value.reasonCategory !== 'ELIGIBILITY') return null
    return { outcome: 'BLOCK', runId: value.runId, reasonCategory: value.reasonCategory }
  }
  if (value.outcome !== 'SOLD_OUT' && value.outcome !== 'ALREADY_REWARDED' && value.outcome !== 'RESERVED') return null
  if (!hasExactKeys(value, ['ok', 'outcome', 'claimId', 'runId', 'expiresAt', 'reservationNumber', 'remainingSlots', 'totalSlots'])) return null
  if (!isBoundedString(value.claimId, 128) || !isBoundedString(value.runId, 128) || !isIsoTimestamp(value.expiresAt) || value.totalSlots !== 69) return null
  if (value.reservationNumber !== null && !isPositiveInteger(value.reservationNumber)) return null
  if (value.remainingSlots !== null && !isNonNegativeInteger(value.remainingSlots)) return null
  return {
    outcome: value.outcome,
    claimId: value.claimId,
    runId: value.runId,
    expiresAt: value.expiresAt,
    reservationNumber: value.reservationNumber,
    remainingSlots: value.remainingSlots,
    totalSlots: 69,
  }
}

export function parseFinalizeRewardClaimResult(value: unknown): FinalizeRewardClaimResult | null {
  if (!isRecord(value) || !hasExactKeys(value, ['ok', 'outcome', 'claimId', 'runId', 'reservationNumber', 'remainingSlots', 'totalSlots', 'finalizedAt'])) return null
  if (value.ok !== true || (value.outcome !== 'RESERVED' && value.outcome !== 'SOLD_OUT' && value.outcome !== 'ALREADY_REWARDED')) return null
  if (!isBoundedString(value.claimId, 128) || !isBoundedString(value.runId, 128) || value.totalSlots !== 69 || !isIsoTimestamp(value.finalizedAt)) return null
  if (value.reservationNumber !== null && !isPositiveInteger(value.reservationNumber)) return null
  if (value.remainingSlots !== null && !isNonNegativeInteger(value.remainingSlots)) return null
  if (value.outcome === 'RESERVED' && (value.reservationNumber === null || value.remainingSlots === null)) return null
  return {
    outcome: value.outcome,
    claimId: value.claimId,
    runId: value.runId,
    reservationNumber: value.reservationNumber,
    remainingSlots: value.remainingSlots,
    totalSlots: 69,
    finalizedAt: value.finalizedAt,
  }
}

export function parseRewardPayoutStatusResult(value: unknown): RewardPayoutStatusResult | null {
  if (!isRecord(value) || !hasExactKeys(value, ['ok', 'claimId', 'payout']) || value.ok !== true || !isBoundedString(value.claimId, 128)) {
    return null
  }
  if (value.payout === null) return { claimId: value.claimId, payout: null }
  if (!isRecord(value.payout) || !hasExactKeys(value.payout, [
    'payoutId',
    'claimId',
    'status',
    'amountLuna',
    'network',
    'txHashSafe',
    'submittedAt',
    'confirmedAt',
  ])) return null
  if (!isBoundedString(value.payout.payoutId, 128)
    || !isBoundedString(value.payout.claimId, 128)
    || !isPayoutStatus(value.payout.status)
    || !isLunaAmount(value.payout.amountLuna)
    || (value.payout.network !== 'testnet' && value.payout.network !== 'mainnet')) return null
  if (value.payout.txHashSafe !== null && !isHash(value.payout.txHashSafe)) return null
  if (value.payout.submittedAt !== null && !isIsoTimestamp(value.payout.submittedAt)) return null
  if (value.payout.confirmedAt !== null && !isIsoTimestamp(value.payout.confirmedAt)) return null
  return {
    claimId: value.claimId,
    payout: {
      payoutId: value.payout.payoutId,
      claimId: value.payout.claimId,
      status: value.payout.status,
      amountLuna: value.payout.amountLuna,
      network: value.payout.network,
      txHashSafe: value.payout.txHashSafe,
      submittedAt: value.payout.submittedAt,
      confirmedAt: value.payout.confirmedAt,
    },
  }
}

function isLunaAmount(value: unknown): value is string {
  return typeof value === 'string' && /^[1-9][0-9]{0,31}$/.test(value)
}

function isPayoutStatus(value: unknown): value is RewardPayoutStatus {
  return value === 'PENDING'
    || value === 'PROCESSING'
    || value === 'SUBMITTED'
    || value === 'CONFIRMED'
    || value === 'FAILED_RETRYABLE'
    || value === 'FAILED_FINAL'
}

function isPositiveInteger(value: unknown): value is number {
  return isNonNegativeInteger(value) && value >= 1
}

async function requestJson<T>(
  fetcher: typeof fetch,
  path: string,
  init: RequestInit,
  parser: (value: unknown) => T | null,
): Promise<T> {
  const startChallenge = path === START_CHALLENGE_PATH
  const checkpoint = path === CHECKPOINT_PATH
  let response: Response
  try {
    response = await fetcher(path, init)
  } catch {
    if (checkpoint) traceCheckpoint('CHECKPOINT_ERROR_CODE', 'code=NETWORK_ERROR')
    traceRecoveryHttp(path, 0, 'NETWORK_ERROR')
    throw new ExpeditionProofApiError('NETWORK_ERROR')
  }

  const status = response.status
  const contentType = response.headers?.get?.('content-type') ?? 'missing'
  if (startChallenge) traceStartChallenge('START_CHALLENGE_HTTP_STATUS', `status=${status} contentType=${contentType}`)
  if (checkpoint) traceCheckpoint('CHECKPOINT_HTTP_STATUS', `status=${status} contentType=${contentType}`)

  let data: unknown
  try {
    data = await response.json()
  } catch {
    if (startChallenge) traceStartChallenge('START_CHALLENGE_PARSE_FAILURE', `status=${status} contentType=${contentType} json=false`)
    if (checkpoint) traceCheckpoint('CHECKPOINT_PARSE_FAILURE', `status=${status} contentType=${contentType} json=false`)
    traceRecoveryHttp(path, status, 'MALFORMED_RESPONSE')
    throw new ExpeditionProofApiError('MALFORMED_RESPONSE')
  }
  if (startChallenge) {
    traceStartChallenge('START_CHALLENGE_RESPONSE_RECEIVED', `status=${status} contentType=${contentType} fields=[${fieldNames(data)}]`)
  }
  if (checkpoint) {
    traceCheckpoint('CHECKPOINT_RESPONSE_FIELDS', `status=${status} contentType=${contentType} fields=[${fieldNames(data)}]`)
  }
  if (!response.ok) {
    const errorCode = readErrorCode(data)
    if (startChallenge && !errorCode) {
      traceStartChallenge('START_CHALLENGE_PARSE_FAILURE', `status=${status} parserMissing=knownError`)
    }
    if (checkpoint) {
      traceCheckpoint('CHECKPOINT_ERROR_CODE', `code=${errorCode ?? 'MALFORMED_RESPONSE'} status=${status}`)
      if (!errorCode) traceCheckpoint('CHECKPOINT_PARSE_FAILURE', `status=${status} parserMissing=knownError`)
    }
    traceRecoveryHttp(path, status, errorCode ?? 'MALFORMED_RESPONSE')
    throw new ExpeditionProofApiError(errorCode ?? 'MALFORMED_RESPONSE')
  }

  if (startChallenge) traceStartChallenge('START_CHALLENGE_PARSE_BEGIN', `fields=[${fieldNames(data)}]`)
  const parsed = parser(data)
  if (!parsed) {
    if (startChallenge) traceStartChallenge('START_CHALLENGE_PARSE_FAILURE', diagnoseStartChallengeParse(data))
    if (checkpoint) traceCheckpoint('CHECKPOINT_PARSE_FAILURE', diagnoseCheckpointParse(data))
    traceRecoveryHttp(path, status, 'MALFORMED_RESPONSE')
    throw new ExpeditionProofApiError('MALFORMED_RESPONSE')
  }
  if (startChallenge) traceStartChallenge('START_CHALLENGE_PARSE_SUCCESS', `fields=[${fieldNames(data)}]`)
  if (checkpoint) traceCheckpoint('CHECKPOINT_PARSE_SUCCESS', `fields=[${fieldNames(data)}]`)
  traceRecoveryHttp(path, status, 'ok')
  return parsed
}

function traceRecoveryHttp(path: string, status: number, code: string): void {
  const route = path.split('?')[0] ?? path
  if (route === GET_REWARD_PAYOUT_PATH) {
    traceWalletRecovery('PAYOUT_GET_HTTP', { status, code })
    return
  }
  if (route === RECOVER_SESSION_CHALLENGE_PATH) {
    traceWalletRecovery('RECOVERY_CHALLENGE_STATUS', { status, code })
    return
  }
  if (route === RECOVER_SESSION_PATH) {
    traceWalletRecovery('RECOVERY_VERIFY_STATUS', { status, code })
  }
}

function traceStartChallenge(boundary: string, details = ''): void {
  const env = (import.meta as ImportMeta & { env?: { DEV?: boolean; MODE?: string } }).env
  if (!env?.DEV || env.MODE === 'test') return
  console.info(`[product-start] ${boundary}${details ? ` ${details}` : ''}`)
}

function fieldNames(value: unknown): string {
  return isRecord(value) ? Object.keys(value).join(',') : typeof value
}

function diagnoseCheckpointParse(value: unknown): string {
  const expected = [
    'ok',
    'runId',
    'acknowledgedSeq',
    'seqStart',
    'seqEnd',
    'previousCheckpointHash',
    'checkpointHash',
    'transcriptHash',
    'stateHash',
    'batchFingerprint',
    'hp',
    'gemsCollected',
    'chestsOpened',
    'hasTempleKey',
    'objectiveReached',
    'missionSatisfied',
    'dead',
  ]
  if (!isRecord(value)) return `parserMissing=object actual=${typeof value}`
  const keys = Object.keys(value)
  const missing = expected.filter(key => !keys.includes(key))
  const extra = keys.filter(key => !expected.includes(key))
  if (missing.length > 0 || extra.length > 0) {
    return [
      missing.length > 0 ? `parserMissing=${missing.join(',')}` : '',
      extra.length > 0 ? `parserExtra=${extra.join(',')}` : '',
    ].filter(Boolean).join(' ')
  }
  return 'parserInvalid=value'
}

function truncateHash(value: string): string {
  return /^[0-9a-f]{64}$/.test(value) ? `${value.slice(0, 8)}…` : 'invalid'
}

function traceCheckpoint(boundary: string, details = ''): void {
  const env = (import.meta as ImportMeta & { env?: { DEV?: boolean; MODE?: string } }).env
  if (!env?.DEV || env.MODE === 'test') return
  console.info(`[product-checkpoint] ${boundary}${details ? ` ${details}` : ''}`)
}

function diagnoseStartChallengeParse(value: unknown): string {
  const expected = ['ok', 'wallet', 'challenge', 'blueprintId', 'blueprintHash', 'dayKey', 'expiresAt']
  if (!isRecord(value)) return `parserMissing=object actual=${typeof value}`
  const keys = Object.keys(value)
  const missing = expected.filter(key => !keys.includes(key))
  const extra = keys.filter(key => !expected.includes(key))
  if (missing.length > 0 || extra.length > 0) {
    return [
      missing.length > 0 ? `parserMissing=${missing.join(',')}` : '',
      extra.length > 0 ? `parserExtra=${extra.join(',')}` : '',
    ].filter(Boolean).join(' ')
  }
  const invalid: string[] = []
  if (value.ok !== true) invalid.push('ok')
  if (!isBoundedString(value.wallet, 80)) invalid.push('wallet')
  if (!isBoundedString(value.challenge, 256) || !/^[A-Za-z0-9_-]+$/.test(String(value.challenge))) invalid.push('challenge')
  if (!isBoundedString(value.blueprintId, 256)) invalid.push('blueprintId')
  if (!isHash(value.blueprintHash)) invalid.push('blueprintHash')
  if (!isUtcDay(value.dayKey)) invalid.push('dayKey')
  if (!isIsoTimestamp(value.expiresAt)) invalid.push('expiresAt')
  return invalid.length > 0 ? `parserInvalid=${invalid.join(',')}` : 'parserInvalid=unknown'
}

function getRequest(): RequestInit {
  return {
    method: 'GET',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { accept: 'application/json' },
  }
}

function postRequest(body: unknown): RequestInit {
  return {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }
}

function withInstallId<T extends Record<string, unknown>>(body: T): T & { installId?: string } {
  const existing = readInstallId()
  if (existing) return { ...body, installId: existing }
  try {
    if (typeof localStorage === 'undefined') return body
  } catch {
    return body
  }
  return { ...body, installId: getOrCreateInstallId() }
}

function parseBlueprint(value: unknown): ExpeditionBlueprint | null {
  const required = [
    'rulesVersion',
    'roomVersion',
    'blueprintVersion',
    'dayKey',
    'mission',
    'blueprintId',
    'blueprintHash',
    'status',
    'spawn',
    'goblins',
    'gems',
    'chests',
    'sword',
    'potion',
    'hazards',
    'boulders',
    'key',
    'gate',
    'objective',
    'missionParameters',
    'timedHazards',
  ] as const
  const optional = ['storedCanonicalJson', 'createdAt', 'updatedAt'] as const
  if (!isRecord(value) || !hasAllowedKeys(value, required, optional)
    || !isSupportedVersions(value)
    || !isUtcDay(value.dayKey)
    || !isMission(value.mission)
    || !isBoundedString(value.blueprintId, 256)
    || !isHash(value.blueprintHash)
    || value.status !== 'PUBLISHED'
    || !isCoord(value.spawn)
    || !isArrayOf(value.goblins, parseGoblin)
    || !isArrayOf(value.gems, parseGem)
    || !isArrayOf(value.chests, parseChest)
    || !isNullableCoord(value.sword)
    || !isNullableCoord(value.potion)
    || !isArrayOf(value.hazards, parseHazard)
    || !isArrayOf(value.boulders, parseBoulder)
    || !isCoord(value.key)
    || !isCoord(value.gate)
    || !isCoord(value.objective)
    || !parseMissionParameters(value.missionParameters)
    || !isArrayOf(value.timedHazards, parseTimedHazard)) return null

  if ('storedCanonicalJson' in value && !isBoundedString(value.storedCanonicalJson, 16 * 1024)) return null
  if (('createdAt' in value && !isIsoTimestamp(value.createdAt)) || ('updatedAt' in value && !isIsoTimestamp(value.updatedAt))) return null
  return value as unknown as ExpeditionBlueprint
}


function parseReplayState(value: unknown): ReplayState | null {
  const required = [
    'seq',
    'blueprint',
    'mission',
    'rulesVersion',
    'roomVersion',
    'blueprintVersion',
    'blueprintId',
    'blueprintHash',
    'player',
    'run',
    'items',
    'puzzle',
    'chests',
    'goblins',
  ] as const
  const optional = ['collapsingBoulders'] as const
  if (!isRecord(value) || !hasAllowedKeys(value, required, optional)
    || !isNonNegativeInteger(value.seq)
    || !isMission(value.mission)
    || !isSupportedVersions(value)
    || !isBoundedString(value.blueprintId, 256)
    || !isHash(value.blueprintHash)
    || !isCoord(value.player)) return null

  const blueprint = parseBlueprint(value.blueprint)
  const run = parseRunState(value.run)
  const items = parseItems(value.items)
  const puzzle = parsePuzzle(value.puzzle)
  const chests = isArrayOf(value.chests, parseReplayChest) ? value.chests : null
  const goblins = isArrayOf(value.goblins, parseReplayGoblin) ? value.goblins : null
  if (!blueprint || !run || !items || !puzzle || !chests || !goblins
    || blueprint.mission !== value.mission
    || !sameBlueprintIdentity(blueprint, value)) return null

  if ('collapsingBoulders' in value && value.collapsingBoulders !== undefined && !isArrayOf(value.collapsingBoulders, parseCollapsingBoulder)) {
    return null
  }

  return value as unknown as ReplayState
}

function parseCheckpoint(value: unknown): ExpeditionCheckpoint | null {
  if (!isRecord(value) || !hasExactKeys(value, [
    'version',
    'runId',
    'runChallenge',
    'seq',
    'previousCheckpointHash',
    'stateHash',
    'transcriptHash',
    'checkpointHash',
  ])
    || value.version !== CHECKPOINT_VERSION
    || !isBoundedString(value.runId, 128)
    || !isBoundedString(value.runChallenge, 256)
    || !isNonNegativeInteger(value.seq)
    || (value.previousCheckpointHash !== null && !isHash(value.previousCheckpointHash))
    || !isHash(value.stateHash)
    || !isHash(value.transcriptHash)
    || !isHash(value.checkpointHash)) return null
  return value as unknown as ExpeditionCheckpoint
}

function parseRunState(value: unknown): ReplayState['run'] | null {
  if (!isRecord(value) || !hasExactKeys(value, [
    'hp',
    'gemsCollected',
    'collectedGemIds',
    'chestsOpened',
    'openedChestIds',
    'missionStatus',
    'runStatus',
  ])
    || !isFiniteNumber(value.hp)
    || value.hp < 0
    || value.hp > 100
    || !isNonNegativeInteger(value.gemsCollected)
    || !isStringArray(value.collectedGemIds)
    || !isNonNegativeInteger(value.chestsOpened)
    || !isStringArray(value.openedChestIds)
    || !['IN_PROGRESS', 'COMPLETE', 'FAILED'].includes(String(value.missionStatus))
    || !['PLAYING', 'MISSION_COMPLETE', 'FAILED'].includes(String(value.runStatus))) return null
  return value as unknown as ReplayState['run']
}

function parseItems(value: unknown): ReplayState['items'] | null {
  if (!isRecord(value) || !hasExactKeys(value, ['hasSword', 'swordPickedUp', 'potionConsumed'])
    || typeof value.hasSword !== 'boolean'
    || typeof value.swordPickedUp !== 'boolean'
    || typeof value.potionConsumed !== 'boolean') return null
  return value as unknown as ReplayState['items']
}

function parsePuzzle(value: unknown): ReplayState['puzzle'] | null {
  if (!isRecord(value) || !hasExactKeys(value, ['hasTempleKey', 'gateState', 'boulderPositions', 'objectiveReached'])
    || typeof value.hasTempleKey !== 'boolean'
    || (value.gateState !== 'LOCKED' && value.gateState !== 'OPEN')
    || !isArrayOf(value.boulderPositions, parseBoulder)
    || typeof value.objectiveReached !== 'boolean') return null
  return value as unknown as ReplayState['puzzle']
}

function parseReplayChest(value: unknown): ReplayChestState | null {
  if (!isRecord(value) || !hasExactKeys(value, ['id', 'x', 'y', 'loot', 'state', 'resolved'])
    || !isBoundedString(value.id, 128)
    || !isCoord(value)
    || !isLoot(value.loot)
    || (value.state !== 'CLOSED' && value.state !== 'OPEN')
    || typeof value.resolved !== 'boolean') return null
  return value as unknown as ReplayChestState
}

function parseReplayGoblin(value: unknown): ReplayGoblinState | null {
  if (!isRecord(value) || !hasExactKeys(value, ['gridX', 'gridY', 'facing', 'state', 'patrolIndex', 'patrolDirection'])
    || !isCoord({ x: value.gridX, y: value.gridY })
    || !isDirection(value.facing)
    || !['PATROL', 'CHASE', 'STUNNED', 'DEFEATED'].includes(String(value.state))
    || !Number.isInteger(value.patrolIndex)
    || (value.patrolDirection !== 1 && value.patrolDirection !== -1)) return null
  return value as unknown as ReplayGoblinState
}

function parseGoblin(value: unknown): BlueprintGoblin | null {
  if (!isRecord(value) || !hasExactKeys(value, ['id', 'spawn', 'patrolRoute'])
    || !isBoundedString(value.id, 128)
    || !isCoord(value.spawn)
    || !Array.isArray(value.patrolRoute)
    || value.patrolRoute.length === 0
    || !value.patrolRoute.every(isCoord)) return null
  return value as unknown as BlueprintGoblin
}

function parseGem(value: unknown): BlueprintGem | null {
  if (!isRecord(value) || !hasExactKeys(value, ['id', 'x', 'y'])
    || !isBoundedString(value.id, 128)
    || !isCoord(value)) return null
  return value as unknown as BlueprintGem
}

function parseChest(value: unknown): BlueprintChest | null {
  if (!isRecord(value) || !hasExactKeys(value, ['id', 'x', 'y', 'loot'])
    || !isBoundedString(value.id, 128)
    || !isCoord(value)
    || !isLoot(value.loot)) return null
  return value as unknown as BlueprintChest
}

function parseHazard(value: unknown): BlueprintHazard | null {
  if (!isRecord(value) || !hasExactKeys(value, ['x', 'y', 'type'])
    || !isCoord(value)
    || !isHazardType(value.type)) return null
  return value as unknown as BlueprintHazard
}

function parseBoulder(value: unknown): BlueprintBoulder | null {
  if (!isRecord(value) || !hasExactKeys(value, ['id', 'x', 'y'])
    || !isBoundedString(value.id, 128)
    || !isCoord(value)) return null
  return value as unknown as BlueprintBoulder
}

function parseTimedHazard(value: unknown): TimedHazard | null {
  if (!isRecord(value) || !hasAllowedKeys(value, ['id', 'x', 'y', 'type', 'trigger', 'delay'], ['triggerCells', 'warningTicks'])
    || !isBoundedString(value.id, 128)
    || !isCoord(value)
    || (!isHazardType(value.type) && value.type !== 'COLLAPSING_BOULDER')
    || (value.trigger !== 'TURN' && value.trigger !== 'REAL_TIME')
    || !isNonNegativeInteger(value.delay)) return null
  if ('triggerCells' in value && !isArrayOf(value.triggerCells, isCoord)) return null
  if ('warningTicks' in value && !isNonNegativeInteger(value.warningTicks)) return null
  return value as unknown as TimedHazard
}

function parseCollapsingBoulder(value: unknown): ReplayCollapsingBoulderState | null {
  if (!isRecord(value) || !hasAllowedKeys(value, ['id', 'state', 'triggeredAtTick', 'elapsedTicks', 'targetTicks'], ['collapseAtTick'])
    || !isBoundedString(value.id, 128)
    || (value.state !== 'ARMED' && value.state !== 'WARNING' && value.state !== 'FALLEN')
    || (value.triggeredAtTick !== null && !isNonNegativeInteger(value.triggeredAtTick))
    || !isNonNegativeInteger(value.elapsedTicks)
    || (value.targetTicks !== null && !isNonNegativeInteger(value.targetTicks))) return null
  return value as unknown as ReplayCollapsingBoulderState
}

function parseMissionParameters(value: unknown): boolean {
  return isRecord(value)
    && hasExactKeys(value, ['gemTarget', 'chestTarget'])
    && isNonNegativeInteger(value.gemTarget)
    && isNonNegativeInteger(value.chestTarget)
}

function sameBlueprintIdentity(value: ExpeditionBlueprint, other: Record<string, unknown> | ExpeditionBlueprint): boolean {
  return value.blueprintId === other.blueprintId
    && value.blueprintHash === other.blueprintHash
    && value.rulesVersion === other.rulesVersion
    && value.roomVersion === other.roomVersion
    && value.blueprintVersion === other.blueprintVersion
    && (!('mission' in other) || value.mission === other.mission)
    && (!('dayKey' in other) || value.dayKey === other.dayKey)
}

function isSupportedVersions(value: Record<string, unknown>): boolean {
  return value.rulesVersion === RULES_VERSION
    && value.roomVersion === ROOM_VERSION
    && typeof value.blueprintVersion === 'string'
    && isSupportedBlueprintVersion(value.blueprintVersion)
}

function readErrorCode(value: unknown): ExpeditionProofErrorCode | null {
  if (!isRecord(value) || typeof value.error !== 'string' || !KNOWN_ERROR_CODES.has(value.error)) return null
  return value.error as ExpeditionProofErrorCode
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value)
  return keys.length === expected.length && expected.every(key => keys.includes(key))
}

function hasAllowedKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
): boolean {
  const allowed = new Set([...required, ...optional])
  return required.every(key => key in value) && Object.keys(value).every(key => allowed.has(key))
}

function isArrayOf<T>(value: unknown, parser: (entry: unknown) => T | null): value is T[] {
  return Array.isArray(value) && value.every(entry => parser(entry) !== null)
}

function isCoord(value: unknown): boolean {
  return isRecord(value)
    && Number.isInteger(value.x)
    && Number.isInteger(value.y)
    && Number(value.x) >= 0
    && Number(value.y) >= 0
    && Number(value.x) <= 255
    && Number(value.y) <= 255
}

function isNullableCoord(value: unknown): boolean {
  return value === null || isCoord(value)
}

function isMission(value: unknown): value is MissionType {
  return value === 'gem-runner' || value === 'chest-hunter' || value === 'vault-breaker'
}

function isDirection(value: unknown): value is Direction {
  return value === 'UP' || value === 'DOWN' || value === 'LEFT' || value === 'RIGHT'
}

function isHazardType(value: unknown): boolean {
  return value === 'SPIKES' || value === 'POISON'
}

function isLoot(value: unknown): boolean {
  return value === 'GEMS' || value === 'POTION' || value === 'SWORD' || value === 'TRAP' || value === 'EMPTY'
}

function isBoundedString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(entry => isBoundedString(entry, 128))
}

function isHash(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isNonNegativeInteger(value: unknown): value is number {
  return isFiniteNumber(value) && Number.isInteger(value) && value >= 0
}

function isUtcDay(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const parsed = new Date(value)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const KNOWN_ERROR_CODES = new Set<string>([
  'MALFORMED_TRANSCRIPT',
  'ACTION_LIMIT_EXCEEDED',
  'INVALID_SEQUENCE',
  'INVALID_ACTION',
  'UNSUPPORTED_RULES_VERSION',
  'UNSUPPORTED_ROOM_VERSION',
  'UNSUPPORTED_BLUEPRINT_VERSION',
  'CHECKPOINT_MISMATCH',
  'PROOF_LOST',
  'DAILY_BLUEPRINT_UNAVAILABLE',
  'INVALID_WALLET',
  'MALFORMED_REQUEST',
  'START_CHALLENGE_EXPIRED',
  'START_CHALLENGE_DAY_EXPIRED',
  'START_CHALLENGE_INVALID',
  'START_ALREADY_CREATED',
  'INVALID_SESSION',
  'SESSION_EXPIRED',
  'SESSION_REVOKED',
  'RUN_NOT_FOUND',
  'RUN_MISMATCH',
  'WALLET_MISMATCH',
  'RUN_NOT_ACTIVE',
  'INVALID_SIGNATURE',
  'ADDRESS_MISMATCH',
  'VAULT_SEAL_REQUIRED',
  'VAULT_SEAL_MISMATCH',
  'CLAIM_NOT_FOUND',
  'CLAIM_MISMATCH',
  'CLAIM_NOT_ELIGIBLE',
  'CLAIM_WINDOW_EXPIRED',
  'CLAIM_ALREADY_FINALIZED',
  'DAILY_EXPEDITION_LIMIT_REACHED',
  'BLUEPRINT_INVALID',
  'BLUEPRINT_IMMUTABLE',
  'BLUEPRINT_ALREADY_PUBLISHED',
  'BLUEPRINT_LIFECYCLE_INVALID',
  'PROOF_UNAVAILABLE',
  'SOLD_OUT',
  'ALREADY_REWARDED',
  'RUN_SESSION_INVALID',
  'ACTIVE_RUN_UNAVAILABLE',
  'RUN_INCOMPLETE',
  'RECOVERY_CHALLENGE_INVALID',
  'RECOVERY_CHALLENGE_EXPIRED',
  'RATE_LIMITED',
  'REWARD_UNAVAILABLE',
])
