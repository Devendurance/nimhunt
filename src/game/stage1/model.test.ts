import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { TileTraversal } from '../traversal/angkorV2/movement'
import { EXIT, GEMS, GEM_REQUIREMENT, MONKEY, SNAKES, SPIKES, stageMap } from './level'
import { DAMAGE, initialStageState, planStageMove, reduceStage, replayStage, sameCell, type StageAction, type StageState } from './model'
import type { Direction, GridCoord } from '../world/grid'
const directions: Direction[] = ['UP', 'DOWN', 'LEFT', 'RIGHT']
const tick = (state: StageState, count: number) => Array.from({ length: count }).reduce<StageState>(s => reduceStage(s, { type: 'TICK' }), state)
function reach(state: StageState, target: GridCoord): { state: StageState; actions: StageAction[] } {
  const queue = [{ state, actions: [] as StageAction[] }], seen = new Set<string>()
  for (let index = 0; index < queue.length && index < 20000; index++) {
    const node = queue[index]
    if (sameCell(node.state.player, target)) return node
    for (const direction of directions) {
      const next = reduceStage(node.state, { type: 'MOVE', direction })
      if (next === node.state || next.hp === 0) continue
      const key = JSON.stringify([next.player, next.boulders, next.collected, next.hp])
      if (seen.has(key)) continue
      seen.add(key); queue.push({ state: next, actions: [...node.actions, { type: 'MOVE', direction }] })
    }
  }
  throw new Error('Unreachable target ' + JSON.stringify(target))
}
describe('Outer Ruins isolated deterministic domain', () => {
  it('authors a closed 30×24 world, 8 unique reachable Gems, two snakes and two small spike groups', () => {
    expect(stageMap.world).toEqual({ width: 960, height: 768 }); expect(GEMS).toHaveLength(8); expect(GEM_REQUIREMENT).toBe(6)
    expect(new Set(GEMS.map(g => g.id)).size).toBe(8); expect(SNAKES).toHaveLength(2); expect(SPIKES).toHaveLength(2)
    const start = initialStageState(); expect(start.hp).toBe(100); expect(start.player).toEqual({ x: 3, y: 20 })
    for (const g of GEMS) expect(stageMap.collision.layout[g.y][g.x]).not.toBe('#')
    for (const snake of SNAKES) for (let i = 0; i < snake.path.length; i++) {
      const a = snake.path[i], b = snake.path[(i + 1) % snake.path.length]
      expect(Math.abs(a.x - b.x) + Math.abs(a.y - b.y)).toBe(1); expect(stageMap.collision.layout[a.y][a.x]).not.toBe('#')
    }
  })
  it('collects each Gem once, unlocks exactly on the sixth, permits optional Gems, and preserves completion', () => {
    let state = initialStageState(); const actions: StageAction[] = []
    for (let i = 0; i < GEMS.length; i++) {
      const result = reach(state, GEMS[i]); state = result.state; actions.push(...result.actions)
      expect(state.stageGems).toBe(i + 1); expect(state.expeditionGems).toBe(i + 1)
      expect(state.exitUnlocked).toBe(i >= 5)
    }
    const toExit = reach(state, EXIT); state = toExit.state; actions.push(...toExit.actions)
    expect(state.status).toBe('complete'); expect(state.result).toEqual({ gems: 8, expeditionGems: 8, hp: state.hp })
    expect(state.events.filter(e => e.type === 'EXIT_UNLOCKED')).toHaveLength(1)
    expect(state.events.filter(e => e.type === 'GEM_COLLECTED')).toHaveLength(8)
    expect(replayStage(JSON.parse(JSON.stringify(actions)))).toEqual(state)
    expect(reduceStage(state, { type: 'TICK' })).toBe(state)
    expect(reduceStage(state, { type: 'RESET' })).toEqual(initialStageState())
  })
  it('rejects entering the locked passage even from its adjacent approach', () => {
    const s = { ...initialStageState(), player: { x: 24, y: 4 } }
    expect(planStageMove(s, 'UP')).toBeNull(); expect(reduceStage(s, { type: 'MOVE', direction: 'UP' })).toBe(s)
    expect(s.status).toBe('playing')
  })
  it('cannot collect a Gem twice on revisiting its tile', () => {
    const first = reach(initialStageState(), GEMS[0]).state
    const away = reduceStage(first, { type: 'MOVE', direction: 'RIGHT' }), back = reduceStage(away, { type: 'MOVE', direction: 'LEFT' })
    expect(back.stageGems).toBe(1); expect(back.events.filter(e => e.type === 'GEM_COLLECTED')).toHaveLength(1)
  })
  it('activates only authored snake zones, follows fixed cardinal patrols and waits behind stone', () => {
    expect(tick(initialStageState(), 100).snakes.every(s => s.mode === 'dormant')).toBe(true)
    const start = { ...initialStageState(), player: { x: 5, y: 10 } }
    const alert = tick(start, 1); expect(alert.snakes[0].mode).toBe('alert'); expect(alert.snakes[1].mode).toBe('dormant')
    const patrol = tick(alert, 7); expect(patrol.snakes[0].index).toBe(2)
    expect(tick(alert, 7)).toEqual(patrol)
    const blocked = { ...alert, boulders: [...alert.boulders, { id: 'test', x: 7, y: 10 }] }
    expect(tick(blocked, 7).snakes[0].index).toBe(0)
  })
  it('telegraphs the committed tile for 8 explicit ticks, hits a stationary player, misses an evasion and alternates perches', () => {
    const s = { ...initialStageState(), player: { x: MONKEY.zone.x + 1, y: MONKEY.zone.y + 3 } }
    const tell = tick(s, 1); expect(tell.monkey.target).toEqual(s.player); expect(tell.monkey.mode).toBe('tell')
    expect(tick(tell, 7).hp).toBe(100)
    const hit = tick(tell, 8); expect(hit.hp).toBe(80); expect(hit.monkey.perch).toBe(1)
    expect(hit.events.some(e => e.type === 'MONKEY_ROCK_IMPACT' && e.hit)).toBe(true)
    const dodge = tick(reduceStage(tell, { type: 'MOVE', direction: 'LEFT' }), 8)
    expect(dodge.hp).toBe(100); expect(dodge.events.some(e => e.type === 'MONKEY_ROCK_IMPACT' && !e.hit)).toBe(true)
    expect(tick(tell, 8)).toEqual(hit)
  })
  it('pushes one logical tile, rejects walls/chain pushes/Gems/hazards and opens the breach', () => {
    const s = { ...initialStageState(), player: { x: 10, y: 12 } }
    const next = reduceStage(s, { type: 'MOVE', direction: 'RIGHT' })
    expect(next.player).toEqual({ x: 11, y: 12 }); expect(next.boulders[0]).toMatchObject({ x: 12, y: 12 })
    expect(next.events[0].type).toBe('BOULDER_PUSH')
    const wall = { ...s, player: { x: 11, y: 13 } }; expect(planStageMove(wall, 'UP')).toBeNull()
    const chain = { ...s, boulders: [...s.boulders, { id: 'chain', x: 12, y: 12 }] }; expect(planStageMove(chain, 'RIGHT')).toBeNull()
    const pocket = { ...s, player: { x: 14, y: 12 }, boulders: [{ id: 'pocket', x: 14, y: 13 }] }; expect(planStageMove(pocket, 'DOWN')).toBeNull()
  })
  it('keeps the optional pocket recoverable after pushing its stone south', () => {
    const s = { ...initialStageState(), player: { x: 14, y: 11 } }
    const south = reduceStage(s, { type: 'MOVE', direction: 'DOWN' })
    expect(south.boulders[1]).toMatchObject({ x: 14, y: 13 })
    expect(reach(south, { x: 14, y: 14 }).state.collected).toContain('garden-bonus')
  })
  it('uses deterministic damage, six-tick invulnerability, zero-HP failure and exact reset', () => {
    const s = { ...initialStageState(), player: SPIKES[0].tiles[0] }
    const hurt = tick(s, 1); expect(hurt.hp).toBe(100 - DAMAGE.spikes)
    expect(tick(hurt, 5).hp).toBe(hurt.hp); expect(tick(hurt, 6).hp).toBe(64)
    const failed = tick(s, 50); expect(failed.hp).toBe(0); expect(failed.status).toBe('failed')
    expect(reduceStage(failed, { type: 'RESET' })).toEqual(initialStageState())
    const snake = { ...initialStageState(), player: SNAKES[0].path[0] }; expect(tick(snake, 1).hp).toBe(88)
  })
  it('integrates sequential held moves/arrival commits and buffered turns without changing default traversal', () => {
    let state = initialStageState()
    const controller = new TileTraversal(stageMap.collision, () => {}, 145, { canEnter: (_from, d) => Boolean(planStageMove(state, d)), onArrive: move => { state = reduceStage(state, { type: 'MOVE', direction: move.direction }) } })
    controller.press('up', 'UP'); controller.update(0); expect(state.player).toEqual({ x: 3, y: 20 })
    controller.press('right', 'RIGHT'); controller.release('right'); controller.update(145)
    expect(state.player).toEqual({ x: 3, y: 19 }); expect(controller.activeMove?.direction).toBe('RIGHT')
    controller.update(145); controller.clearInput(); controller.update(145)
    expect(state.events.filter(e => e.type === 'MOVE').map(e => e.direction)).toEqual(['UP', 'RIGHT', 'UP'])
    expect(controller.position).toEqual(state.player)
    for (const e of state.events) if (e.type === 'MOVE') expect(Math.abs(e.from.x - e.to.x) + Math.abs(e.from.y - e.to.y)).toBe(1)
  })
  it('keeps dev Stage I out of the production entry and contains no random or clock authority', () => {
    expect(readFileSync('src/main.tsx', 'utf8')).not.toMatch(/stage1|angkorV2Stage1/)
    expect(readFileSync('src/game/stage1/model.ts', 'utf8')).not.toMatch(/Math\.random|Date\.|performance\.|from ['"]phaser/)
  })
})
