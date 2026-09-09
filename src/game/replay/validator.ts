import { CHEST_HUNTER_TARGET, GEM_RUNNER_TARGET } from '../domain/mission.ts'
import { CHEST_GEM_AMOUNT } from '../systems/chests.ts'
import { getTileAt, isWalkableTile } from '../world/grid.ts'
import { ANGKOR_ROOM_01 } from '../world/room01.ts'
import { hashBlueprint, serializeReplayState } from './canonical.ts'
import { advanceRun, createInitialRun, type InitialRunInput } from './engine.ts'
import {
  MAX_ACCEPTED_ACTIONS,
  BLUEPRINT_VERSION,
  ROOM_VERSION,
  RULES_VERSION,
} from './versions.ts'
import type { ExpeditionBlueprint, MoveAction, ReplayState } from './types.ts'

export type BlueprintValidationReason =
  | 'INVALID_BLUEPRINT_HASH'
  | 'INVALID_GEOMETRY'
  | 'UNSUPPORTED_RULES_VERSION'
  | 'UNSUPPORTED_ROOM_VERSION'
  | 'UNSUPPORTED_BLUEPRINT_VERSION'
  | 'ACTION_LIMIT_EXCEEDED'
  | 'NO_WINNING_SEQUENCE'

export type BlueprintValidationResult =
  | { readonly valid: true; readonly winningSequence: readonly MoveAction[] }
  | { readonly valid: false; readonly reason: BlueprintValidationReason }

const DIRECTIONS: readonly MoveAction['direction'][] = ['UP', 'DOWN', 'LEFT', 'RIGHT']

export function isSupportedRulesV1Blueprint(blueprint: ExpeditionBlueprint): boolean {
  return blueprint.rulesVersion === RULES_VERSION
    && blueprint.roomVersion === ROOM_VERSION
    && blueprint.blueprintVersion === BLUEPRINT_VERSION
    && blueprint.goblins.length === 1
    && blueprint.timedHazards.length === 0
    && blueprint.missionParameters.gemTarget === GEM_RUNNER_TARGET
    && blueprint.missionParameters.chestTarget === CHEST_HUNTER_TARGET
}

export function validateExpeditionBlueprint(
  blueprint: ExpeditionBlueprint,
  options: { readonly maxActions?: number } = {},
): BlueprintValidationResult {
  if (blueprint.rulesVersion !== RULES_VERSION) return { valid: false, reason: 'UNSUPPORTED_RULES_VERSION' }
  if (blueprint.roomVersion !== ROOM_VERSION) return { valid: false, reason: 'UNSUPPORTED_ROOM_VERSION' }
  if (blueprint.blueprintVersion !== BLUEPRINT_VERSION) return { valid: false, reason: 'UNSUPPORTED_BLUEPRINT_VERSION' }
  if (!isSupportedRulesV1Blueprint(blueprint)) return { valid: false, reason: 'UNSUPPORTED_RULES_VERSION' }
  if (blueprint.blueprintHash !== hashBlueprint(blueprint)) return { valid: false, reason: 'INVALID_BLUEPRINT_HASH' }
  if (!hasValidGeometry(blueprint)) return { valid: false, reason: 'INVALID_GEOMETRY' }
  if (!hasEnoughPotentialObjectiveProgress(blueprint)) return { valid: false, reason: 'NO_WINNING_SEQUENCE' }

  const maxActions = options.maxActions ?? MAX_ACCEPTED_ACTIONS
  const initialInput: InitialRunInput = {
    mission: blueprint.mission,
    rulesVersion: blueprint.rulesVersion,
    roomVersion: blueprint.roomVersion,
    blueprint,
  }
  const initial = createInitialRun(initialInput)
  const queue: Array<{ readonly state: ReplayState; readonly actions: readonly MoveAction[] }> = [{ state: initial, actions: [] }]
  const visited = new Set<string>([stateSearchKey(initial)])
  let reachedActionLimit = false
  while (queue.length > 0) {
    const current = queue.shift()!
    if (isWinningState(current.state)) return { valid: true, winningSequence: current.actions }
    if (current.state.seq >= maxActions) {
      reachedActionLimit = true
      continue
    }

    for (const direction of DIRECTIONS) {
      const action: MoveAction = { seq: current.state.seq + 1, type: 'MOVE', direction }
      const next = advanceRun(current.state, action)
      if (!next.accepted) {
        continue
      }
      const key = stateSearchKey(next.state)
      if (visited.has(key)) continue
      visited.add(key)
      queue.push({ state: next.state, actions: [...current.actions, action] })
    }
  }

  return { valid: false, reason: reachedActionLimit ? 'ACTION_LIMIT_EXCEEDED' : 'NO_WINNING_SEQUENCE' }
}

