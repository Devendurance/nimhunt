import { evaluateMission, type MissionType } from '../domain/mission.js'
import { createRunState } from '../domain/runState.js'
import { ANGKOR_ROOM_01 } from '../world/room01.js'
import { commitPuzzleMove, createPuzzleState, resolvePuzzleMove, sameTile, type PuzzleObjects } from '../systems/puzzle.js'
import { createChestStates, getChestAt, openChest } from '../systems/chests.js'
import { createGoblinState, resolveGoblinCombat, stepGoblin } from '../systems/goblin.js'
import { checkPotionConsumption, checkSwordPickup, createInitialItemState } from '../systems/items.js'
import {
  MAX_ACCEPTED_ACTIONS,
  ROOM_VERSION,
  RULES_VERSION,
  type RoomVersion,
  type RulesVersion,
} from './versions.js'
import type {
  ExpeditionBlueprint,
  ReplayAction,
  ReplayState,
} from './types.js'

export type StepRunResult = {
  readonly accepted: boolean
  readonly state: ReplayState
  readonly reason?: string
}

export type ReplayAdvanceResult = {
  readonly accepted: boolean
  readonly state: ReplayState
  readonly reason?: string
}

export type InitialRunInput = {
  readonly rulesVersion: RulesVersion
  readonly roomVersion: RoomVersion
  readonly mission: MissionType
  readonly blueprint: ExpeditionBlueprint
}

export function createInitialRun(input: InitialRunInput): ReplayState {
  if (input.rulesVersion !== RULES_VERSION || input.roomVersion !== ROOM_VERSION) {
    throw new Error('Unsupported replay version')
  }
  if (input.blueprint.rulesVersion !== input.rulesVersion || input.blueprint.roomVersion !== input.roomVersion) {
    throw new Error('Blueprint version mismatch')
  }
  if (input.blueprint.mission !== input.mission) {
    throw new Error('Blueprint mission mismatch')
  }

  const puzzleObjects: PuzzleObjects = {
    boulders: input.blueprint.boulders,
    key: input.blueprint.key,
    gate: input.blueprint.gate,
    shrine: input.blueprint.objective,
  }

  return {
    seq: 0,
    mission: input.mission,
    rulesVersion: input.rulesVersion,
    roomVersion: input.roomVersion,
    blueprintVersion: input.blueprint.blueprintVersion,
    blueprintId: input.blueprint.blueprintId,
    blueprintHash: input.blueprint.blueprintHash,
    blueprint: input.blueprint,
    player: { ...input.blueprint.spawn },
    run: createRunState(),
    items: createInitialItemState(),
    puzzle: createPuzzleState(puzzleObjects),
    chests: createChestStates(input.blueprint.chests),
    goblins: input.blueprint.goblins.map(goblin => createGoblinState(goblin.spawn)),
    collapsingBoulders: input.blueprint.timedHazards
      .filter(h => h.type === 'COLLAPSING_BOULDER')
      .map(h => ({
        id: h.id,
        state: 'ARMED',
        triggeredAtTick: null,
        elapsedTicks: 0,
        targetTicks: h.warningTicks ?? h.delay,
        collapseAtTick: h.warningTicks ?? h.delay,
      })),
  }
}

