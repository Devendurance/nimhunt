import { clampHP, MAX_HP, type PlayerRunState } from '../domain/runState.ts'
import { sameTile } from './puzzle.ts'
import type { GridCoord } from '../world/grid.ts'

export const POTION_HEAL_AMOUNT = 25

export interface ItemState {
  readonly hasSword: boolean
  readonly swordPickedUp: boolean
  readonly potionConsumed: boolean
}

export function createInitialItemState(): ItemState {
  return {
    hasSword: false,
    swordPickedUp: false,
    potionConsumed: false,
  }
}

export function checkSwordPickup(
  itemState: ItemState,
  playerPos: GridCoord,
  swordCoord: GridCoord
): { nextItems: ItemState; collected: boolean; notice: string } {
  if (itemState.swordPickedUp || !sameTile(playerPos, swordCoord)) {
    return { nextItems: itemState, collected: false, notice: '' }
  }

  return {
    nextItems: {
      ...itemState,
      hasSword: true,
      swordPickedUp: true,
    },
    collected: true,
    notice: 'Sword acquired.',
  }
}

export function checkPotionConsumption(
  playerRun: PlayerRunState,
  itemState: ItemState,
  playerPos: GridCoord,
  potionCoord: GridCoord
): {
  nextRun: PlayerRunState
  nextItems: ItemState
  consumed: boolean
  healedAmount: number
  notice: string
} {
  // Potion must be available, player must be on the potion tile, and player must need healing
  if (
    itemState.potionConsumed ||
    !sameTile(playerPos, potionCoord) ||
    playerRun.hp >= MAX_HP
  ) {
    return {
      nextRun: playerRun,
      nextItems: itemState,
      consumed: false,
      healedAmount: 0,
      notice: '',
    }
  }

  const healedAmount = Math.min(POTION_HEAL_AMOUNT, MAX_HP - playerRun.hp)
  const nextHp = clampHP(playerRun.hp + healedAmount)

  return {
    nextRun: {
      ...playerRun,
      hp: nextHp,
    },
    nextItems: {
      ...itemState,
      potionConsumed: true,
    },
    consumed: true,
    healedAmount,
    notice: `HP restored +${healedAmount}`,
  }
}
