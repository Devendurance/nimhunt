import type {
  CheckpointAcknowledgement,
  ProductActiveExpedition,
  ProductGameplayStartResponse,
  StartChallengeResponse,
  StartResult,
} from '../../src/domain/expeditionProof.ts'
import type { WalletDailyStatus } from '../../src/domain/dailyLedger.ts'
import type { ExpeditionBlueprint, ExpeditionCheckpoint, MissionType, MoveAction, ReplayState } from '../../src/game/replay/types.ts'
import type { Clock } from '../ledger/types.ts'
import type { RunSessionRecord } from './session.ts'

export type { Clock }

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
  readonly actions: readonly MoveAction[]
  readonly batchFingerprint: string
  readonly transcriptHash: string
  readonly stateHash: string
  readonly checkpointHash: string
  readonly acknowledgement: CheckpointAcknowledgement
}

export type DurableExpeditionRun = {
  readonly runId: string
  readonly dayKey: string
  readonly wallet: string
  readonly mission: MissionType
  readonly status: 'STARTED'
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
  readonly actions: readonly MoveAction[]
  readonly batches: readonly DurableCheckpointBatch[]
}

export type StartAuthorizationResult = {
  readonly outcome: 'START_CREATED' | 'START_ALREADY_CREATED'
  readonly start: StartResult
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
  issueStartChallenge(wallet: string, mission: MissionType): Promise<StartChallengeResponse>
  authorizeStart(input: { readonly payload: string; readonly publicKey: string; readonly signature: string }): Promise<StartAuthorizationResult>
  authenticateSession(raw: string): RunSessionRecord
  getActiveExpedition(runId: string, session: RunSessionRecord): ProductActiveExpedition
  markGameplayStarted(runId: string, session: RunSessionRecord): ProductGameplayStartResponse
  appendCheckpoint(input: {
    readonly runId: string
    readonly session: RunSessionRecord
    readonly previousCheckpointHash: string
    readonly actions: readonly MoveAction[]
  }): Promise<CheckpointAcknowledgement>
  getRun(runId: string): DurableExpeditionRun | null
  getWalletDailyStatus(wallet: string): WalletDailyStatus
  snapshot(): MemoryProofSnapshot
}
