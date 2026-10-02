import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { BOULDERS, EXIT, GEMS, GEM_REQUIREMENT, MONKEYS, RUBBLE, SNAKES, stageMap } from './level'
import { DAMAGE, initialStageState, planStageMove, reduceStage, replayStage, type StageAction, type StageState } from './model'
import { DIRECTION_VECTORS, type Direction, type GridCoord } from '../world/grid'
import { sameCell } from '../stage1/model'
import { freshCarry, type StageCarry } from '../gemRunner/contracts'
import { GemRunnerRuntime, replayEnvelope, stageFactory, type GemRunnerEnvelope } from '../gemRunner/runtime'
import { outerRuinsAdapter } from '../gemRunner/outerRuinsAdapter'
import { overgrownTempleAdapter } from '../gemRunner/overgrownTempleAdapter'

const directions = Object.keys(DIRECTION_VECTORS) as Direction[]
const fresh = () => initialStageState(freshCarry())
const ticks = (state: StageState, n: number) => Array.from({ length: n }).reduce<StageState>(s => reduceStage(s, { type: 'TICK' }), state)
/** Logical path planner used by tests; executes only real legal MOVE actions.
 * Timed danger is tested independently and in recorded browser playthroughs. */
function route(state: StageState, target: GridCoord): Direction[] {
  const queue = [{ state, path: [] as Direction[] }], seen = new Set<string>()
  for (let i = 0; i < queue.length; i++) {
    const node = queue[i]; if (sameCell(node.state.player, target)) return node.path
    for (const direction of directions) {
      const plan = planStageMove(node.state, direction); if (!plan) continue
      const boulders = node.state.boulders.map(b => plan.push?.id === b.id ? { ...b, ...plan.push.to } : b)
      const next = { ...node.state, player: plan.to, boulders }
      const key = JSON.stringify([next.player, boulders]); if (seen.has(key)) continue
      seen.add(key); queue.push({ state: next, path: [...node.path, direction] })
    }
  }
  throw new Error('Unreachable ' + JSON.stringify(target))
}
function playAll(carry: StageCarry = freshCarry()) {
  let state = initialStageState(carry); const actions: StageAction[] = []
  for (const target of [...GEMS, EXIT]) for (const direction of route(state, target)) {
    const action: StageAction = { type: 'MOVE', direction }; actions.push(action); state = reduceStage(state, action)
  }
  return { state, actions }
}
const envelopeI = JSON.parse(readFileSync('docs/angkor-v2/gem-runner-runtime/qa/keyboard-expedition-envelope.json', 'utf8')) as GemRunnerEnvelope
const factories = { 'outer-ruins': stageFactory(outerRuinsAdapter), 'overgrown-temple': stageFactory(overgrownTempleAdapter) }

