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
export const LEGACY_MAX_CHECKPOINT_BATCH_ACTIONS = 8
export const V2_MAX_CHECKPOINT_BATCH_ACTIONS = 64
/** Legacy HTTP/queue/server batch ceiling. Still exactly 8; never reinterpreted as V2. */
export const MAX_CHECKPOINT_BATCH_ACTIONS = LEGACY_MAX_CHECKPOINT_BATCH_ACTIONS
export const MAX_UNACKNOWLEDGED_ACTIONS = 16
export const MAX_TRANSCRIPT_BODY_BYTES = 16 * 1024
export const TIMED_HAZARD_TICK_MS = 750

export function maxCheckpointBatchActionsFor(input: {
  readonly rulesVersion: string
  readonly roomVersion: string
  readonly blueprintVersion: string
}): number {
  return input.rulesVersion === 'nimhunt-angkor-v2-rules-v1'
    && input.roomVersion === 'angkor-nine-stages-v1'
    && input.blueprintVersion === 'angkor-expedition-blueprint-v1'
    ? V2_MAX_CHECKPOINT_BATCH_ACTIONS
    : LEGACY_MAX_CHECKPOINT_BATCH_ACTIONS
}

// Angkor V2 is a distinct rules/room/blueprint family. Historical constants and
// allowlists above continue to mean exactly the legacy single-room protocol.
export type RulesVersion = typeof RULES_VERSION | 'nimhunt-angkor-v2-rules-v1'
export type RoomVersion = typeof ROOM_VERSION | 'angkor-nine-stages-v1'
export type BlueprintVersion = typeof SUPPORTED_BLUEPRINT_VERSIONS[number] | 'angkor-expedition-blueprint-v1'
