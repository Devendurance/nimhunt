import type {
  AbandonExpeditionResult,
  CheckpointAcknowledgement,
  FinalizeRewardClaimResult,
  PreparedProductVaultSeal,
  PrepareRewardClaimResult,
  ProductActiveExpedition,
  ProductGameplayStartResponse,
  StartChallengeResponse,
  StartResult,
  VerifiedProductVaultSeal,
  VerifyExpeditionResult,
} from '../../src/domain/expeditionProof.js'
import type { WalletDailyStatus } from '../../src/domain/dailyLedger.js'
import type { WalletRecoveryChallengeResponse } from '../../src/domain/walletRecovery.js'
import type { DurableHazardDeadline, ExpeditionBlueprint, ExpeditionCheckpoint, MissionType, ReplayAction, ReplayState } from '../../src/game/replay/types.js'
import type { Clock } from '../ledger/types.js'
import type { RunSessionRecord, WalletRecoverySessionRecord } from './session.js'

export type { Clock, DurableHazardDeadline }

export type RiskContext = {
  readonly installId?: string
}

export type DurableStartChallenge = {
  readonly challengeHash: string
  readonly wallet: string
  readonly mission: MissionType
  readonly dayKey: string
  readonly blueprintId: string
  readonly blueprintHash: string
  readonly createdAt: string
  readonly expiresAt: string
  readonly consumedAt: string | null
  readonly runId: string | null
  readonly authorizationFingerprint: string | null
  readonly response: StartResult | null
}

export type DurableCheckpointBatch = {
  readonly previousCheckpointHash: string
  readonly seqStart: number
  readonly seqEnd: number
  readonly actions: readonly ReplayAction[]
  readonly batchFingerprint: string
  readonly transcriptHash: string
  readonly stateHash: string
  readonly checkpointHash: string
  readonly acknowledgement: CheckpointAcknowledgement
}

export type DurableRunStatus = 'STARTED' | 'COMPLETED' | 'FAILED' | 'ABANDONED'
export type DurableRewardStatus = 'NONE' | 'ELIGIBLE'
export type DurableRewardClaimStatus = 'PREPARED' | 'RESERVED' | 'SOLD_OUT' | 'ALREADY_REWARDED' | 'EXPIRED'

export type DurableRewardClaim = {
  readonly claimId: string
  readonly runId: string
  readonly wallet: string
  readonly mission: MissionType
  readonly dayKey: string
  readonly canonicalPayload: string
  readonly claimPayloadHash: string
  readonly status: DurableRewardClaimStatus
  readonly publicKey: string | null
  readonly signature: string | null
  readonly createdAt: string
  readonly expiresAt: string
  readonly finalizedAt: string | null
  readonly reservationNumber: number | null
}

export type DurableRunTerminal =
  | { readonly type: 'VERIFIED'; readonly result: VerifyExpeditionResult }
  | { readonly type: 'ABANDONED'; readonly result: AbandonExpeditionResult }

export type DurableVaultSealProof = {
  readonly runId: string
  readonly wallet: string
  readonly canonicalPayload: string
  readonly vaultSealHash: string
  readonly publicKey: string
  readonly signature: string
  readonly verifiedAt: string
  readonly vaultCheckpointHash: string
}

export type DurableExpeditionRun = {
  readonly runId: string
  readonly dayKey: string
  readonly wallet: string
  readonly mission: MissionType
  readonly status: DurableRunStatus
  readonly rewardStatus: DurableRewardStatus
  readonly startedAt: string
  readonly expiresAt: string
  readonly gameplayStartedAt: string | null
  readonly runChallenge: string
  readonly blueprint: ExpeditionBlueprint
  readonly state: ReplayState
  readonly checkpoint: ExpeditionCheckpoint
  readonly initialStateHash: string
  readonly initialTranscriptHash: string
  readonly initialCheckpointHash: string
  readonly checkpointHash: string
  readonly seq: number
  readonly actions: readonly ReplayAction[]
  readonly batches: readonly DurableCheckpointBatch[]
  readonly hazardDeadlines?: readonly DurableHazardDeadline[]
  readonly terminal: DurableRunTerminal | null
  readonly vaultSeal: DurableVaultSealProof | null
}