describe('Overgrown Temple isolated Stage II', () => {
  it('has a closed 30×24 / 960×768 world, 10 unique Gems, 7 required, 3 snakes and 2 monkeys', () => {
    expect(stageMap.collision).toMatchObject({ width: 30, height: 24 }); expect(stageMap.world).toEqual({ width: 960, height: 768 })
    expect(GEMS).toHaveLength(10); expect(new Set(GEMS.map(g => `${g.x},${g.y}`)).size).toBe(10); expect(GEM_REQUIREMENT).toBe(7)
    expect(SNAKES).toHaveLength(3); expect(MONKEYS).toHaveLength(2); expect(SNAKES[0].path.length).toBeGreaterThan(4)
    for (const p of [...GEMS, ...SNAKES.flatMap(s => [...s.path]), ...RUBBLE.tiles, ...BOULDERS.flatMap(b => [b, b.parked])]) expect(stageMap.collision.layout[p.y][p.x]).not.toBe('#')
    for (const snake of SNAKES) snake.path.forEach((p, i) => { const next = snake.path[(i + 1) % snake.path.length]; expect(Math.abs(p.x - next.x) + Math.abs(p.y - next.y)).toBe(1) })
  })
  it('accepts exact carry with fresh stage-local entities and no automatic healing', () => {
    const carry = { hp: 37, expeditionGems: 8, carriedItems: { sword: true, potion: { owned: true, consumed: true } } }
    const state = overgrownTempleAdapter.create(carry)
    expect(state).toMatchObject({ hp: 37, expeditionGems: 8, stageGems: 0, collected: [], tick: 0, events: [], rubble: { mode: 'armed' } })
    expect(state.snakes.every(s => s.mode === 'dormant')).toBe(true); expect(state.monkeys.every(m => m.mode === 'dormant')).toBe(true)
    expect(state.boulders.map(b => b.id)).toEqual(BOULDERS.map(b => b.id))
    expect(overgrownTempleAdapter.report(state, carry, 0).progress.carriedItems).toEqual(carry.carriedItems)
    expect(() => initialStageState({ ...carry, hp: 0 })).toThrow(/zero HP/)
  })
  it('locks below 7, unlocks once at 7 and retains optional 8th–10th Gems without duplicates', () => {
    let state = fresh()
    expect(planStageMove({ ...state, player: { x: 25, y: 4 } }, 'UP')).toBeNull()
    for (const [i, gem] of GEMS.entries()) {
      const prior = directions.map(direction => ({ direction, from: { x: gem.x - DIRECTION_VECTORS[direction].x, y: gem.y - DIRECTION_VECTORS[direction].y } })).find(p => stageMap.collision.layout[p.from.y]?.[p.from.x] !== '#' && stageMap.collision.layout[p.from.y]?.[p.from.x])!
      state = reduceStage({ ...state, player: prior.from }, { type: 'MOVE', direction: prior.direction })
      expect(state.stageGems).toBe(i + 1); expect(state.exitUnlocked).toBe(i >= 6)
      const duplicate = reduceStage({ ...state, player: prior.from }, { type: 'MOVE', direction: prior.direction }); expect(duplicate.stageGems).toBe(i + 1)
    }
    expect(state.events.filter(e => e.type === 'EXIT_UNLOCKED')).toHaveLength(1)
    expect(planStageMove({ ...state, player: { x: 25, y: 4 } }, 'UP')).not.toBeNull()
  })
  it.each(SNAKES.map((s, i) => [s.id, i] as const))('activates and patrols %s deterministically one cell at a time', (_id, i) => {
    const authored = SNAKES[i], initial = { ...fresh(), player: { x: authored.zone.x + 1, y: authored.zone.y + 1 } }
    const state = ticks(initial, 16), again = ticks(structuredClone(initial), 16)
    expect(state).toEqual(again); expect(state.snakes[i].mode).toBe('patrol')
    expect(state.events.some(e => e.type === 'SNAKE_ACTIVATED' && e.id === authored.id)).toBe(true)
    const moved = state.events.filter(e => e.type === 'SNAKE_MOVED' && e.id === authored.id)
    expect(moved.length).toBeGreaterThan(2)
    moved.forEach(e => { if (e.type === 'SNAKE_MOVED') expect(Math.abs(e.to.x - e.from.x) + Math.abs(e.to.y - e.from.y)).toBe(1) })
  })
  it.each(MONKEYS.map((m, i) => [m.id, i] as const))('telegraphs, impacts and progresses fixed perches for %s', (_id, i) => {
    const authored = MONKEYS[i], initial = { ...fresh(), player: { x: 24, y: 13 } }, tell = ticks(initial, 1)
    expect(tell.monkeys[i]).toMatchObject({ mode: 'tell', target: initial.player, nextTick: 1 + authored.tellTicks })
    const stayed = ticks(tell, authored.tellTicks)
    expect(stayed.events.some(e => e.type === 'MONKEY_ROCK_IMPACT' && e.id === authored.id && e.hit)).toBe(true)
    expect(stayed.monkeys[i]).toMatchObject({ mode: 'recover', perch: 1, target: null })
    const dodged = ticks({ ...tell, player: { x: 26, y: 13 } }, authored.tellTicks)
    expect(dodged.events.some(e => e.type === 'MONKEY_ROCK_IMPACT' && e.id === authored.id && !e.hit)).toBe(true)
    expect(dodged.hp).toBe(100); expect(ticks(initial, 24)).toEqual(ticks(structuredClone(initial), 24))
  })
  it('rubble warns for 8 ticks, impacts authored tiles for 22 damage and rearms only after recovery and departure', () => {
    const initial = { ...fresh(), player: { x: 25, y: 5 } }, tell = ticks(initial, 1)
    expect(tell.rubble).toEqual({ mode: 'tell', nextTick: 9 }); expect(tell.hp).toBe(100)
    expect(ticks(tell, 7).hp).toBe(100)
    const hit = ticks(tell, 8); expect(hit.hp).toBe(100 - DAMAGE.rubble); expect(hit.rubble.mode).toBe('recover')
    expect(hit.events.filter(e => e.type === 'RUBBLE_IMPACT')).toEqual([{ type: 'RUBBLE_IMPACT', tiles: RUBBLE.tiles, hit: true, seq: 2, tick: 9 }])
    const stay = ticks(hit, 40); expect(stay.rubble.mode).toBe('recover'); expect(stay.hp).toBe(hit.hp)
    const departed = ticks({ ...stay, player: { x: 25, y: 4 } }, 1); expect(departed.rubble.mode).toBe('armed')
    const dodged = ticks({ ...tell, player: { x: 26, y: 5 } }, 8); expect(dodged.hp).toBe(100)
    expect(ticks(initial, 9)).toEqual(ticks(structuredClone(initial), 9))
  })
  it('exhausts every reachable legal boulder configuration and proves required route remains recoverable', () => {
    const queue = [fresh()], seen = new Set<string>(), configs = new Map<string, StageState>()
    for (let i = 0; i < queue.length; i++) {
      const state = queue[i]; configs.set(JSON.stringify(state.boulders), state)
      for (const direction of directions) {
        const plan = planStageMove(state, direction); if (!plan) continue
        const boulders = state.boulders.map(b => plan.push?.id === b.id ? { ...b, ...plan.push.to } : b)
        const key = JSON.stringify([plan.to, boulders]); if (seen.has(key)) continue
        seen.add(key); queue.push({ ...state, player: plan.to, boulders })
      }
    }
    expect(configs.size).toBe(4) // Initial → first parked → second parked → optional parked.
    for (const state of configs.values()) expect(route(state, { x: 25, y: 4 }).length).toBeGreaterThan(0)
    for (const state of queue) for (const b of state.boulders) { const track = BOULDERS.find(t => t.id === b.id)!; expect(sameCell(b, track) || sameCell(b, track.parked)).toBe(true) }
    const blocked = { ...fresh(), player: { x: 12, y: 12 } }; expect(planStageMove(blocked, 'RIGHT')).toBeNull()
    const slide = planStageMove({ ...fresh(), player: { x: 13, y: 11 } }, 'DOWN')!
    expect(slide.push?.to).toEqual({ x: 13, y: 13 })
  })
  it('completes all 10 through legal moves, emits once and returns exact cumulative HP/Gems/items', () => {
    const carry = { ...freshCarry(), expeditionGems: 8, carriedItems: { sword: true, potion: { owned: true, consumed: true } } }
    const { state, actions } = playAll(carry)
    expect(state.status).toBe('complete'); expect(state.stageGems).toBe(10); expect(state.expeditionGems).toBe(18)
    expect(state.events.filter(e => e.type === 'BOULDER_PUSH')).toHaveLength(3)
    expect(replayStage(actions, carry)).toEqual(state); expect(reduceStage(state, { type: 'TICK' })).toBe(state)
    expect(overgrownTempleAdapter.report(state, carry, actions.length)).toMatchObject({ status: 'COMPLETE', result: { stageId: 'overgrown-temple', stageGems: 10, expeditionGems: 18, hpRemaining: state.hp, carriedItems: carry.carriedItems } })
  })
  it('replays real Stage I boundaries and Stage II actions identically, then advances only to Stage III contract', () => {
    const runtime = replayEnvelope(envelopeI, { 'outer-ruins': factories['outer-ruins'] }), carry = runtime.state.stageCarryIn
    const run = runtime.attachStage(overgrownTempleAdapter), { actions } = playAll(carry)
    actions.forEach(a => run.dispatch(a))
    expect(runtime.state).toMatchObject({ status: 'TRANSITION', currentStage: 'overgrown-temple', expeditionGems: 16, stageGems: 10, completedStages: ['outer-ruins', 'overgrown-temple'] })
    const before = runtime.envelope(); run.dispatch({ type: 'TICK' }); expect(runtime.envelope()).toEqual(before)
    const next = runtime.continue(); expect(next).toMatchObject({ currentStage: 'inner-sanctuary', stageGems: 0, hp: before.snapshot.hp, expeditionGems: 16 })
    expect(runtime.continue()).toBe(next)
    expect(replayEnvelope(JSON.parse(JSON.stringify(runtime.envelope())), factories).envelope()).toEqual(runtime.envelope())
    expect(() => runtime.attachStage(overgrownTempleAdapter)).toThrow(/current/)
  })
  it('zero HP fails Stage II and keeps Stage I result, without transition or healing', () => {
    const runtime: GemRunnerRuntime = replayEnvelope(envelopeI, factories), run = runtime.attachStage(overgrownTempleAdapter)
    for (const direction of route(run.state, { x: 8, y: 4 })) run.dispatch({ type: 'MOVE', direction })
    for (let i = 0; i < 60; i++) run.dispatch({ type: 'TICK' })
    expect(runtime.state).toMatchObject({ status: 'FAILED', hp: 0, currentStage: 'overgrown-temple', completedStages: ['outer-ruins'] })
    expect(runtime.continue().currentStage).toBe('overgrown-temple')
    expect(replayEnvelope(runtime.envelope(), factories).state).toEqual(runtime.state)
  })
  it('replays the complete real browser expedition through both boundaries and every Stage II encounter', () => {
    const recorded = JSON.parse(readFileSync('docs/angkor-v2/stage2/qa/expedition-playthrough.json', 'utf8')) as GemRunnerEnvelope
    expect(replayEnvelope(recorded, factories).envelope()).toEqual(recorded)
    const actions = recorded.entries.flatMap(e => e.type === 'STAGE_ACTION' && e.stageId === 'overgrown-temple' ? [e.action as StageAction] : [])
    const entry = recorded.entries.find(e => e.type === 'STAGE_STARTED' && e.stageId === 'overgrown-temple')!
    if (entry.type !== 'STAGE_STARTED') throw new Error('Missing stage entry')
    const state = replayStage(actions, entry.carry)
    expect(state).toMatchObject({ status: 'complete', hp: 48, stageGems: 10, expeditionGems: 16 })
    expect(new Set(state.events.flatMap(e => e.type === 'SNAKE_ACTIVATED' ? [e.id] : [])).size).toBe(3)
    expect(new Set(state.events.flatMap(e => e.type === 'MONKEY_ROCK_IMPACT' ? [e.id] : [])).size).toBe(2)
    expect(state.events.filter(e => e.type === 'BOULDER_PUSH')).toHaveLength(3)
    expect(state.events.some(e => e.type === 'RUBBLE_IMPACT' && e.hit)).toBe(true)
    expect(recorded.snapshot).toMatchObject({ currentStage: 'inner-sanctuary', stageGems: 0, hp: 48, expeditionGems: 16 })
  })
})
