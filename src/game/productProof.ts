import type { Direction } from './world/grid.js'

export type ProductProofBridge = {
  canAcceptMove(): boolean
  recordAcceptedMove(direction: Direction): void
  recordAcceptedTick(): void
  notifyGameplayEvent(event: 'MISSION_COMPLETE' | 'DEATH' | 'VAULT_REACHED'): void
}