function isWinningState(state: ReplayState): boolean {
  if (state.run.hp <= 0) return false
  if (state.mission === 'gem-runner') return state.run.gemsCollected >= state.blueprint.missionParameters.gemTarget
  if (state.mission === 'chest-hunter') return state.run.chestsOpened >= state.blueprint.missionParameters.chestTarget
  return state.puzzle.objectiveReached && state.puzzle.hasTempleKey && state.puzzle.gateState === 'OPEN'
}

function hasEnoughPotentialObjectiveProgress(blueprint: ExpeditionBlueprint): boolean {
  const beforeGate = reachableTiles(blueprint, false)
  const keyIsReachable = beforeGate.has(tileKey(blueprint.key))
  const reachable = keyIsReachable ? reachableTiles(blueprint, true) : beforeGate

  if (blueprint.mission === 'gem-runner') {
    const gemCount = blueprint.gems.filter(gem => reachable.has(tileKey(gem))).length
    const chestGems = blueprint.chests.filter(chest => chest.loot === 'GEMS' && reachable.has(tileKey(chest))).length * CHEST_GEM_AMOUNT
    return gemCount + chestGems >= blueprint.missionParameters.gemTarget
  }
  if (blueprint.mission === 'chest-hunter') {
    return blueprint.chests.filter(chest => reachable.has(tileKey(chest))).length >= blueprint.missionParameters.chestTarget
  }
  return keyIsReachable && reachable.has(tileKey(blueprint.objective))
}

function reachableTiles(blueprint: ExpeditionBlueprint, gateOpen: boolean): Set<string> {
  const visited = new Set<string>()
  const queue = [blueprint.spawn]

  while (queue.length > 0) {
    const current = queue.shift()!
    const currentKey = tileKey(current)
    if (visited.has(currentKey)) continue
    if (!isWalkableTile(getTileAt(ANGKOR_ROOM_01, current))) continue
    if (!gateOpen && currentKey === tileKey(blueprint.gate)) continue
    visited.add(currentKey)

    for (const direction of ['UP', 'DOWN', 'LEFT', 'RIGHT'] as const) {
      const next = {
        x: current.x + (direction === 'LEFT' ? -1 : direction === 'RIGHT' ? 1 : 0),
        y: current.y + (direction === 'UP' ? -1 : direction === 'DOWN' ? 1 : 0),
      }
      if (!visited.has(tileKey(next))) queue.push(next)
    }
  }

  return visited
}

function tileKey(coord: { readonly x: number; readonly y: number }): string {
  return `${coord.x},${coord.y}`
}

function hasValidGeometry(blueprint: ExpeditionBlueprint): boolean {
  const coordinates: Array<{ readonly x: number; readonly y: number }> = [
    blueprint.spawn,
    ...blueprint.goblins.map(goblin => goblin.spawn),
    ...blueprint.gems,
    ...blueprint.chests,
    ...blueprint.hazards,
    ...blueprint.boulders,
    blueprint.key,
    blueprint.gate,
    blueprint.objective,
  ]
  if (blueprint.sword) coordinates.push(blueprint.sword)
  if (blueprint.potion) coordinates.push(blueprint.potion)
  if (coordinates.some(coord => !Number.isInteger(coord.x) || !Number.isInteger(coord.y) || !isWalkableTile(getTileAt(ANGKOR_ROOM_01, coord)))) return false
  if (blueprint.goblins.some(goblin => goblin.patrolRoute.some(coord => !Number.isInteger(coord.x) || !Number.isInteger(coord.y) || !isWalkableTile(getTileAt(ANGKOR_ROOM_01, coord))))) return false

  const ids = [
    ...blueprint.goblins.map(goblin => goblin.id),
    ...blueprint.gems.map(gem => gem.id),
    ...blueprint.chests.map(chest => chest.id),
    ...blueprint.boulders.map(boulder => boulder.id),
  ]
  if (new Set(ids).size !== ids.length) return false
  if (new Set(coordinates.map(coord => `${coord.x},${coord.y}`)).size !== coordinates.length) return false
  return blueprint.goblins.every(goblin => goblin.patrolRoute.length > 0)
}

function stateSearchKey(state: ReplayState): string {
  return serializeReplayState({ ...state, seq: 0 })
}
