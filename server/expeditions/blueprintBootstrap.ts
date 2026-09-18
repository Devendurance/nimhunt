import { createRoom01Blueprint } from '../../src/game/world/room01.ts'
import { createDailyAngkorBlueprint } from '../../src/game/world/dailyAngkorLayouts.ts'
import { hashBlueprint } from '../../src/game/replay/canonical.ts'
import type { ExpeditionBlueprint, MissionType } from '../../src/game/replay/types.ts'

/** Built-in Room 01 templates. Publication may skip BFS only on exact prevalidated template hash match. */
export function createBootstrapBlueprint(dayKey: string, mission: MissionType): ExpeditionBlueprint {
  const blueprint = createRoom01Blueprint(dayKey, mission, `bootstrap-${dayKey}-${mission}`)
  return { ...blueprint, blueprintHash: hashBlueprint(blueprint) }
}

export function createBootstrapBlueprints(dayKey: string): readonly ExpeditionBlueprint[] {
  return (['gem-runner', 'chest-hunter', 'vault-breaker'] as const).map(mission => createBootstrapBlueprint(dayKey, mission))
}

export function createPublishedBootstrapBlueprint(dayKey: string, mission: MissionType): ExpeditionBlueprint {
  return { ...createBootstrapBlueprint(dayKey, mission), status: 'PUBLISHED' }
}

export function createPublishedBootstrapBlueprints(dayKey: string): readonly ExpeditionBlueprint[] {
  return (['gem-runner', 'chest-hunter', 'vault-breaker'] as const)
    .map(mission => createPublishedBootstrapBlueprint(dayKey, mission))
}

export function createDailyPublishedBlueprint(dayKey: string, mission: MissionType): ExpeditionBlueprint {
  const blueprint = createDailyAngkorBlueprint(dayKey, mission, undefined, undefined, hashBlueprint)
  return { ...blueprint, status: 'PUBLISHED' }
}

export function createDailyPublishedBlueprints(dayKey: string): readonly ExpeditionBlueprint[] {
  return (['gem-runner', 'chest-hunter', 'vault-breaker'] as const)
    .map(mission => createDailyPublishedBlueprint(dayKey, mission))
}
