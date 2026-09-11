import { hashBlueprint } from '../../src/game/replay/canonical.ts'
import type { ExpeditionBlueprint, MissionType, MoveAction } from '../../src/game/replay/types.ts'

/**
 * Frozen day key used only to pin Room 01 bootstrap template hashes.
 * Canonical `hashBlueprint()` includes `dayKey`, so the published daily hash
 * changes every UTC day even when the built-in Room 01 content does not.
 * Runtime still attaches the real daily hash; the fast path compares this
 * frozen-day canonical hash against the checked-in constants below.
 */
export const ROOM_01_BOOTSTRAP_TEMPLATE_DAY_KEY = '1970-01-01' as const

export const ROOM_01_BOOTSTRAP_MISSIONS = ['gem-runner', 'chest-hunter', 'vault-breaker'] as const
export type Room01BootstrapMission = (typeof ROOM_01_BOOTSTRAP_MISSIONS)[number]

/**
 * Canonical `hashBlueprint()` values for the immutable Room 01 bootstrap
 * templates at `ROOM_01_BOOTSTRAP_TEMPLATE_DAY_KEY`.
 *
 * Update only after `validateExpeditionBlueprint()` proves the edited
 * template is solvable and the stored winning sequence still replays.
 */
export const PREVALIDATED_ROOM_01_BOOTSTRAP_TEMPLATE_HASHES = {
  'gem-runner': '9f7a3ead3fdcdb1539c37427ba50b25d03237bf40f9685b19fec76db301fe547',
  'chest-hunter': '34fa27966d0189b43c2c563cead0fa5c380f541a909a5f290d5d59a1c8a29008',
  'vault-breaker': '9c2aebb8d443f2772c1f2055b09f01a8045e4e509a892113176d11ec3b5eb302',
} as const satisfies Readonly<Record<Room01BootstrapMission, string>>

/**
 * Compact U/D/L/R encodings of the deterministic BFS winning sequences for
 * the current built-in templates. Runtime publication never trusts these;
 * tests replay them and require the live solver to produce the same path.
 */
export const PREVALIDATED_ROOM_01_BOOTSTRAP_WINNING_SEQUENCES = {
  'gem-runner': 'LUULDDDDDDDRRRR',
  'chest-hunter': 'LULDRRRRDDLDLRURUURRRRR',
  'vault-breaker': 'RRDDLDLRURUURRRR',
} as const satisfies Readonly<Record<Room01BootstrapMission, string>>

const TEMPLATE_HASH_PATTERN = /^[0-9a-f]{64}$/

export function hashRoom01BootstrapTemplate(blueprint: ExpeditionBlueprint): string {
  return hashBlueprint({
    ...blueprint,
    dayKey: ROOM_01_BOOTSTRAP_TEMPLATE_DAY_KEY,
    blueprintHash: '',
  })
}

export function isPrevalidatedRoom01Bootstrap(blueprint: ExpeditionBlueprint): boolean {
  const expected = expectedTemplateHash(blueprint.mission)
  if (!expected) return false
  return hashRoom01BootstrapTemplate(blueprint) === expected
}

export function decodeRoom01BootstrapWinningSequence(encoded: string): readonly MoveAction[] {
  const actions: MoveAction[] = []
  for (let index = 0; index < encoded.length; index += 1) {
    actions.push({ seq: index + 1, type: 'MOVE', direction: directionFromCode(encoded[index]!) })
  }
  return actions
}

function expectedTemplateHash(mission: MissionType): string | undefined {
  if (!isRoom01BootstrapMission(mission)) return undefined
  const expected = PREVALIDATED_ROOM_01_BOOTSTRAP_TEMPLATE_HASHES[mission]
  return TEMPLATE_HASH_PATTERN.test(expected) ? expected : undefined
}

function isRoom01BootstrapMission(mission: MissionType): mission is Room01BootstrapMission {
  return (ROOM_01_BOOTSTRAP_MISSIONS as readonly string[]).includes(mission)
}

function directionFromCode(code: string): MoveAction['direction'] {
  if (code === 'U') return 'UP'
  if (code === 'D') return 'DOWN'
  if (code === 'L') return 'LEFT'
  if (code === 'R') return 'RIGHT'
  throw new Error('INVALID_WINNING_SEQUENCE')
}
