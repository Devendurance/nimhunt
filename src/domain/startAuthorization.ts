import type { MissionType } from '../game/replay/types.js'

export const START_EXPEDITION_VERSION = 1 as const
export const START_EXPEDITION_TYPE = 'NIMHUNT_START_EXPEDITION' as const

export type StartExpeditionPayload = {
  readonly version: typeof START_EXPEDITION_VERSION
  readonly type: typeof START_EXPEDITION_TYPE
  readonly wallet: string
  readonly mission: MissionType
  readonly dayKey: string
  readonly challenge: string
  readonly blueprintId: string
  readonly blueprintHash: string
}

export function serializeStartPayload(payload: StartExpeditionPayload): string {
  return JSON.stringify({
    version: payload.version,
    type: payload.type,
    wallet: payload.wallet,
    mission: payload.mission,
    dayKey: payload.dayKey,
    challenge: payload.challenge,
    blueprintId: payload.blueprintId,
    blueprintHash: payload.blueprintHash,
  }, null, 2)
}
