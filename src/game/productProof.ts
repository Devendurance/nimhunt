import type { Direction } from './world/grid.ts'

export type ProductProofBridge = {
  canAcceptMove(): boolean
  recordAcceptedMove(direction: Direction): void
  notifyGameplayEvent(event: 'MISSION_COMPLETE' | 'DEATH' | 'VAULT_REACHED'): void
}
