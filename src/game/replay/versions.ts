export const REPLAY_VERSION = 1 as const
export const TRANSCRIPT_VERSION = 1 as const
export const CHECKPOINT_VERSION = 1 as const
export const ACTION_BATCH_VERSION = 1 as const
export const CLAIM_VERSION = 1 as const

export const RULES_VERSION = 'nimhunt-rules-v1' as const
export const ROOM_VERSION = 'angkor-room-01-v1' as const
export const BLUEPRINT_VERSION_V1 = 'angkor-blueprint-v1' as const
export const BLUEPRINT_VERSION_V2 = 'angkor-blueprint-v2' as const
export const BLUEPRINT_VERSION = BLUEPRINT_VERSION_V2

export const SUPPORTED_BLUEPRINT_VERSIONS = [
  BLUEPRINT_VERSION_V1,
  BLUEPRINT_VERSION_V2,
] as const

export function isSupportedBlueprintVersion(version: string): version is BlueprintVersion {
  return (SUPPORTED_BLUEPRINT_VERSIONS as readonly string[]).includes(version)
}

export const MAX_ACCEPTED_ACTIONS = 256
export const MAX_CHECKPOINT_BATCH_ACTIONS = 8
export const MAX_UNACKNOWLEDGED_ACTIONS = 16
export const MAX_TRANSCRIPT_BODY_BYTES = 16 * 1024
export const TIMED_HAZARD_TICK_MS = 750

export type RulesVersion = typeof RULES_VERSION
export type RoomVersion = typeof ROOM_VERSION
export type BlueprintVersion = typeof SUPPORTED_BLUEPRINT_VERSIONS[number]
