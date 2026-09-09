import type { StartChallengeResponse, StartResult } from '../../src/domain/expeditionProof.ts'
import type { ExpeditionBlueprint, ExpeditionCheckpoint, MissionType, ReplayState } from '../../src/game/replay/types.ts'
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

export type DurableExpeditionRun = {
  readonly runId: string
  readonly dayKey: string
  readonly wallet: string
  readonly mission: MissionType
  readonly status: 'STARTED'
  readonly startedAt: string
  readonly expiresAt: string
  readonly runChallenge: string
  readonly blueprint: ExpeditionBlueprint
  readonly state: ReplayState
  readonly checkpoint: ExpeditionCheckpoint
  readonly initialStateHash: string
  readonly initialTranscriptHash: string
  readonly initialCheckpointHash: string
  readonly checkpointHash: string
  readonly seq: number
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
  getRun(runId: string): DurableExpeditionRun | null
  getWalletDailyStatus(wallet: string): { readonly dayKey: string; readonly expeditionsStarted: number; readonly expeditionsRemaining: number }
  snapshot(): MemoryProofSnapshot
}
