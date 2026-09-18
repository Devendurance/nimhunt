export type MissionType = 'gem-runner' | 'chest-hunter' | 'vault-breaker'
export type Direction = 'UP' | 'DOWN' | 'LEFT' | 'RIGHT'
export type HazardType = 'SPIKES' | 'POISON'
export type ChestLootType = 'GEMS' | 'POTION' | 'SWORD' | 'TRAP' | 'EMPTY'

export interface GridCoord {
  readonly x: number
  readonly y: number
}
import {
  ACTION_BATCH_VERSION,
  BLUEPRINT_VERSION,
  BLUEPRINT_VERSION_V1,
  BLUEPRINT_VERSION_V2,
  CHECKPOINT_VERSION,
  CLAIM_VERSION,
  REPLAY_VERSION,
  ROOM_VERSION,
  RULES_VERSION,
  SUPPORTED_BLUEPRINT_VERSIONS,
  TIMED_HAZARD_TICK_MS,
  TRANSCRIPT_VERSION,
  isSupportedBlueprintVersion,
  type BlueprintVersion,
  type RoomVersion,
  type RulesVersion,
} from './versions.ts'

export type BlueprintStatus = 'DRAFT' | 'VALIDATED' | 'PUBLISHED' | 'RETIRED'

export interface BlueprintGoblin {
  readonly id: string
  readonly spawn: GridCoord
  readonly patrolRoute: readonly GridCoord[]
}

export interface BlueprintGem extends GridCoord {
  readonly id: string
}

export interface BlueprintChest extends GridCoord {
  readonly id: string
  readonly loot: ChestLootType
}

export interface BlueprintHazard extends GridCoord {
  readonly type: HazardType
}

export interface BlueprintBoulder extends GridCoord {
  readonly id: string
}

export type CollapsingBoulderState = 'ARMED' | 'WARNING' | 'FALLEN'

export interface TimedHazard {
  readonly id: string
  readonly x: number
  readonly y: number
  readonly type: HazardType | 'COLLAPSING_BOULDER'
  readonly trigger: 'TURN' | 'REAL_TIME'
  readonly delay: number
  readonly triggerCells?: readonly GridCoord[]
  readonly warningTicks?: number
}

export interface ReplayCollapsingBoulderState {
  readonly id: string
  readonly state: CollapsingBoulderState
  readonly triggeredAtTick: number | null
  readonly elapsedTicks: number
  readonly targetTicks: number | null
  readonly collapseAtTick?: number | null
}


export interface MissionParameters {
  readonly gemTarget: number
  readonly chestTarget: number
}

export interface ExpeditionBlueprint {
  readonly rulesVersion: RulesVersion
  readonly roomVersion: RoomVersion
  readonly blueprintVersion: BlueprintVersion
  readonly dayKey: string
  readonly mission: MissionType
  readonly blueprintId: string
  readonly blueprintHash: string
  readonly status: BlueprintStatus
  readonly storedCanonicalJson?: string
  readonly createdAt?: string
  readonly updatedAt?: string
  readonly spawn: GridCoord
  readonly goblins: readonly BlueprintGoblin[]
  readonly gems: readonly BlueprintGem[]
  readonly chests: readonly BlueprintChest[]
  readonly sword: GridCoord | null
  readonly potion: GridCoord | null
  readonly hazards: readonly BlueprintHazard[]
  readonly boulders: readonly BlueprintBoulder[]
  readonly key: GridCoord
  readonly gate: GridCoord
  readonly objective: GridCoord
  readonly missionParameters: MissionParameters
  readonly timedHazards: readonly TimedHazard[]
}

export type MoveAction = {
  readonly seq: number
  readonly type: 'MOVE'
  readonly direction: Direction
}

export type TickAction = {
  readonly seq: number
  readonly type: 'TICK'
}

export type ReplayAction = MoveAction | TickAction

export interface ExpeditionTranscript {
  readonly version: typeof TRANSCRIPT_VERSION
  readonly runId: string
  readonly wallet: string
  readonly mission: MissionType
  readonly rulesVersion: RulesVersion
  readonly roomVersion: RoomVersion
  readonly blueprintVersion: BlueprintVersion
  readonly blueprintId: string
  readonly blueprintHash: string
  readonly actions: readonly ReplayAction[]
}

