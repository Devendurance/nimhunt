import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ANACONDA, BOULDERS, BOSS_BODY, EXIT, GEMS, GEM_REQUIREMENT, MONKEYS, PITS, PIT_ORDER, SNAKES, SPIKES, stageMap } from './level'
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
      const plan = planStageMove({ ...state, player: node.player }, direction)
      if (!plan || plan.push || SPIKES.some(s => s.tiles.some(p => sameCell(p, plan.to)))) continue
      const key = `${plan.to.x},${plan.to.y}`; if (seen.has(key)) continue
      seen.add(key); queue.push({ player: plan.to, path: [...node.path, direction] })
    }
  }
  throw new Error('Unreachable ' + JSON.stringify(target))
}
const vulnerable = (phase = 1): StageState => ({ ...fresh(), player: { x: PITS[PIT_ORDER[phase - 1]].x, y: 10 }, anaconda: {
  ...fresh().anaconda, mode: 'VULNERABLE', phase, activePit: PIT_ORDER[phase - 1], successfulHits: phase - 1,
  vulnerableUntil: ANACONDA.phases[phase - 1].vulnerableTicks,
} })
function playAll(dispatch: (action: StageAction) => StageState, initial: StageState) {
  let state = initial; const actions: StageAction[] = []
  const send = (a: StageAction) => { actions.push(a); state = dispatch(a) }
  const go = (target: GridCoord) => { for (const direction of route(state, target)) send({ type: 'MOVE', direction }) }
  const wait = (predicate: () => boolean) => {
    for (let i = 0; i < 180 && !predicate() && state.status === 'playing'; i++) send({ type: 'TICK' })
    expect(predicate()).toBe(true)
  }
  for (const target of GEMS) go(target)
  for (let phase = 1; phase <= 3; phase++) {
    go({ x: PITS[PIT_ORDER[phase - 1]].x, y: 10 })
    wait(() => state.anaconda.mode === 'VULNERABLE' && state.anaconda.phase === phase)
    send({ type: 'MOVE', direction: 'DOWN' })
    send({ type: 'MOVE', direction: 'UP' }); send({ type: 'MOVE', direction: 'UP' })
    wait(() => state.anaconda.successfulHits === phase)
    wait(() => phase === 3 ? state.anaconda.objectiveSatisfied : state.anaconda.phase === phase + 1)
  }
  go(EXIT)
  return { state, actions }
}
describe('Inner Sanctuary environmental Anaconda boss', () => {
  it('keeps the 30×24 world, 12 Gems / 8 required and non-boss wildlife; authors three pits/rails', () => {
    expect(stageMap.collision).toMatchObject({ width: 30, height: 24 }); expect(stageMap.world).toEqual({ width: 960, height: 768 })
    expect(GEMS).toHaveLength(12); expect(GEM_REQUIREMENT).toBe(8); expect(new Set(GEMS.map(g => `${g.x},${g.y}`)).size).toBe(12)
    expect(SNAKES).toHaveLength(2); expect(MONKEYS).toHaveLength(1); expect(BOSS_BODY).toHaveLength(3); expect(BOULDERS).toHaveLength(3)
    for (const gem of GEMS) expect(stageMap.collision.layout[gem.y][gem.x]).toBe('.')
    for (const pit of Object.values(PITS)) expect(stageMap.collision.layout[pit.y][pit.x]).toBe('#')
  })
  it('receives exact carry and fresh local rails; never leaks Stage II puzzle state', () => {
    const runtime = replayEnvelope(priorEnvelope, factories), carry = runtime.state.stageCarryIn, run = runtime.attachStage(innerSanctuaryAdapter)
    expect(run.state).toEqual(initialStageState(carry)); expect(run.state).toMatchObject({ hp: 48, expeditionGems: 16, stageGems: 0, collected: [], exitUnlocked: false })
    expect(run.state.boulders.map(b => b.id)).toEqual(BOULDERS.map(b => b.id)); expect(run.state.anaconda.mode).toBe('DORMANT')
    const input = { hp: 47, expeditionGems: 20, carriedItems: { sword: true, potion: { owned: true, consumed: true } } }
    expect(innerSanctuaryAdapter.report(innerSanctuaryAdapter.create(input), input, 0).progress.carriedItems).toEqual(input.carriedItems)
    expect(() => initialStageState({ hp: 0, expeditionGems: 1 })).toThrow(/zero HP/)
  })
  it('activates only in Sanctum, gives a full emergence tell and deterministic vulnerability deadline', () => {
    expect(ticks({ ...fresh(), player: { x: 13, y: 7 } }, 100).anaconda.mode).toBe('DORMANT')
    const active = ticks({ ...fresh(), player: { x: 24, y: 10 } }, 1)
    expect(active.anaconda.mode).toBe('EMERGING'); expect(active.events.at(-1)?.type).toBe('ANACONDA_EMERGED')
    expect(ticks(active, ANACONDA.emergenceTicks - 1).anaconda.mode).toBe('EMERGING')
    const ready = ticks(active, ANACONDA.emergenceTicks)
    expect(ready.anaconda.mode).toBe('VULNERABLE'); expect(ready.hp).toBe(100)
    expect(ready.anaconda.vulnerableUntil).toBe(ready.tick + 80)
    expect(ticks(structuredClone(active), ANACONDA.emergenceTicks)).toEqual(ready)
  })
  it('rejects wrong-pit, wrong-direction, solid, occupied and last-moment drops without damage', () => {
    const state = vulnerable()
    for (const direction of ['LEFT', 'RIGHT'] as const) expect(planStageMove({ ...state, player: { x: direction === 'LEFT' ? 25 : 23, y: 11 } }, direction)).toBeNull()
    const wrong = { ...state, player: { x: 22, y: 10 } }
    expect(reduceStage(wrong, { type: 'MOVE', direction: 'DOWN' })).toBe(wrong)
    expect(planStageMove({ ...state, player: { x: 24, y: 12 } }, 'DOWN')).toBeNull()
    expect(planStageMove({ ...state, boulders: [...state.boulders, { id: 'other', x: 24, y: 12 }] }, 'DOWN')).toBeNull()
    expect(planStageMove({ ...state, tick: state.anaconda.vulnerableUntil - 1 }, 'DOWN')).toBeNull()
    expect(state.anaconda.successfulHits).toBe(0)
  })
  it('a correct one-tile drop consumes its boulder and gives exactly one hit after the fixed flight', () => {
    const dropped = reduceStage(vulnerable(), { type: 'MOVE', direction: 'DOWN' })
    expect(dropped.player).toEqual({ x: 24, y: 11 }); expect(dropped.boulders).toHaveLength(2)
    expect(dropped.events.some(e => e.type === 'BOULDER_DROP_TRIGGERED')).toBe(true)
    expect(ticks(dropped, ANACONDA.dropTicks - 1).anaconda.successfulHits).toBe(0)
    const hit = ticks(dropped, ANACONDA.dropTicks)
    expect(hit.anaconda.successfulHits).toBe(1); expect(hit.anaconda.mode).toBe('RETALIATING')
    expect(ticks({ ...hit, player: { x: 24, y: 9 } }, 60).events.filter(e => e.type === 'ANACONDA_HIT')).toHaveLength(1)
    expect(hit.anaconda.pendingDrop).toBeNull()
  })
  it('an accepted drop remains valid across the deadline; holding DOWN cannot reuse the consumed rock', () => {
    const seed = vulnerable(), late = { ...seed, tick: seed.anaconda.vulnerableUntil - 2 }
    const dropped = reduceStage(late, { type: 'MOVE', direction: 'DOWN' })
    const walking = reduceStage(dropped, { type: 'MOVE', direction: 'DOWN' })
    expect(walking.anaconda.pendingDrop).toEqual(dropped.anaconda.pendingDrop)
    const hit = ticks(walking, 4)
    expect(hit.anaconda.successfulHits).toBe(1)
    expect(hit.events.filter(e => e.type === 'BOULDER_DROP_TRIGGERED')).toHaveLength(1)
    expect(hit.events.filter(e => e.type === 'ANACONDA_HIT')).toHaveLength(1)
  })
  it('missed windows keep their boulders and phase; retrying can still hit', () => {
    const missed = ticks(vulnerable(), 80)
    expect(missed.anaconda).toMatchObject({ mode: 'RETALIATING', phase: 1, successfulHits: 0 }); expect(missed.boulders).toHaveLength(3)
    const retry = ticks({ ...missed, player: { x: 24, y: 9 } }, 16 + 10 + 12)
    expect(retry.anaconda).toMatchObject({ mode: 'VULNERABLE', phase: 1, activePit: 'PIT_CENTER' })
    expect(ticks(reduceStage({ ...retry, player: { x: 24, y: 10 } }, { type: 'MOVE', direction: 'DOWN' }), 4).anaconda.successfulHits).toBe(1)
  })
  it('all retaliation phases have reachable safe recesses, fixed impact and baseline immunity/damage', () => {
    for (let phase = 1; phase <= 3; phase++) {
      const seed = vulnerable(phase), tell = ticks(seed, ANACONDA.phases[phase - 1].vulnerableTicks)
      expect(tell.anaconda.targets.length).toBe([8, 16, 24][phase - 1])
      const safe = { x: seed.player.x, y: 9 }
      expect(route(tell, safe).length).toBeLessThanOrEqual(2); expect(tell.anaconda.targets.some(p => sameCell(p, safe))).toBe(false)
      const onLane = { ...tell, player: { x: 23, y: 11 } }
      const impact = ticks(onLane, ANACONDA.phases[phase - 1].tellTicks)
      expect(impact.hp).toBe(74); expect(impact.anaconda.mode).toBe('RECOVERING')
      expect(ticks({ ...tell, player: safe }, ANACONDA.phases[phase - 1].tellTicks).hp).toBe(100)
      expect(ticks({ ...onLane, invulnerableUntil: 1000 }, ANACONDA.phases[phase - 1].tellTicks).hp).toBe(100)
    }
    expect(DAMAGE.anaconda).toBe(26)
  })
  it('replacement lands on schedule, damages a stationary player, then reserves the moving-player halo before readiness', () => {
    const hit = ticks(reduceStage(vulnerable(), { type: 'MOVE', direction: 'DOWN' }), 4)
    const warning = ticks({ ...hit, player: { x: 24, y: 9 } }, 16)
    expect(warning.anaconda.replacement?.mode).toBe('TELEGRAPH')
    const impact = ticks({ ...warning, player: { x: 24, y: 11 } }, 16)
    expect(impact.hp).toBe(76); expect(DAMAGE.replacementBoulder).toBe(24)
    expect(impact.anaconda.replacement?.mode).toBe('LANDED'); expect(impact.boulders).toHaveLength(2)
    expect(impact.events.filter(e => e.type === 'REPLACEMENT_BOULDER_IMPACT')).toHaveLength(1)
    expect(ticks({ ...impact, player: { x: 24, y: 10 } }, 1).boulders).toHaveLength(2)
    const ready = ticks({ ...impact, player: { x: 24, y: 9 } }, 1)
    expect(ready.anaconda.replacement).toBeNull(); expect(ready.boulders).toHaveLength(3)
    expect(ready.events.some(e => e.type === 'REPLACEMENT_BOULDER_READY')).toBe(true)
    expect(ticks({ ...structuredClone(warning), player: { x: 24, y: 11 } }, 16)).toEqual(impact)
  })
  it('successful retaliation resolves before replacement warning; misses never spawn replacements', () => {
    const hit = ticks(reduceStage(vulnerable(), { type: 'MOVE', direction: 'DOWN' }), 4)
    expect(hit.anaconda.replacement?.mode).toBe('WAITING')
    expect(hit.events.some(e => e.type === 'REPLACEMENT_BOULDER_TELEGRAPH')).toBe(false)
    const replaced = ticks({ ...hit, player: { x: 24, y: 9 } }, 16)
    const impactIndex = replaced.events.findIndex(e => e.type === 'ANACONDA_RETALIATION_IMPACT')
    expect(replaced.events[impactIndex + 1].type).toBe('REPLACEMENT_BOULDER_TELEGRAPH')
    const missed = ticks({ ...vulnerable(), player: { x: 24, y: 9 } }, 120)
    expect(missed.events.some(e => e.type.startsWith('REPLACEMENT_'))).toBe(false)
  })
  it('every intended consumed/ready rail combination retains every Gem, each approach and a safe exit route', () => {
    // Rails permit only a successful consumption; no displaced loose-stone state exists.
    // Exhaust all 8 availability states, including waiting for replacements.
    for (let mask = 0; mask < 8; mask++) {
      const seed = { ...fresh(), exitUnlocked: true, boulders: fresh().boulders.filter((_b, i) => mask & (1 << i)) }
      for (const target of [...GEMS, EXIT, ...BOULDERS.map(b => ({ x: b.x, y: 10 })), { x: 24, y: 9 }, { x: 24, y: 14 }]) expect(route(seed, target)).toBeDefined()
    }
  })
  it('three legal phases use CENTER → LEFT → RIGHT, defeat exactly on hit three and never emit coil/survival events', () => {
    let current = fresh()
    const played = playAll(a => current = reduceStage(current, a), current)
    expect(played.state.anaconda).toMatchObject({ mode: 'DEFEATED', successfulHits: 3, objectiveSatisfied: true, phase: 3 })
    const hits = played.state.events.filter(e => e.type === 'ANACONDA_HIT')
    expect(hits.map(e => e.pit)).toEqual(PIT_ORDER)
    expect(played.state.events.filter(e => e.type === 'ANACONDA_DEFEATED')).toHaveLength(1)
    expect(played.state.events.filter(e => e.type === 'REPLACEMENT_BOULDER_READY')).toHaveLength(3)
    expect(played.state.events.some(e => e.type.includes('COIL') || e.type === ('ANACONDA_RETREATED' as string))).toBe(false)
    expect(reduceStage(played.state, { type: 'TICK' })).toBe(played.state)
  })
  it('exit requires three hits, completed defeat pause and >=8 Gems; defeated boss stays down while Gems are collected', () => {
    let state = fresh()
    const complete = playAll(a => state = reduceStage(state, a), state).state
    const bossOnly = { ...complete, status: 'playing' as const, result: null, stageGems: 7, expeditionGems: 23, exitUnlocked: false, collected: [], player: { x: 25, y: 5 } }
    expect(ticks(bossOnly, 20).exitUnlocked).toBe(false)
    expect(planStageMove({ ...bossOnly, player: { x: 25, y: 4 } }, 'UP')).toBeNull()
    const eighth = reduceStage(bossOnly, { type: 'MOVE', direction: 'UP' })
    expect(eighth.exitUnlocked).toBe(true); expect(eighth.anaconda.mode).toBe('DEFEATED')
    const again = reduceStage(reduceStage(eighth, { type: 'MOVE', direction: 'DOWN' }), { type: 'MOVE', direction: 'UP' })
    expect(again.stageGems).toBe(8)
    for (const mode of ['DORMANT', 'VULNERABLE'] as const) expect(ticks({ ...fresh(), stageGems: 12, anaconda: { ...fresh().anaconda, mode } }, 1).exitUnlocked).toBe(false)
    const terminal = reduceStage(again, { type: 'MOVE', direction: 'UP' })
    expect(terminal.result).toEqual({ gems: 8, expeditionGems: 24, hp: complete.hp })
    expect(reduceStage(terminal, { type: 'MOVE', direction: 'UP' })).toBe(terminal)
  })
  it('ordinary wildlife/hazards stay deterministic; cardinal movement never skips tiles', () => {
    const entered = { ...fresh(), player: { x: 9, y: 10 } }
    expect(ticks(entered, 40)).toEqual(ticks(structuredClone(entered), 40))
    expect(ticks(entered, 40).events.some(e => e.type === 'SNAKE_MOVED')).toBe(true)
    expect(ticks({ ...fresh(), player: { x: 9, y: 4 } }, 40).events.some(e => e.type === 'MONKEY_ROCK_IMPACT')).toBe(true)
    expect(ticks({ ...fresh(), player: { x: 4, y: 5 } }, 20).events.some(e => e.type === 'RUBBLE_IMPACT')).toBe(true)
    expect(planStageMove(fresh(), 'DIAGONAL' as Direction)).toBeNull()
    for (const d of directions) { const plan = planStageMove(fresh(), d); if (plan) expect(Math.abs(plan.to.x - plan.from.x) + Math.abs(plan.to.y - plan.from.y)).toBe(1) }
  })
  it('full real-adapter I → II → III replay preserves pit/hit/replacement/retaliation, exact HP/Gems/items and completion once', () => {
    const runtime = replayEnvelope(priorEnvelope, factories), run = runtime.attachStage(innerSanctuaryAdapter)
    const played = playAll(action => run.dispatch(action), run.state), envelope = runtime.envelope()
    expect(runtime.state).toMatchObject({ status: 'COMPLETE', stageGems: 12, expeditionGems: 28, completedStages: ['outer-ruins', 'overgrown-temple', 'inner-sanctuary'] })
    expect(runtime.state.stageResults).toHaveLength(3); expect(runtime.state.hp).toBe(played.state.hp)
    expect(replayEnvelope(structuredClone(envelope), factories).envelope()).toEqual(envelope)
    expect(replayStage(played.actions, priorEnvelope.snapshot.stageCarryIn)).toEqual(played.state)
    expect(runtime.state.events.at(-1)?.type).toBe('EXPEDITION_COMPLETED')
    const before = runtime.envelope(); runtime.continue(); run.dispatch({ type: 'TICK' }); expect(runtime.envelope()).toEqual(before)
  })
  it('death during retaliation fails the expedition and retains prior completed results', () => {
    const runtime = replayEnvelope(priorEnvelope, factories), run = runtime.attachStage(innerSanctuaryAdapter)
    for (const direction of route(run.state, { x: 23, y: 11 })) run.dispatch({ type: 'MOVE', direction })
    for (let i = 0; i < 500 && runtime.state.status === 'PLAYING'; i++) run.dispatch({ type: 'TICK' })
    expect(runtime.state.status).toBe('FAILED'); expect(runtime.state.hp).toBe(0); expect(runtime.state.stageResults).toHaveLength(2)
    expect(runtime.continue().status).toBe('FAILED'); expect(replayEnvelope(runtime.envelope(), factories).state).toEqual(runtime.state)
  })
  it('replays the recorded browser expedition and all boss events/stone replacements exactly', () => {
    const envelope = JSON.parse(readFileSync('docs/angkor-v2/anaconda-rework/qa/full-expedition-envelope.json', 'utf8')) as GemRunnerEnvelope
    expect(replayEnvelope(envelope, factories).envelope()).toEqual(envelope)
    expect(envelope.snapshot).toMatchObject({ status: 'COMPLETE', currentStage: 'inner-sanctuary', expeditionGems: 29 })
    const carry = envelope.entries.find(e => e.type === 'STAGE_STARTED' && e.stageId === 'inner-sanctuary')!
    if (carry.type !== 'STAGE_STARTED') throw new Error('Missing Stage III carry')
    const actions = envelope.entries.flatMap(e => e.type === 'STAGE_ACTION' && e.stageId === 'inner-sanctuary' ? [e.action as StageAction] : [])
    const state = replayStage(actions, carry.carry)
    const events = state.events.filter(e => e.type.startsWith('ANACONDA_') || e.type.startsWith('REPLACEMENT_') || e.type === 'BOULDER_DROP_TRIGGERED')
    const proof = JSON.parse(readFileSync('docs/angkor-v2/anaconda-rework/qa/boss-proof.json', 'utf8'))
    expect({ result: state.result, anaconda: state.anaconda, boulders: state.boulders, events }).toEqual(proof)
    expect(state.events.filter(e => e.type === 'ANACONDA_DEFEATED')).toHaveLength(1)
    expect(state.events.filter(e => e.type === 'EXIT_UNLOCKED')).toHaveLength(1)
    expect(state.anaconda.successfulHits).toBe(3)
    expect(state.events.filter(e => e.type === 'STAGE_COMPLETE')).toHaveLength(1)
    expect(envelope.snapshot.events.filter(e => e.type === 'EXPEDITION_COMPLETED')).toHaveLength(1)
  })

})
