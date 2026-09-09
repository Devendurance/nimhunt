import { clampHP, MAX_HP, type PlayerRunState } from '../domain/runState.ts'
import { evaluateMission, type MissionType } from '../domain/mission.ts'
import type { ItemState } from './items.ts'
import type { GridCoord } from '../world/grid.ts'

export type ChestState = 'CLOSED' | 'OPEN'
export type ChestLootType = 'GEMS' | 'POTION' | 'SWORD' | 'TRAP' | 'EMPTY'

export const CHEST_GEM_AMOUNT = 2
export const CHEST_POTION_HEAL = 25
export const CHEST_TRAP_DAMAGE = 30

export interface ChestPlacement extends GridCoord {
  readonly id: string
  readonly loot: ChestLootType
}

export interface ChestInstance extends GridCoord {
  readonly id: string
  readonly loot: ChestLootType
  readonly state: ChestState
  readonly resolved: boolean
}

export function createChestStates(placements: readonly ChestPlacement[]): ChestInstance[] {
  return placements.map(p => ({ id: p.id, x: p.x, y: p.y, loot: p.loot, state: 'CLOSED' as ChestState, resolved: false }))
}

export function getChestAt(chests: readonly ChestInstance[], coord: GridCoord): ChestInstance | undefined {
  return chests.find(c => c.x === coord.x && c.y === coord.y)
}

export interface OpenChestResult {
  readonly nextRun: PlayerRunState
  readonly nextItems: ItemState
  readonly nextChests: readonly ChestInstance[]
  readonly opened: boolean
  readonly notice: string
}

export function openChest(
  run: PlayerRunState,
  items: ItemState,
  chests: readonly ChestInstance[],
  chestId: string,
  mission: MissionType = 'gem-runner',
): OpenChestResult {
  const chest = chests.find(c => c.id === chestId)
  if (!chest || chest.state !== 'CLOSED' || chest.resolved || run.runStatus !== 'PLAYING') {
    return { nextRun: run, nextItems: items, nextChests: chests, opened: false, notice: '' }
  }

  const openedChestIds = [...(run.openedChestIds ?? []), chest.id]
  const chestsOpened = (run.chestsOpened ?? 0) + 1
  const nextChests = chests.map(c => (c.id === chest.id ? { ...c, state: 'OPEN' as ChestState, resolved: true } : c))

  let nextRun: PlayerRunState = { ...run, chestsOpened, openedChestIds }
  let nextItems: ItemState = items
  let notice = ''

  switch (chest.loot) {
    case 'GEMS': {
      nextRun = { ...nextRun, gemsCollected: nextRun.gemsCollected + CHEST_GEM_AMOUNT }
      notice = 'Found 2 gems.'
      break
    }
    case 'POTION': {
      const heal = Math.min(CHEST_POTION_HEAL, MAX_HP - nextRun.hp)
      nextRun = { ...nextRun, hp: clampHP(nextRun.hp + heal) }
      notice = `HP restored +${heal}.`
      break
    }
    case 'SWORD': {
      nextItems = { ...items, hasSword: true }
      notice = 'Ancient Blade found.'
      break
    }
    case 'TRAP': {
      nextRun = { ...nextRun, hp: clampHP(nextRun.hp - CHEST_TRAP_DAMAGE) }
      notice = 'It was trapped! -30 HP'
      break
    }
    case 'EMPTY': {
      notice = 'Nothing but dust.'
      break
    }
  }

  nextRun = evaluateMission(nextRun, mission)
  return { nextRun, nextItems, nextChests, opened: true, notice }
}