export interface ReplayState {
  readonly seq: number
  readonly blueprint: ExpeditionBlueprint
  readonly mission: MissionType
  readonly rulesVersion: RulesVersion
  readonly roomVersion: RoomVersion
  readonly blueprintVersion: BlueprintVersion
  readonly blueprintId: string
  readonly blueprintHash: string
  readonly player: GridCoord
  readonly run: ReplayRunState
  readonly items: ReplayItemState
  readonly puzzle: ReplayPuzzleState
  readonly chests: readonly ReplayChestState[]
  readonly goblins: readonly ReplayGoblinState[]
  readonly collapsingBoulders?: readonly ReplayCollapsingBoulderState[]
  readonly hazardDeadlines?: readonly DurableHazardDeadline[]
}

export type DurableHazardDeadline = {
  readonly hazardId: string
  readonly triggerSeq: number
  readonly warningStartedAt: string
  readonly collapseDeadlineAt: string
}

export interface ReplayRunState {
  readonly hp: number
  readonly gemsCollected: number
  readonly collectedGemIds: readonly string[]
  readonly chestsOpened: number
  readonly openedChestIds: readonly string[]
  readonly missionStatus: 'IN_PROGRESS' | 'COMPLETE' | 'FAILED'
  readonly runStatus: 'PLAYING' | 'MISSION_COMPLETE' | 'FAILED'
}

export interface ReplayItemState {
  readonly hasSword: boolean
  readonly swordPickedUp: boolean
  readonly potionConsumed: boolean
}

export interface ReplayPuzzleState {
  readonly hasTempleKey: boolean
  readonly gateState: 'LOCKED' | 'OPEN'
  readonly boulderPositions: readonly BlueprintBoulder[]
  readonly objectiveReached: boolean
}

export interface ReplayChestState extends BlueprintChest {
  readonly state: 'CLOSED' | 'OPEN'
  readonly resolved: boolean
}

export interface ReplayGoblinState {
  readonly gridX: number
  readonly gridY: number
  readonly facing: Direction
  readonly state: 'PATROL' | 'CHASE' | 'STUNNED' | 'DEFEATED'
  readonly patrolIndex: number
  readonly patrolDirection: 1 | -1
}

export interface ExpeditionCheckpoint {
  readonly version: typeof CHECKPOINT_VERSION
  readonly runId: string
  readonly runChallenge: string
  readonly seq: number
  readonly previousCheckpointHash: string | null
  readonly stateHash: string
  readonly transcriptHash: string
  readonly checkpointHash: string
}

export interface ExpeditionActionBatch {
  readonly version: typeof ACTION_BATCH_VERSION
  readonly runId: string
  readonly previousCheckpointHash: string | null
  readonly seqStart: number
  readonly seqEnd: number
  readonly actions: readonly ReplayAction[]
}

export interface RewardClaimPayload {
  readonly version: typeof CLAIM_VERSION
  readonly type: 'NIMHUNT_REWARD_CLAIM'
  readonly claimId: string
  readonly wallet: string
  readonly runId: string
  readonly mission: MissionType
  readonly dayKey: string
  readonly runChallenge: string
  readonly transcriptHash: string
  readonly rulesVersion: RulesVersion
  readonly roomVersion: RoomVersion
  readonly blueprintVersion: BlueprintVersion
  readonly blueprintId: string
  readonly blueprintHash: string
  readonly vaultSealHash?: string
}

export type CanonicalChest = Pick<ReplayChestState, 'id' | 'x' | 'y' | 'loot' | 'state' | 'resolved'>
export type CanonicalHazard = Pick<BlueprintHazard, 'x' | 'y' | 'type'>
export type CanonicalChestLoot = ChestLootType
export type CanonicalGoblin = ReplayGoblinState

export {
  ACTION_BATCH_VERSION,
  BLUEPRINT_VERSION,
  BLUEPRINT_VERSION_V1,
  BLUEPRINT_VERSION_V2,
  CHECKPOINT_VERSION,
  CLAIM_VERSION,
  REPLAY_VERSION,
  ROOM_VERSION,
  RULES_VERSION,
  SUPPORTED_BLUEPRINT_VERSIONS,
  TIMED_HAZARD_TICK_MS,
  TRANSCRIPT_VERSION,
  isSupportedBlueprintVersion,
}
