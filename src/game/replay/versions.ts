export const REPLAY_VERSION = 1 as const
export const TRANSCRIPT_VERSION = 1 as const
export const CHECKPOINT_VERSION = 1 as const
export const ACTION_BATCH_VERSION = 1 as const
export const CLAIM_VERSION = 1 as const

export const RULES_VERSION = 'nimhunt-rules-v1' as const
export const ROOM_VERSION = 'angkor-room-01-v1' as const
export const BLUEPRINT_VERSION = 'angkor-blueprint-v1' as const

export const MAX_ACCEPTED_ACTIONS = 256
export const MAX_CHECKPOINT_BATCH_ACTIONS = 8
export const MAX_UNACKNOWLEDGED_ACTIONS = 16
export const MAX_TRANSCRIPT_BODY_BYTES = 16 * 1024

export type RulesVersion = typeof RULES_VERSION
export type RoomVersion = typeof ROOM_VERSION
export type BlueprintVersion = typeof BLUEPRINT_VERSION