export type StartAuthorizationResult = {
  readonly outcome: 'START_CREATED' | 'START_ALREADY_CREATED'
  readonly start: StartResult
  readonly sessionCapability: string
  readonly session: RunSessionRecord
}

export type DurableWalletRecoveryChallenge = {
  readonly challengeHash: string
  readonly wallet: string
  readonly issuedAt: string
  readonly expiresAt: string
  readonly consumedAt: string | null
  readonly authorizationFingerprint: string | null
}

export type WalletRecoveryAuthorizationResult = {
  readonly sessionCapability: string
  readonly session: WalletRecoverySessionRecord
}

export type RunSessionRecoveryResult = {
  readonly runId: string
  readonly sessionCapability: string
  readonly session: RunSessionRecord
}

export type MemoryProofSnapshot = {
  readonly blueprints: readonly ExpeditionBlueprint[]
  readonly challenges: readonly DurableStartChallenge[]
  readonly runs: readonly DurableExpeditionRun[]
  readonly sessions: readonly RunSessionRecord[]
}

export type MemoryProofService = {
  registerBlueprint(blueprint: ExpeditionBlueprint): void
  publishBlueprint(blueprintId: string): void
  retireBlueprint(blueprintId: string): void
  getPublishedBlueprint(dayKey: string, mission: MissionType): ExpeditionBlueprint | null
  issueStartChallenge(wallet: string, mission: MissionType, risk?: RiskContext): Promise<StartChallengeResponse>
  authorizeStart(input: { readonly payload: string; readonly publicKey: string; readonly signature: string; readonly risk?: RiskContext }): Promise<StartAuthorizationResult>
  authenticateSession(raw: string): RunSessionRecord
  getActiveExpedition(runId: string, session: RunSessionRecord): ProductActiveExpedition
  markGameplayStarted(runId: string, session: RunSessionRecord): ProductGameplayStartResponse
  appendCheckpoint(input: {
    readonly runId: string
    readonly session: RunSessionRecord
    readonly previousCheckpointHash: string
    readonly actions: readonly ReplayAction[]
  }): Promise<CheckpointAcknowledgement>
  verifyExpedition(input: {
    readonly runId: string
    readonly session: RunSessionRecord
    readonly checkpointHash: string
  }): Promise<VerifyExpeditionResult>
  abandonExpedition(input: {
    readonly runId: string
    readonly session: RunSessionRecord
    readonly checkpointHash: string
  }): Promise<AbandonExpeditionResult>
  prepareVaultSeal(runId: string, session: RunSessionRecord): Promise<PreparedProductVaultSeal>
  verifyVaultSeal(input: {
    readonly session: RunSessionRecord
    readonly payload: string
    readonly publicKey: string
    readonly signature: string
  }): Promise<VerifiedProductVaultSeal>
  prepareRewardClaim(runId: string, session: RunSessionRecord, risk?: RiskContext): Promise<PrepareRewardClaimResult>
  finalizeRewardClaim(input: {
    readonly session: RunSessionRecord
    readonly claimId: string
    readonly payload: string
    readonly publicKey: string
    readonly signature: string
    readonly risk?: RiskContext
  }): Promise<FinalizeRewardClaimResult>
  getRewardClaim(claimId: string, session: RunSessionRecord): DurableRewardClaim
  getReservedRewardClaim(session: RunSessionRecord): DurableRewardClaim | null
  getVerifiedExpeditionResult(runId: string, wallet: string): VerifyExpeditionResult
  getRun(runId: string): DurableExpeditionRun | null
  getWalletDailyStatus(wallet: string): WalletDailyStatus
  issueWalletRecoveryChallenge(wallet: string, risk?: RiskContext): Promise<WalletRecoveryChallengeResponse>
  authorizeWalletRecovery(input: { readonly payload: string; readonly publicKey: string; readonly signature: string; readonly risk?: RiskContext }): Promise<WalletRecoveryAuthorizationResult>
  authenticateWalletRecoverySession(raw: string): WalletRecoverySessionRecord
  recoverRunSession(runId: string, recovery: WalletRecoverySessionRecord): RunSessionRecoveryResult
  getRewardClaimForWallet(claimId: string, session: WalletRecoverySessionRecord): DurableRewardClaim
  getReservedRewardClaimForWallet(session: WalletRecoverySessionRecord): DurableRewardClaim | null
  snapshot(): MemoryProofSnapshot
}

