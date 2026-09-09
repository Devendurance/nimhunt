import { describe, expect, it } from 'vitest'
import {
  checkPotionConsumption,
  checkSwordPickup,
  createInitialItemState,
  POTION_HEAL_AMOUNT,
} from './items'
import { createRunState } from '../domain/runState'

describe('Item System (Sword & Potion)', () => {
  const SWORD_COORD = { x: 1, y: 6 }
  const POTION_COORD = { x: 2, y: 1 }

  describe('Sword Pickup', () => {
    it('initializes with no sword', () => {
      const items = createInitialItemState()
      expect(items.hasSword).toBe(false)
      expect(items.swordPickedUp).toBe(false)
    })

    it('collects sword upon entering sword tile', () => {
      const items = createInitialItemState()
      const result = checkSwordPickup(items, { x: 1, y: 6 }, SWORD_COORD)

      expect(result.collected).toBe(true)
      expect(result.nextItems.hasSword).toBe(true)
      expect(result.nextItems.swordPickedUp).toBe(true)
      expect(result.notice).toBe('Sword acquired.')
    })

    it('does not collect sword when player is not on sword tile', () => {
      const items = createInitialItemState()
      const result = checkSwordPickup(items, { x: 1, y: 5 }, SWORD_COORD)

      expect(result.collected).toBe(false)
      expect(result.nextItems.hasSword).toBe(false)
      expect(result.notice).toBe('')
    })

    it('cannot collect sword more than once per run', () => {
      const collectedItems = { ...createInitialItemState(), hasSword: false, swordPickedUp: true }
      const result = checkSwordPickup(collectedItems, { x: 1, y: 6 }, SWORD_COORD)

      expect(result.collected).toBe(false)
      expect(result.nextItems.hasSword).toBe(false)
    })
  })

  describe('Potion Consumption', () => {
    it('initializes with unconsumed potion', () => {
      const items = createInitialItemState()
      expect(items.potionConsumed).toBe(false)
    })

    it('does NOT consume potion if player is at full HP (100 HP)', () => {
      const run = createRunState() // 100 HP
      const items = createInitialItemState()
      const result = checkPotionConsumption(run, items, { x: 2, y: 1 }, POTION_COORD)

      expect(result.consumed).toBe(false)
      expect(result.healedAmount).toBe(0)
      expect(result.nextRun.hp).toBe(100)
      expect(result.nextItems.potionConsumed).toBe(false)
    })

    it('consumes potion and restores 25 HP when player is damaged', () => {
      const run = { ...createRunState(), hp: 70 }
      const items = createInitialItemState()
      const result = checkPotionConsumption(run, items, { x: 2, y: 1 }, POTION_COORD)

      expect(result.consumed).toBe(true)
      expect(result.healedAmount).toBe(POTION_HEAL_AMOUNT)
      expect(result.nextRun.hp).toBe(95)
      expect(result.nextItems.potionConsumed).toBe(true)
      expect(result.notice).toBe('HP restored +25')
    })

    it('clamps healing to 100 HP when player HP is above 75', () => {
      const run = { ...createRunState(), hp: 90 }
      const items = createInitialItemState()
      const result = checkPotionConsumption(run, items, { x: 2, y: 1 }, POTION_COORD)

      expect(result.consumed).toBe(true)
      expect(result.healedAmount).toBe(10)
      expect(result.nextRun.hp).toBe(100)
      expect(result.nextItems.potionConsumed).toBe(true)
      expect(result.notice).toBe('HP restored +10')
    })

    it('does not consume potion if player is on another tile', () => {
      const run = { ...createRunState(), hp: 50 }
      const items = createInitialItemState()
      const result = checkPotionConsumption(run, items, { x: 2, y: 2 }, POTION_COORD)

      expect(result.consumed).toBe(false)
      expect(result.nextRun.hp).toBe(50)
      expect(result.nextItems.potionConsumed).toBe(false)
    })

    it('cannot consume already consumed potion', () => {
      const run = { ...createRunState(), hp: 50 }
      const consumedItems = { ...createInitialItemState(), potionConsumed: true }
      const result = checkPotionConsumption(run, consumedItems, { x: 2, y: 1 }, POTION_COORD)

      expect(result.consumed).toBe(false)
      expect(result.nextRun.hp).toBe(50)
    })
  })
})
