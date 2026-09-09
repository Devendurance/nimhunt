import { describe, expect, it } from 'vitest'
import {
  CHEST_GEM_AMOUNT,
  CHEST_POTION_HEAL,
  CHEST_TRAP_DAMAGE,
  createChestStates,
  openChest,
  type ChestPlacement,
} from './chests'
import { createRunState } from '../domain/runState'
import { CHEST_HUNTER_TARGET, evaluateMission } from '../domain/mission'
import { createInitialItemState } from './items'

const PLACEMENTS: readonly ChestPlacement[] = [
  { id: 'chest-01', x: 1, y: 2, loot: 'GEMS' },
  { id: 'chest-02', x: 6, y: 3, loot: 'POTION' },
  { id: 'chest-03', x: 5, y: 5, loot: 'TRAP' },
  { id: 'chest-04', x: 10, y: 3, loot: 'SWORD' },
]

describe('Chest domain (deterministic loot)', () => {
  it('uses fixed Room 01 configuration with no reroll', () => {
    const chests = createChestStates(PLACEMENTS)
    expect(chests).toHaveLength(4)
    expect(chests.map(c => `${c.id}:${c.loot}`)).toEqual([
      'chest-01:GEMS',
      'chest-02:POTION',
      'chest-03:TRAP',
      'chest-04:SWORD',
    ])
    expect(createChestStates(PLACEMENTS).map(c => c.loot)).toEqual(chests.map(c => c.loot))
  })

  it('starts CLOSED and unresolved', () => {
    const chests = createChestStates(PLACEMENTS)
    for (const chest of chests) {
      expect(chest.state).toBe('CLOSED')
      expect(chest.resolved).toBe(false)
    }
  })

  it('opens once and second interaction does nothing', () => {
    const run = createRunState()
    const items = createInitialItemState()
    const chests = createChestStates(PLACEMENTS)
    const first = openChest(run, items, chests, 'chest-01')
    expect(first.opened).toBe(true)
    expect(first.nextChests.find(c => c.id === 'chest-01')?.state).toBe('OPEN')
    expect(first.nextRun.chestsOpened).toBe(1)
    const second = openChest(first.nextRun, first.nextItems, first.nextChests, 'chest-01')
    expect(second.opened).toBe(false)
    expect(second.nextRun.chestsOpened).toBe(1)
    expect(second.nextChests).toBe(first.nextChests)
  })

  it('increments chestsOpened once per distinct chest', () => {
    let run = createRunState()
    let items = createInitialItemState()
    let chests: readonly import('./chests').ChestInstance[] = createChestStates(PLACEMENTS)
    for (const id of ['chest-01', 'chest-02', 'chest-03', 'chest-04']) {
      const res = openChest(run, items, chests, id, 'chest-hunter')
      expect(res.opened).toBe(true)
      run = res.nextRun
      items = res.nextItems
      chests = res.nextChests
    }
    expect(run.chestsOpened).toBe(4)
    expect(run.openedChestIds).toHaveLength(4)
  })

  it('reset restores all chests to CLOSED with original loot', () => {
    const opened = openChest(createRunState(), createInitialItemState(), createChestStates(PLACEMENTS), 'chest-01')
    expect(opened.nextChests.find(c => c.id === 'chest-01')?.state).toBe('OPEN')
    const reset = createChestStates(PLACEMENTS)
    expect(reset.every(c => c.state === 'CLOSED')).toBe(true)
    expect(reset.every(c => c.resolved === false)).toBe(true)
    expect(reset.map(c => c.loot)).toEqual(['GEMS', 'POTION', 'TRAP', 'SWORD'])
  })

  it('GEM chest adds exactly 2 gems', () => {
    const res = openChest(createRunState(), createInitialItemState(), createChestStates(PLACEMENTS), 'chest-01')
    expect(CHEST_GEM_AMOUNT).toBe(2)
    expect(res.nextRun.gemsCollected).toBe(2)
    expect(res.notice).toBe('Found 2 gems.')
  })

  it('POTION chest heals and clamps to 100', () => {
    expect(CHEST_POTION_HEAL).toBe(25)
    const hurt = { ...createRunState(), hp: 70 }
    const res = openChest(hurt, createInitialItemState(), createChestStates(PLACEMENTS), 'chest-02')
    expect(res.nextRun.hp).toBe(95)
    const nearFull = { ...createRunState(), hp: 90 }
    const clamped = openChest(nearFull, createInitialItemState(), createChestStates(PLACEMENTS), 'chest-02')
    expect(clamped.nextRun.hp).toBe(100)
  })

  it('POTION chest at 100 HP still counts as opened without exceeding max', () => {
    const res = openChest(createRunState(), createInitialItemState(), createChestStates(PLACEMENTS), 'chest-02')
    expect(res.opened).toBe(true)
    expect(res.nextRun.hp).toBe(100)
    expect(res.nextRun.chestsOpened).toBe(1)
  })

  it('SWORD chest sets hasSword without stacking', () => {
    const res = openChest(createRunState(), createInitialItemState(), createChestStates(PLACEMENTS), 'chest-04')
    expect(res.nextItems.hasSword).toBe(true)
    expect(res.notice).toBe('Ancient Blade found.')
    const again = openChest(createRunState(), { ...createInitialItemState(), hasSword: true }, createChestStates(PLACEMENTS), 'chest-04')
    expect(again.nextItems.hasSword).toBe(true)
  })

  it('TRAP chest removes exactly 30 HP once', () => {
    expect(CHEST_TRAP_DAMAGE).toBe(30)
    const res = openChest(createRunState(), createInitialItemState(), createChestStates(PLACEMENTS), 'chest-03')
    expect(res.nextRun.hp).toBe(70)
    expect(res.notice).toBe('It was trapped! -30 HP')
    const second = openChest(res.nextRun, res.nextItems, res.nextChests, 'chest-03')
    expect(second.opened).toBe(false)
    expect(second.nextRun.hp).toBe(70)
  })

  it('TRAP can fail the run at 0 HP', () => {
    const low = { ...createRunState(), hp: 30 }
    const res = openChest(low, createInitialItemState(), createChestStates(PLACEMENTS), 'chest-03')
    expect(res.nextRun.hp).toBe(0)
    expect(res.nextRun.runStatus).toBe('FAILED')
  })

  it('EMPTY resolves with no stat change but counts toward mission', () => {
    const emptyPlacements: readonly ChestPlacement[] = [{ id: 'empty-1', x: 0, y: 0, loot: 'EMPTY' }]
    const res = openChest(createRunState(), createInitialItemState(), createChestStates(emptyPlacements), 'empty-1')
    expect(res.opened).toBe(true)
    expect(res.nextRun.hp).toBe(100)
    expect(res.nextRun.gemsCollected).toBe(0)
    expect(res.nextItems.hasSword).toBe(false)
    expect(res.nextRun.chestsOpened).toBe(1)
    expect(res.notice).toBe('Nothing but dust.')
  })

  it('4 opened + HP > 0 completes Chest Hunter; HP = 0 does not', () => {
    expect(CHEST_HUNTER_TARGET).toBe(4)
    expect(evaluateMission({ ...createRunState(), chestsOpened: 4, hp: 50 }, 'chest-hunter').runStatus).toBe('MISSION_COMPLETE')
    const dead = evaluateMission({ ...createRunState(), chestsOpened: 4, hp: 0 }, 'chest-hunter')
    expect(dead.runStatus).toBe('FAILED')
    expect(dead.missionStatus).toBe('FAILED')
  })

  it('Gem Runner behavior remains valid with default mission', () => {
    expect(evaluateMission({ ...createRunState(), gemsCollected: 6, hp: 50 }).runStatus).toBe('MISSION_COMPLETE')
    expect(evaluateMission({ ...createRunState(), chestsOpened: 4, hp: 50 }).runStatus).toBe('PLAYING')
  })
})
