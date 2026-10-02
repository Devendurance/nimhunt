import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ANACONDA, BOSS_BODY, EXIT, GEMS, GEM_REQUIREMENT, MONKEYS, SNAKES, stageMap } from './level'
import { DAMAGE, initialStageState, planStageMove, reduceStage, replayStage, type StageAction, type StageState } from './model'
import { DIRECTION_VECTORS, type Direction, type GridCoord } from '../world/grid'
import { sameCell } from '../stage1/model'
import { freshCarry } from '../gemRunner/contracts'
import { replayEnvelope, stageFactory, type GemRunnerEnvelope } from '../gemRunner/runtime'
import { outerRuinsAdapter } from '../gemRunner/outerRuinsAdapter'
import { overgrownTempleAdapter } from '../gemRunner/overgrownTempleAdapter'
import { innerSanctuaryAdapter } from '../gemRunner/innerSanctuaryAdapter'

const directions = Object.keys(DIRECTION_VECTORS) as Direction[]
const fresh = () => initialStageState(freshCarry())
const ticks = (s: StageState, n: number) => Array.from({ length: n }).reduce<StageState>(state => reduceStage(state, { type: 'TICK' }), s)
const factories = { 'outer-ruins': stageFactory(outerRuinsAdapter), 'overgrown-temple': stageFactory(overgrownTempleAdapter), 'inner-sanctuary': stageFactory(innerSanctuaryAdapter) }
const priorEnvelope = JSON.parse(readFileSync('docs/angkor-v2/stage2/qa/expedition-playthrough.json', 'utf8')) as GemRunnerEnvelope
function route(state: StageState, target: GridCoord): Direction[] {
  const queue = [{ player: state.player, path: [] as Direction[] }], seen = new Set<string>()
  for (let i = 0; i < queue.length; i++) {
    const node = queue[i]; if (sameCell(node.player, target)) return node.path
    for (const direction of directions) {
      const plan = planStageMove({ ...state, player: node.player }, direction); if (!plan) continue
      const key = `${plan.to.x},${plan.to.y}`; if (seen.has(key)) continue
      seen.add(key); queue.push({ player: plan.to, path: [...node.path, direction] })
    }
  }
  throw new Error('Unreachable ' + JSON.stringify(target))
}
function playAll(dispatch: (action: StageAction) => StageState, initial: StageState) {
  let state = initial; const actions: StageAction[] = []
  const send = (a: StageAction) => { actions.push(a); state = dispatch(a) }
  for (const target of [...GEMS, { x: 21, y: 12 }]) for (const direction of route(state, target)) send({ type: 'MOVE', direction })
  for (let i = 0; i < 300 && state.anaconda.mode !== 'retreated'; i++) {
    if (state.anaconda.mode === 'tell' && state.anaconda.targets.some(p => sameCell(p, state.player))) {
      const direction = directions.find(d => { const plan = planStageMove(state, d); return plan && !state.anaconda.targets.some(p => sameCell(p, plan.to)) })
      if (!direction) throw new Error('Telegraph has no safe next step')
      send({ type: 'MOVE', direction })
    }
    send({ type: 'TICK' })
  }
  expect(state.anaconda.mode).toBe('retreated')
  for (const direction of route(state, EXIT)) send({ type: 'MOVE', direction })
  return { state, actions }
}
describe('Inner Sanctuary isolated Stage III', () => {
  it('has six areas in a closed 30×24 world, 12 Gems / 8 required, two snakes and at most one monkey', () => {
    expect(stageMap.collision).toMatchObject({ width: 30, height: 24 }); expect(stageMap.world).toEqual({ width: 960, height: 768 })
    expect(GEMS).toHaveLength(12); expect(new Set(GEMS.map(g => `${g.x},${g.y}`)).size).toBe(12); expect(GEM_REQUIREMENT).toBe(8)
    expect(SNAKES).toHaveLength(2); expect(MONKEYS.length).toBeLessThanOrEqual(1); expect(BOSS_BODY).toHaveLength(6)
    for (const gem of GEMS) expect(stageMap.collision.layout[gem.y][gem.x]).toBe('.')
  })
  it('receives exact Stage II HP/Gems/items and resets stage-local state', () => {
    const runtime = replayEnvelope(priorEnvelope, factories), carry = runtime.state.stageCarryIn
    const run = runtime.attachStage(innerSanctuaryAdapter)
    expect(run.state).toEqual(initialStageState(carry)); expect(run.state).toMatchObject({ hp: 48, expeditionGems: 16, stageGems: 0, collected: [], boulders: [], exitUnlocked: false })
    expect(run.state.anaconda.mode).toBe('dormant'); expect(run.state.snakes.every(s => s.mode === 'dormant')).toBe(true)
    const items = { sword: true, potion: { owned: true, consumed: true } }, input = { hp: 47, expeditionGems: 20, carriedItems: items }
    const initial = innerSanctuaryAdapter.create(input)
    expect(innerSanctuaryAdapter.report(initial, input, 0).progress.carriedItems).toEqual(items)
    expect(() => initialStageState({ hp: 0, expeditionGems: 1 })).toThrow(/zero HP/)
  })
  it('activates deterministically and grants a full presence interval without a strike', () => {
    const entered = { ...fresh(), player: { x: 13, y: 7 } }, active = reduceStage(entered, { type: 'TICK' })
    expect(active.anaconda.mode).toBe('presence'); expect(active.hp).toBe(100)
    expect(active.events.at(-1)?.type).toBe('ANACONDA_ACTIVATED')
    expect(ticks(active, ANACONDA.presenceTicks - 1).anaconda.mode).toBe('presence')
    const tell = ticks(active, ANACONDA.presenceTicks)
    expect(tell.anaconda.mode).toBe('tell'); expect(tell.hp).toBe(100)
    expect(ticks(structuredClone(active), ANACONDA.presenceTicks)).toEqual(tell)
  })
  it('snapshots a deterministic strike lane, marks it for eight ticks and damages only occupied target cells', () => {
    let tell = ticks(reduceStage({ ...fresh(), player: { x: 21, y: 12 } }, { type: 'TICK' }), ANACONDA.presenceTicks)
    expect(tell.anaconda.targets).toEqual([{ x: 20, y: 12 }, { x: 21, y: 12 }, { x: 22, y: 12 }])
    expect(ticks(tell, ANACONDA.tellTicks - 1).hp).toBe(100)
    const hit = ticks(tell, ANACONDA.tellTicks)
    expect(hit.hp).toBe(100 - DAMAGE.anaconda); expect(hit.anaconda.strikesResolved).toBe(1)
    tell = reduceStage(tell, { type: 'MOVE', direction: 'DOWN' })
    const dodge = ticks(tell, ANACONDA.tellTicks)
    expect(dodge.hp).toBe(100); expect(dodge.events.find(e => e.type === 'ANACONDA_STRIKE')).toMatchObject({ hit: false, resolved: true })
  })
  it('uses normal six-tick immunity, clamps HP to zero and cannot unlock on a lethal final strike', () => {
    const seed = { ...fresh(), player: { x: 21, y: 12 }, hp: 20, stageGems: 8, anaconda: { ...fresh().anaconda, mode: 'tell' as const, nextTick: 1, targets: [{ x: 21, y: 12 }], strikesResolved: 2 } }
    const failed = reduceStage(seed, { type: 'TICK' })
    expect(failed).toMatchObject({ hp: 0, status: 'failed', exitUnlocked: false, result: null })
    expect(failed.events.find(e => e.type === 'DAMAGE')).toMatchObject({ amount: 20 })
    expect(reduceStage(failed, { type: 'MOVE', direction: 'UP' })).toBe(failed)
    const immune = reduceStage({ ...seed, hp: 50, invulnerableUntil: 2 }, { type: 'TICK' })
    expect(immune.hp).toBe(50)
  })
  it('reserves the player and one-step halo when creating blocks, and releases even after leaving the encounter', () => {
    const seed = { ...fresh(), player: { x: 13, y: 10 }, anaconda: { ...fresh().anaconda, mode: 'tell' as const, nextTick: 1 } }
    const blocked = reduceStage(seed, { type: 'TICK' })
    expect(blocked.anaconda.blockedCells).toEqual([{ x: 14, y: 11 }])
    for (const p of blocked.anaconda.blockedCells) expect(Math.abs(p.x - blocked.player.x) + Math.abs(p.y - blocked.player.y)).toBeGreaterThan(1)
    expect(planStageMove({ ...blocked, player: { x: 14, y: 10 } }, 'DOWN')).toBeNull()
    const outside = { ...blocked, player: { x: 4, y: 19 } }
    expect(ticks(outside, ANACONDA.coilTicks - 1).anaconda.blockedCells).toHaveLength(1)
    const released = ticks(outside, ANACONDA.coilTicks)
    expect(released.anaconda.blockedCells).toEqual([]); expect(released.events.at(-1)?.type).toBe('ANACONDA_COIL_RELEASED')
  })
  it('every authored blocked configuration retains a route to every Gem and exit from every remaining floor cell', () => {
    // A gate's subsets cover all halo-filtered outcomes. Exhaustively prove
    // connected walkability, not just release eventually masking a softlock.
    for (const gate of ANACONDA.gates) for (let mask = 0; mask < 1 << gate.length; mask++) {
      const blockedCells = gate.filter((_p, i) => mask & (1 << i)), state = { ...fresh(), exitUnlocked: true, anaconda: { ...fresh().anaconda, blockedCells } }
      const reachable = new Set<string>(), queue: GridCoord[] = [stageMap.collision.playerStart]
      for (let i = 0; i < queue.length; i++) for (const d of directions) {
        const plan = planStageMove({ ...state, player: queue[i] }, d); if (!plan) continue
        const key = `${plan.to.x},${plan.to.y}`; if (reachable.has(key)) continue
        reachable.add(key); queue.push(plan.to)
      }
      for (const p of [...GEMS, EXIT]) expect(reachable.has(`${p.x},${p.y}`), JSON.stringify(blockedCells) + ':' + JSON.stringify(p)).toBe(true)
      for (let y = 0; y < 24; y++) for (let x = 0; x < 30; x++) if (stageMap.collision.layout[y][x] !== '#' && !blockedCells.some(p => p.x === x && p.y === y)) expect(reachable.has(`${x},${y}`)).toBe(true)
    }
  })
  it('requires three resolved strikes with one in the Sanctum; waiting outside cannot progress the objective', () => {
    const seed = { ...fresh(), player: { x: 4, y: 19 }, anaconda: { ...fresh().anaconda, mode: 'tell' as const, nextTick: 1, targets: [{ x: 13, y: 8 }], strikesResolved: 2 } }
    const outside = reduceStage(seed, { type: 'TICK' })
    expect(outside.anaconda.strikesResolved).toBe(2); expect(outside.anaconda.objectiveSatisfied).toBe(false)
    const passage = reduceStage({ ...seed, player: { x: 13, y: 8 } }, { type: 'TICK' })
    expect(passage.anaconda.strikesResolved).toBe(3); expect(passage.anaconda.objectiveSatisfied).toBe(false)
    const sanctum = reduceStage({ ...seed, player: { x: 21, y: 12 } }, { type: 'TICK' })
    expect(sanctum.anaconda.objectiveSatisfied).toBe(true); expect(sanctum.anaconda.sanctumStrikes).toBe(1)
  })
  it('keeps exit locked until BOTH Gem and encounter requirements; unlocks exactly once and clears all coils', () => {
    for (const [gems, objective] of [[7, true], [8, false]] as const) {
      const state = reduceStage({ ...fresh(), stageGems: gems, anaconda: { ...fresh().anaconda, objectiveSatisfied: objective } }, { type: 'TICK' })
      expect(state.exitUnlocked).toBe(false); expect(planStageMove({ ...state, player: { x: 25, y: 4 } }, 'UP')).toBeNull()
    }
    const state = reduceStage({ ...fresh(), stageGems: 8, anaconda: { ...fresh().anaconda, mode: 'coil', nextTick: 20, blockedCells: [...ANACONDA.gates[0]], objectiveSatisfied: true } }, { type: 'TICK' })
    expect(state.exitUnlocked).toBe(true); expect(state.anaconda.mode).toBe('retreated'); expect(state.anaconda.blockedCells).toEqual([])
    expect(ticks(state, 30).events.filter(e => e.type === 'EXIT_UNLOCKED')).toHaveLength(1)
  })
  it('allows optional Gems after unlock, collects each once, and preserves all completion values', () => {
    const seed = { ...fresh(), hp: 47, stageGems: 8, expeditionGems: 24, exitUnlocked: true, player: { x: 25, y: 5 }, anaconda: { ...fresh().anaconda, mode: 'retreated' as const } }
    const ninth = reduceStage(seed, { type: 'MOVE', direction: 'UP' })
    expect(ninth).toMatchObject({ stageGems: 9, expeditionGems: 25 })
    const revisit = reduceStage(reduceStage(ninth, { type: 'MOVE', direction: 'DOWN' }), { type: 'MOVE', direction: 'UP' })
    expect(revisit.stageGems).toBe(9)
    const completed = reduceStage(revisit, { type: 'MOVE', direction: 'UP' })
    expect(completed.result).toEqual({ gems: 9, expeditionGems: 25, hp: 47 })
    expect(reduceStage(completed, { type: 'TICK' })).toBe(completed)
  })
  it('ordinary snakes/monkey/rubble remain deterministic, and directions never skip cells or move diagonally', () => {
    const entered = { ...fresh(), player: { x: 9, y: 10 } }
    expect(ticks(entered, 40)).toEqual(ticks(structuredClone(entered), 40))
    expect(ticks(entered, 40).events.some(e => e.type === 'SNAKE_MOVED')).toBe(true)
    const ritual = ticks({ ...fresh(), player: { x: 9, y: 4 } }, 40)
    expect(ritual.events.some(e => e.type === 'MONKEY_ROCK_IMPACT')).toBe(true)
    expect(ticks({ ...fresh(), player: { x: 4, y: 5 } }, 20).events.some(e => e.type === 'RUBBLE_IMPACT')).toBe(true)
    expect(planStageMove(fresh(), 'DIAGONAL' as Direction)).toBeNull()
    for (const d of directions) { const plan = planStageMove(fresh(), d); if (plan) expect(Math.abs(plan.to.x - plan.from.x) + Math.abs(plan.to.y - plan.from.y)).toBe(1) }
  })
  it('full real-adapter I → II → III envelope completes exactly once and replays HP, Gems, results and boss transitions identically', () => {
    const runtime = replayEnvelope(priorEnvelope, factories), run = runtime.attachStage(innerSanctuaryAdapter)
    const played = playAll(action => run.dispatch(action), run.state), envelope = runtime.envelope()
    expect(runtime.state).toMatchObject({ status: 'COMPLETE', stageGems: 12, expeditionGems: 28, completedStages: ['outer-ruins', 'overgrown-temple', 'inner-sanctuary'] })
    expect(runtime.state.stageResults).toHaveLength(3); expect(runtime.state.hp).toBe(played.state.hp)
    expect(runtime.state.events.at(-1)?.type).toBe('EXPEDITION_COMPLETED')
    expect(replayEnvelope(structuredClone(envelope), factories).envelope()).toEqual(envelope)
    expect(replayStage(played.actions, priorEnvelope.snapshot.stageCarryIn)).toEqual(played.state)
    const before = runtime.envelope(); runtime.continue(); run.dispatch({ type: 'TICK' }); expect(runtime.envelope()).toEqual(before)
  })
  it('failed Stage III blocks completion/advance and retains prior results in the replay envelope', () => {
    const runtime = replayEnvelope(priorEnvelope, factories), run = runtime.attachStage(innerSanctuaryAdapter)
    for (const d of route(run.state, { x: 8, y: 4 })) run.dispatch({ type: 'MOVE', direction: d })
    for (let i = 0; i < 80 && runtime.state.status === 'PLAYING'; i++) run.dispatch({ type: 'TICK' })
    expect(runtime.state.status).toBe('FAILED'); expect(runtime.state.hp).toBe(0); expect(runtime.state.stageResults).toHaveLength(2)
    expect(runtime.continue().status).toBe('FAILED'); expect(runtime.envelope().entries.at(-1)?.type).toBe('STAGE_FAILED')
    expect(replayEnvelope(runtime.envelope(), factories).state).toEqual(runtime.state)
  })
  it('replays the recorded full browser expedition and every Anaconda transition exactly', () => {
    const path = 'docs/angkor-v2/stage3/qa/full-expedition-envelope.json'
    const envelope = JSON.parse(readFileSync(path, 'utf8')) as GemRunnerEnvelope
    expect(replayEnvelope(envelope, factories).envelope()).toEqual(envelope)
    expect(envelope.snapshot).toMatchObject({ status: 'COMPLETE', currentStage: 'inner-sanctuary' })
    const carry = envelope.entries.find(e => e.type === 'STAGE_STARTED' && e.stageId === 'inner-sanctuary')!
    if (carry.type !== 'STAGE_STARTED') throw new Error('Missing Stage III carry')
    const actions = envelope.entries.flatMap(e => e.type === 'STAGE_ACTION' && e.stageId === 'inner-sanctuary' ? [e.action as StageAction] : [])
    const state = replayStage(actions, carry.carry)
    const expected = JSON.parse(readFileSync('docs/angkor-v2/stage3/qa/anaconda-proof.json', 'utf8'))
    expect({ result: state.result, anaconda: state.anaconda, events: state.events.filter(e => e.type.startsWith('ANACONDA_')) }).toEqual(expected)
  })
})
