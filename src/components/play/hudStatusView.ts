import type { GoblinAIState } from '../../game/systems/goblin.ts'

/** Short mobile-friendly Goblin proximity label for the gameplay HUD. */
export function formatGoblinStatus(state: GoblinAIState): string {
  if (state === 'CHASE') return 'Close!'
  if (state === 'STUNNED') return 'Stunned'
  if (state === 'DEFEATED') return 'Defeated'
  return 'Patrol'
}

/** True when the HUD notice is a boulder warning/crush message needing emphasis. */
export function isWarningNotice(notice: string): boolean {
  return /tremble|get clear|falling|crush|boulder/i.test(notice)
}
