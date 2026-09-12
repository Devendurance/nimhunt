import type { VerifyExpeditionResult } from '../../domain/expeditionProof.ts'
import type { MissionType } from '../../game/domain/mission.ts'

export type RememberedProductTerminal = {
  readonly runId: string
  readonly mission: MissionType
  readonly result: VerifyExpeditionResult
}

let remembered: RememberedProductTerminal | null = null

export function rememberProductTerminal(mission: MissionType, result: VerifyExpeditionResult): void {
  if (result.outcome !== 'VERIFIED_ELIGIBLE' && result.outcome !== 'VAULT_GAMEPLAY_VERIFIED') return
  remembered = { runId: result.runId, mission, result }
}

export function getRememberedProductTerminal(mission: MissionType, runId: string): RememberedProductTerminal | null {
  if (!remembered || remembered.mission !== mission || remembered.runId !== runId) return null
  return remembered
}

export function retainProductTerminalFor(mission: MissionType, runId: string): void {
  if (!remembered) return
  if (remembered.mission !== mission || remembered.runId !== runId) remembered = null
}

export function clearRememberedProductTerminal(): void {
  remembered = null
}
