import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CHESTS, CHEST_REQUIREMENT, BOULDERS, EXIT, GATE, KEY, MONKEY, SNAKES, SPIKES, stageMap } from './level'
import { DAMAGE, initialStageState, planStageMove, reduceStage, replayStage, sameCell, stageTranscript, type StageAction, type StageState } from './model'
import { DIRECTION_VECTORS, type Direction, type GridCoord } from '../../world/grid'
import { CHEST_GEM_AMOUNT, CHEST_POTION_HEAL } from '../../systems/chests'
const directions = Object.keys(DIRECTION_VECTORS) as Direction[]
function walk(state: StageState, goal: GridCoord): StageState {
  const queue = [{ p: state.player, path: [] as Direction[] }], seen = new Set<string>()
  for (let i = 0; i < queue.length; i++) {
    const { p, path } = queue[i]
    if (sameCell(p, goal)) return path.reduce((s, direction) => reduceStage(s, { type: 'MOVE', direction }), state)
    for (const direction of directions) {
      const plan = planStageMove({ ...state, player: p }, direction)
      if (!plan || plan.push || (!sameCell(plan.to, goal) && SPIKES.some(g => g.tiles.some(t => sameCell(t, plan.to))))) continue
      const key = plan.to.x + ',' + plan.to.y
      if (!seen.has(key)) { seen.add(key); queue.push({ p: plan.to, path: [...path, direction] }) }
    }
  }
  throw new Error('No route to ' + JSON.stringify(goal))
}
function allTreasure(initial = initialStageState()) {
  let s = walk(initial, CHESTS[0]); s = walk(s, CHESTS[1]); s = walk(s, KEY); s = walk(s, GATE); s = walk(s, CHESTS[2])
  if (s.boulders[0].x === 15) { s = walk(s, { x: 14, y: 5 }); s = reduceStage(s, { type: 'MOVE', direction: 'RIGHT' }) }
  s = walk(s, CHESTS[3])
  if (s.boulders[1].x === 19) { s = walk(s, { x: 20, y: 7 }); s = reduceStage(s, { type: 'MOVE', direction: 'LEFT' }) }
  s = walk(s, CHESTS[5]); return walk(s, CHESTS[4])
}
const ticks = (state: StageState, count: number) => Array.from({ length: count }).reduce<StageState>(s => reduceStage(s, { type: 'TICK' }), state)
const enter = (state: StageState, goal: GridCoord, direction: Direction = 'RIGHT') => {
  const v = DIRECTION_VECTORS[direction]
  return reduceStage({ ...state, player: { x: goal.x - v.x, y: goal.y - v.y } }, { type: 'MOVE', direction })
}
describe('Chest Hunter Lost Courtyard isolated authority', () => {
  it('authors a bounded 30x24 world, six distinct chests / four required and exactly one of each wildlife', () => {
    expect(stageMap.world).toEqual({ width: 960, height: 768 }); expect(stageMap.collision.width).toBe(30); expect(stageMap.collision.height).toBe(24)
    expect(CHESTS).toHaveLength(6); expect(CHEST_REQUIREMENT).toBe(4); expect(new Set(CHESTS.map(c => c.id)).size).toBe(6)
    expect(SNAKES).toHaveLength(1); expect(MONKEY.perches).toHaveLength(2); expect(SPIKES).toHaveLength(1)
    for (const c of [...CHESTS, KEY, GATE, EXIT]) expect(stageMap.collision.layout[c.y][c.x]).not.toBe('#')
    expect(initialStageState().hp).toBe(100)
  })
  it('uses V1 fixed loot vocabulary and exact Gems/potion amounts; opens each chest only once', () => {
    expect(CHESTS.map(c => c.loot)).toEqual(['GEMS', 'POTION', 'EMPTY', 'TRAP', 'GEMS', 'SWORD'])
    let s = enter(initialStageState(), CHESTS[0]); expect(s.expeditionGems).toBe(CHEST_GEM_AMOUNT)
    s = enter(s, CHESTS[0]); expect(s.stageChestsOpened).toBe(1); expect(s.expeditionChestsOpened).toBe(1)
    expect(s.events.filter(e => e.type === 'CHEST_OPENED')).toHaveLength(1)
    const healed = enter({ ...initialStageState(), hp: 60 }, CHESTS[1], 'DOWN')
    expect(healed.hp).toBe(60 + CHEST_POTION_HEAL); expect(healed.carriedItems.potion).toEqual({ owned: true, consumed: true })
    expect(enter(initialStageState(), CHESTS[1], 'DOWN').hp).toBe(100)
    expect(enter(initialStageState(), CHESTS[5], 'UP').carriedItems.sword).toBe(true)
  })
  it('traps apply exactly 18 HP once and share six-tick immunity with other damage', () => {
    const start = { ...initialStageState(), player: { x: 15, y: 5 } }
    const trapped = reduceStage(start, { type: 'MOVE', direction: 'UP' })
    expect(trapped.hp).toBe(100 - DAMAGE.trap); expect(trapped.invulnerableUntil).toBe(6)
    expect(enter(trapped, CHESTS[3], 'UP').hp).toBe(trapped.hp)
    expect(reduceStage({ ...start, invulnerableUntil: 5 }, { type: 'MOVE', direction: 'UP' }).hp).toBe(100)
  })
  it('collects the key once and consumes it on the only gate; a locked gate blocks entry', () => {
    let s = initialStageState(); expect(() => walk(s, CHESTS[2])).toThrow('No route')
    expect(planStageMove({ ...s, player: { x: 9, y: 6 } }, 'UP')).toBeNull()
    s = walk(s, KEY); s = walk(s, { x: 5, y: 3 }); s = walk(s, KEY)
    expect(s.events.filter(e => e.type === 'KEY_COLLECTED')).toHaveLength(1)
    s = walk(s, GATE); expect(s.gateUnlocked).toBe(true); expect(s.keyHeld).toBe(false)
    s = walk(s, { x: 9, y: 6 }); s = walk(s, GATE)
    expect(s.events.filter(e => e.type === 'GATE_UNLOCKED')).toHaveLength(1)
  })
  it('keeps both chest pockets reachable from ALL 12 allowed stone configurations', () => {
    for (let first = BOULDERS[0].minX; first <= BOULDERS[0].maxX; first++) for (let second = BOULDERS[1].minX; second <= BOULDERS[1].maxX; second++) {
      const s = initialStageState(); s.boulders[0].x = first; s.boulders[1].x = second
      const solved = allTreasure(s); expect(solved.stageChestsOpened).toBe(6); expect(walk(solved, EXIT).status).toBe('complete')
    }
  })
  it('allows only one-cell cardinal groove pushes and cannot push through end stops, solids or another stone', () => {
    const s = { ...initialStageState(), player: { x: 14, y: 5 } }
    expect(planStageMove(s, 'RIGHT')?.push?.to).toEqual({ x: 16, y: 5 })
    expect(planStageMove({ ...s, player: { x: 15, y: 6 } }, 'UP')).toBeNull()
    expect(planStageMove({ ...s, boulders: [...s.boulders, { id: 'other', x: 16, y: 5 }] }, 'RIGHT')).toBeNull()
    expect(planStageMove({ ...s, player: { x: 16, y: 5 }, boulders: [{ id: 'store-stone', x: 15, y: 5 }] }, 'LEFT')).toBeNull()
  })
  it('activates the authored snake and patrol deterministically; monkey tells then impacts its fixed target', () => {
    let s = { ...initialStageState(), player: { x: 3, y: 11 } }
    s = ticks(s, 1); expect(s.snakes[0].mode).toBe('alert')
    const a = ticks(s, 25), b = ticks(s, 25); expect(a).toEqual(b); expect(a.events.some(e => e.type === 'SNAKE_MOVED')).toBe(true)
    const m = ticks({ ...initialStageState(), player: { x: 25, y: 14 } }, 1)
    expect(m.monkey.mode).toBe('tell'); expect(m.monkey.target).toEqual(m.player)
    const impact = ticks(m, 8); expect(impact.hp).toBe(80); expect(impact.monkey.perch).toBe(1)
    expect(impact.events.filter(e => e.type === 'MONKEY_ROCK_IMPACT')).toEqual([{ type: 'MONKEY_ROCK_IMPACT', target: m.player, hit: true, seq: 2, tick: 9 }])
    expect(ticks({ ...m, player: { x: 24, y: 14 } }, 8).hp).toBe(100)
  })
  it('locks exit below four, unlocks exactly at four, and permits the optional fifth/sixth', () => {
    const s = initialStageState(); expect(planStageMove({ ...s, player: { x: 17, y: 19 } }, 'UP')).toBeNull()
    let next = s
    for (const [i,c] of CHESTS.entries()) {
      next = enter(next, c, c.id === 'store' || c.id === 'store-bonus' ? 'UP' : c.id === 'arcade' ? 'DOWN' : 'RIGHT')
      expect(next.exitUnlocked).toBe(i >= 3)
      expect(next.status).toBe('playing')
    }
    expect(next.stageChestsOpened).toBe(6); expect(next.events.filter(e => e.type === 'EXIT_UNLOCKED')).toHaveLength(1)
  })
  it('completion returns exact HP, carry, IDs and chest count, excludes stage-local state, and is terminal', () => {
    const treasure = allTreasure(), done = walk(treasure, EXIT)
    expect(done.result).toMatchObject({ stageId: 'lost-courtyard', stageChestsOpened: 6, expeditionChestsOpened: 6, hpRemaining: treasure.hp, expeditionGems: 4,
      carriedItems: { sword: true, potion: { owned: true, consumed: true } }, openedChestIds: CHESTS.map(c => c.id) })
    expect(done.result).not.toHaveProperty('keyHeld'); expect(done.result).not.toHaveProperty('boulders')
    expect(reduceStage(done, { type: 'TICK' })).toBe(done)
    expect(done.events.filter(e => e.type === 'STAGE_COMPLETE')).toHaveLength(1)
  })
  it('failure prevents completion, and reset reproduces exact initial state', () => {
    const failed = ticks({ ...initialStageState(), hp: 10, player: { x: 24, y: 12 }, exitUnlocked: true }, 1)
    expect(failed.status).toBe('failed'); expect(reduceStage(failed, { type: 'MOVE', direction: 'DOWN' })).toBe(failed); expect(failed.result).toBeNull()
    expect(reduceStage(allTreasure(), { type: 'RESET' })).toEqual(initialStageState())
  })
  it('serializes explicit MOVE/TICK actions and reproduces identical state without mutating inputs', () => {
    const actions: StageAction[] = [{ type: 'MOVE', direction: 'RIGHT' }, { type: 'MOVE', direction: 'UP' }, ...Array.from({ length: 30 }, () => ({ type: 'TICK' as const }))]
    const s = initialStageState(), snapshot = JSON.stringify(s); reduceStage(s, actions[0]); expect(JSON.stringify(s)).toBe(snapshot)
    expect(replayStage(actions)).toEqual(replayStage(JSON.parse(JSON.stringify(actions))))
    expect(stageTranscript(actions)).toMatchObject({ schema: 'angkor-chest-hunter-stage1/v1', stageId: 'lost-courtyard', actions, result: null })
  })
  it('replays the complete browser MOVE/TICK run, including all six chests and all encounter/puzzle events', () => {
    const envelope = JSON.parse(readFileSync(new URL('../../../../docs/angkor-v2/chest-hunter-stage1/qa/lost-courtyard-local-replay.json', import.meta.url), 'utf8'))
    expect(envelope.schema).toBe('angkor-chest-hunter-stage1/v1'); expect(envelope.stageId).toBe('lost-courtyard')
    const replay = replayStage(envelope.actions)
    expect(replay).toEqual(replayStage(JSON.parse(JSON.stringify(envelope.actions))))
    expect(replay.result).toEqual(envelope.result)
    expect(replay.status).toBe('complete'); expect(replay.stageChestsOpened).toBe(6); expect(replay.expeditionGems).toBe(4)
    expect(replay.events.filter(e => e.type === 'EXIT_UNLOCKED')).toHaveLength(1)
    expect(replay.events.filter(e => e.type === 'STAGE_COMPLETE')).toHaveLength(1)
    expect(replay.events.filter(e => e.type === 'BOULDER_PUSH')).toHaveLength(2)
    expect([...new Set(replay.events.filter(e => e.type === 'DAMAGE').map(e => e.source))]).toEqual(['trap', 'monkey', 'spikes'])
    for (const type of ['CHEST_OPENED', 'CHEST_LOOT_RESOLVED', 'KEY_COLLECTED', 'GATE_UNLOCKED', 'SNAKE_ACTIVATED', 'SNAKE_MOVED', 'MONKEY_ATTACK_TELEGRAPH', 'MONKEY_ROCK_IMPACT']) expect(replay.events.some(e => e.type === type)).toBe(true)
    for (const event of replay.events) if (event.type === 'MOVE') {
      expect(Math.abs(event.to.x - event.from.x) + Math.abs(event.to.y - event.from.y)).toBe(1)
      expect(stageMap.collision.layout[event.to.y][event.to.x]).not.toBe('#')
    }
  })

})