export function advanceRun(state: ReplayState, action: ReplayAction): ReplayAdvanceResult {
  if (state.run.runStatus !== 'PLAYING') return rejected(state, 'RUN_ENDED')
  if (action.seq !== state.seq + 1) return rejected(state, 'INVALID_SEQUENCE')

  // Handle simulation TICK actions (emitted while a timed hazard is WARNING)
  if (action.type === 'TICK') {
    const hasWarningHazard = (state.collapsingBoulders ?? []).some(b => b.state === 'WARNING')
    if (!hasWarningHazard) {
      return rejected(state, 'UNEXPECTED_TICK')
    }

    const nextSeq = state.seq + 1
    let nextRun = state.run
    const prevBoulders = state.collapsingBoulders ?? []
    const nextCollapsingBoulders = prevBoulders.map(b => {
      if (b.state !== 'WARNING') return b
      const target = b.targetTicks ?? 4
      const nextElapsed = b.elapsedTicks + 1
      if (nextElapsed >= target) {
        return {
          ...b,
          state: 'FALLEN' as const,
          elapsedTicks: nextElapsed,
        }
      }
      return {
        ...b,
        elapsedTicks: nextElapsed,
      }
    })

    // Check if player occupies impact cell at the moment of collapse
    for (const b of nextCollapsingBoulders) {
      const prev = prevBoulders.find(p => p.id === b.id)
      if (b.state === 'FALLEN' && prev?.state === 'WARNING') {
        const config = state.blueprint.timedHazards.find(h => h.id === b.id)
        if (config && sameTile(state.player, { x: config.x, y: config.y })) {
          nextRun = {
            ...nextRun,
            hp: 0,
            runStatus: 'FAILED',
            missionStatus: 'FAILED',
          }
        }
      }
    }

    return {
      accepted: true,
      state: {
        ...state,
        seq: nextSeq,
        run: nextRun,
        collapsingBoulders: nextCollapsingBoulders,
      },
    }
  }

  const contents = {
    gems: state.blueprint.gems,
    hazards: state.blueprint.hazards,
  }
  const puzzleObjects: PuzzleObjects = {
    boulders: state.blueprint.boulders,
    key: state.blueprint.key,
    gate: state.blueprint.gate,
    shrine: state.blueprint.objective,
  }
  const closedChestTiles = state.chests.filter(chest => chest.state === 'CLOSED').map(chest => ({ x: chest.x, y: chest.y }))

  const fallenBoulders = state.blueprint.timedHazards
    .filter(h => (state.collapsingBoulders ?? []).find(cb => cb.id === h.id)?.state === 'FALLEN')
    .map(h => ({ x: h.x, y: h.y }))

  const transition = resolvePuzzleMove(
    ANGKOR_ROOM_01,
    contents,
    puzzleObjects,
    state.run,
    state.puzzle,
    state.player,
    action.direction,
    closedChestTiles,
    state.mission,
    fallenBoulders,
  )
  if (!transition.move.success) {
    return rejected(state, transition.blockedReason ?? transition.move.reason ?? 'BLOCKED')
  }

  const committed = commitPuzzleMove(state.run, state.puzzle, transition, contents, puzzleObjects, state.mission)
  let nextRun = committed.run
  const nextPuzzle = committed.puzzle
  let nextItems = state.items
  let nextChests = state.chests
  const nextGoblins = [...state.goblins]

  // Update collapsing boulder hazards on player move
  const nextSeq = state.seq + 1
  const nextCollapsingBoulders = (state.collapsingBoulders ?? []).map(b => {
    const config = state.blueprint.timedHazards.find(h => h.id === b.id)
    if (!config) return b

    if (b.state === 'ARMED') {
      const triggerCells = config.triggerCells && config.triggerCells.length > 0
        ? config.triggerCells
        : [{ x: config.x, y: config.y }]
      const isTriggered = triggerCells.some(cell => sameTile(cell, transition.move.to))
      if (isTriggered) {
        const targetTicks = config.warningTicks ?? config.delay
        return {
          ...b,
          state: 'WARNING' as const,
          triggeredAtTick: nextSeq,
          elapsedTicks: 0,
          targetTicks,
          collapseAtTick: targetTicks,
        }
      }
      return b
    }

    return b
  })

  const sword = state.blueprint.sword
    ? checkSwordPickup(nextItems, transition.move.to, state.blueprint.sword)
    : { nextItems, collected: false, notice: '' }
  nextItems = sword.nextItems

  if (state.blueprint.potion) {
    const potion = checkPotionConsumption(nextRun, nextItems, transition.move.to, state.blueprint.potion)
    nextRun = potion.nextRun
    nextItems = potion.nextItems
  }

  const chest = getChestAt(nextChests, transition.move.to)
  if (chest && nextRun.runStatus === 'PLAYING') {
    const opened = openChest(nextRun, nextItems, nextChests, chest.id, state.mission)
    if (opened.opened) {
      nextRun = opened.nextRun
      nextItems = opened.nextItems
      nextChests = opened.nextChests
    }
  }

  const activeFallenBoulders = state.blueprint.timedHazards
    .filter(h => nextCollapsingBoulders.find(cb => cb.id === h.id)?.state === 'FALLEN')
    .map(h => ({ x: h.x, y: h.y }))

  if (nextRun.runStatus === 'PLAYING') {
    for (let index = 0; index < nextGoblins.length; index += 1) {
      const currentGoblin = nextGoblins[index]
      const config = state.blueprint.goblins[index]
      if (!currentGoblin || !config) continue

      const beforeStep = resolveGoblinCombat(nextRun, nextItems.hasSword, currentGoblin, transition.move.to)
      if (beforeStep.damageDealt > 0 || beforeStep.swordUsed) {
        nextRun = beforeStep.nextRun
        nextItems = { ...nextItems, hasSword: beforeStep.hasSword }
        nextGoblins[index] = beforeStep.nextGoblin
      }

      const activeGoblin = nextGoblins[index]
      if (!activeGoblin || activeGoblin.state === 'DEFEATED' || nextRun.runStatus !== 'PLAYING') continue
      const steppedGoblin = stepGoblin(ANGKOR_ROOM_01, nextPuzzle, activeGoblin, transition.move.to, config.patrolRoute, state.blueprint.gate, activeFallenBoulders)
      nextGoblins[index] = steppedGoblin

      const afterStep = resolveGoblinCombat(nextRun, nextItems.hasSword, steppedGoblin, transition.move.to)
      if (afterStep.damageDealt > 0 || afterStep.swordUsed) {
        nextRun = afterStep.nextRun
        nextItems = { ...nextItems, hasSword: afterStep.hasSword }
        nextGoblins[index] = afterStep.nextGoblin
      }
    }
  }

  nextRun = evaluateMission(nextRun, state.mission)
  return {
    accepted: true,
    state: {
      ...state,
      seq: nextSeq,
      player: { ...transition.move.to },
      run: nextRun,
      items: nextItems,
      puzzle: nextPuzzle,
      chests: nextChests,
      goblins: nextGoblins,
      collapsingBoulders: nextCollapsingBoulders,
    },
  }
}

export function replayActions(input: InitialRunInput, actions: readonly ReplayAction[]): ReplayState {
  if (actions.length > MAX_ACCEPTED_ACTIONS) throw new Error('ACTION_LIMIT_EXCEEDED')
  let state = createInitialRun(input)
  for (const action of actions) {
    const result = advanceRun(state, action)
    if (!result.accepted) throw new Error(result.reason ?? 'INVALID_ACTION')
    state = result.state
  }
  return state
}

function rejected(state: ReplayState, reason: string): ReplayAdvanceResult {
  return { accepted: false, state, reason }
}