export type ProofService = {
  registerBlueprint(blueprint: ExpeditionBlueprint): Promise<void>
  publishBlueprint(blueprintId: string): Promise<void>
  retireBlueprint(blueprintId: string): Promise<void>
  getPublishedBlueprint(dayKey: string, mission: MissionType): Promise<ExpeditionBlueprint | null>
  issueStartChallenge(wallet: string, mission: MissionType, risk?: RiskContext): Promise<StartChallengeResponse>
  authorizeStart(input: { readonly payload: string; readonly publicKey: string; readonly signature: string; readonly risk?: RiskContext }): Promise<StartAuthorizationResult>
  authenticateSession(raw: string): Promise<RunSessionRecord>
  getActiveExpedition(runId: string, session: RunSessionRecord): Promise<ProductActiveExpedition>
  markGameplayStarted(runId: string, session: RunSessionRecord): Promise<ProductGameplayStartResponse>
  appendCheckpoint(input: {
    readonly runId: string
    readonly session: RunSessionRecord
    readonly previousCheckpointHash: string
    readonly actions: readonly ReplayAction[]
  }): Promise<CheckpointAcknowledgement>
  verifyExpedition(input: {
    readonly runId: string
    readonly session: RunSessionRecord
    readonly checkpointHash: string
  }): Promise<VerifyExpeditionResult>
  abandonExpedition(input: {
    readonly runId: string
    readonly session: RunSessionRecord
    readonly checkpointHash: string
  }): Promise<AbandonExpeditionResult>
  prepareVaultSeal(runId: string, session: RunSessionRecord): Promise<PreparedProductVaultSeal>
  verifyVaultSeal(input: {
    readonly session: RunSessionRecord
    readonly payload: string
    readonly publicKey: string
    readonly signature: string
  }): Promise<VerifiedProductVaultSeal>
  prepareRewardClaim(runId: string, session: RunSessionRecord, risk?: RiskContext): Promise<PrepareRewardClaimResult>
  finalizeRewardClaim(input: {
    readonly session: RunSessionRecord
    readonly claimId: string
    readonly payload: string
    readonly publicKey: string
    readonly signature: string
    readonly risk?: RiskContext
  }): Promise<FinalizeRewardClaimResult>
  getRewardClaim(claimId: string, session: RunSessionRecord): Promise<DurableRewardClaim>
  getReservedRewardClaim(session: RunSessionRecord): Promise<DurableRewardClaim | null>
  getVerifiedExpeditionResult(runId: string, wallet: string): Promise<VerifyExpeditionResult>
  getRun(runId: string): Promise<DurableExpeditionRun | null>
  getWalletDailyStatus(wallet: string): Promise<WalletDailyStatus>
  issueWalletRecoveryChallenge(wallet: string, risk?: RiskContext): Promise<WalletRecoveryChallengeResponse>
  authorizeWalletRecovery(input: { readonly payload: string; readonly publicKey: string; readonly signature: string; readonly risk?: RiskContext }): Promise<WalletRecoveryAuthorizationResult>
  authenticateWalletRecoverySession(raw: string): Promise<WalletRecoverySessionRecord>
  recoverRunSession(runId: string, recovery: WalletRecoverySessionRecord): Promise<RunSessionRecoveryResult>
  getRewardClaimForWallet(claimId: string, session: WalletRecoverySessionRecord): Promise<DurableRewardClaim>
  getReservedRewardClaimForWallet(session: WalletRecoverySessionRecord): Promise<DurableRewardClaim | null>
  snapshot(): Promise<MemoryProofSnapshot>
}

export type ExpeditionProofService = MemoryProofService | ProofService
