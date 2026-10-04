import type { ExpeditionBlueprint, MissionType } from '../replay/types.js'
import { hashV2, stageIds, V2_BLUEPRINT, V2_ROOM, V2_RULES } from './model.js'
import * as gemI from '../stage1/level.js'
import * as gemII from '../stage2/level.js'
import * as gemIII from '../stage3/level.js'
import * as chestI from '../chestHunter/stage1/level.js'
import * as chestII from '../chestHunter/stage2/level.js'
import * as chestIII from '../chestHunter/stage3/level.js'
import * as vaultI from '../vaultBreaker/stage1/level.js'
import * as vaultII from '../vaultBreaker/stage2/level.js'
import * as vaultIII from '../vaultBreaker/stage3/level.js'

const authoredLevels = {
  'gem-runner': [gemI, gemII, gemIII],
  'chest-hunter': [chestI, chestII, chestIII],
  'vault-breaker': [vaultI, vaultII, vaultIII],
}
/** Hash exported authored truth, including collision, triggers, timing and
 * objective constants. Functions aren't client-supplied map configuration. */
function levelHash(level: object): string {
  return hashV2('LEVEL', Object.fromEntries(Object.entries(level).filter(([, v]) => typeof v !== 'function')))
}
export function contentFor(mission: MissionType) {
  return { version: 1 as const, stages: stageIds(mission).map((id, index) => ({ id, hash: levelHash(authoredLevels[mission][index]) })) }
}
export function isV2Blueprint(blueprint: ExpeditionBlueprint): boolean {
  return Boolean(blueprint) && blueprint.rulesVersion === V2_RULES && blueprint.roomVersion === V2_ROOM && blueprint.blueprintVersion === V2_BLUEPRINT
}
export function createV2Blueprint(dayKey: string, mission: MissionType): ExpeditionBlueprint {
  const blueprint: ExpeditionBlueprint = {
    dayKey, mission, blueprintId: `angkor-v2-${dayKey}-${mission}`, blueprintHash: '', status: 'PUBLISHED',
    rulesVersion: V2_RULES, roomVersion: V2_ROOM, blueprintVersion: V2_BLUEPRINT,
    angkorV2: contentFor(mission),
    // Legacy structural fields are intentionally inert. V2 never enters the room01 engine.
    spawn: { x: 0, y: 0 }, goblins: [], gems: [], chests: [], sword: null, potion: null,
    hazards: [], boulders: [], timedHazards: [], key: { x: 0, y: 0 }, gate: { x: 0, y: 0 }, objective: { x: 0, y: 0 },
    missionParameters: { gemTarget: 0, chestTarget: 0 },
  }
  return { ...blueprint, blueprintHash: hashV2('BLUEPRINT', blueprintPayload(blueprint)) }
}
export function blueprintPayload(blueprint: ExpeditionBlueprint) {
  return { rulesVersion: blueprint.rulesVersion, roomVersion: blueprint.roomVersion, blueprintVersion: blueprint.blueprintVersion,
    dayKey: blueprint.dayKey, mission: blueprint.mission, content: blueprint.angkorV2 }
}
export function validV2Blueprint(blueprint: ExpeditionBlueprint): boolean {
  try {
  if (!blueprint || !isV2Blueprint(blueprint) || !['gem-runner', 'chest-hunter', 'vault-breaker'].includes(blueprint.mission) || !/^\d{4}-\d{2}-\d{2}$/.test(blueprint.dayKey)) return false
  const expected = createV2Blueprint(blueprint.dayKey, blueprint.mission)
  return isV2Blueprint(blueprint) && blueprint.blueprintId === expected.blueprintId && blueprint.blueprintHash === expected.blueprintHash
    && hashV2('BLUEPRINT', blueprintPayload(blueprint)) === expected.blueprintHash
    && blueprint.spawn.x === 0 && blueprint.spawn.y === 0 && blueprint.goblins.length === 0 && blueprint.gems.length === 0
    && blueprint.chests.length === 0 && blueprint.hazards.length === 0 && blueprint.boulders.length === 0 && blueprint.timedHazards.length === 0
    && blueprint.sword === null && blueprint.potion === null && blueprint.key.x === 0 && blueprint.key.y === 0
    && blueprint.gate.x === 0 && blueprint.gate.y === 0 && blueprint.objective.x === 0 && blueprint.objective.y === 0
    && blueprint.missionParameters.gemTarget === 0 && blueprint.missionParameters.chestTarget === 0
  } catch { return false }
}
