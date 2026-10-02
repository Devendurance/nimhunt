import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { GEM_RUNNER_STAGES, copyCarry, freshCarry, type StageAdapter, type StageCarry, type StageResult } from './contracts'
import { expeditionCarry, initialGemRunnerState, reduceExpedition, replayLifecycle, type ExpeditionAction } from './model'
import { GemRunnerRuntime, replayEnvelope, stageFactory } from './runtime'
import { outerRuinsAdapter, type OuterRuinsAction } from './outerRuinsAdapter'
import { initialStageState, replayStage, type StageState } from '../stage1/model'

const touch = JSON.parse(readFileSync('docs/angkor-v2/stage1/qa/touch-playthrough.json', 'utf8')) as { actions: OuterRuinsAction[]; expectedResult: { gems: number; expeditionGems: number; hp: number }; expectedEvents: StageState['events'] }
const keyboard = JSON.parse(readFileSync('docs/angkor-v2/stage1/qa/keyboard-playthrough.json', 'utf8')) as { actions: OuterRuinsAction[]; actual: StageState }
const items = { sword: true, potion: { owned: true, consumed: true } }
const result = (index: number, hp: number, stageGems: number, total: number): StageResult => ({ stageId: GEM_RUNNER_STAGES[index].id, hpRemaining: hp, stageGems, expeditionGems: total, carriedItems: items, completion: { tick: 12, actionCount: 20 } })
function completedRuntime() {
  const runtime = new GemRunnerRuntime(), run = runtime.attachStage(outerRuinsAdapter)
  for (const action of touch.actions) run.dispatch(action)
  return { runtime, run }
}
describe('Gem Runner isolated expedition lifecycle', () => {
  it('defines exactly the three canonical stages and starts fresh at 100 HP / 0 Gems', () => {
    expect(GEM_RUNNER_STAGES.map(s => [s.id, s.name])).toEqual([['outer-ruins', 'Outer Ruins'], ['overgrown-temple', 'Overgrown Temple'], ['inner-sanctuary', 'Inner Sanctuary']])
    const state = initialGemRunnerState()
    expect(state).toMatchObject({ mission: 'gem-runner', version: 1, status: 'PLAYING', currentStage: 'outer-ruins', currentStageIndex: 0, hp: 100, stageGems: 0, expeditionGems: 0 })
    expect(outerRuinsAdapter.create(expeditionCarry(state))).toEqual(initialStageState())
    expect(state.events.map(e => e.type)).toEqual(['EXPEDITION_STARTED', 'STAGE_STARTED'])
  })
  it('preserves the entire approved fresh Stage I keyboard state and touch events/results', () => {
    expect(replayStage(keyboard.actions)).toEqual(keyboard.actual)
    const played = replayStage(touch.actions)
    expect(played.events).toEqual(touch.expectedEvents); expect(played.result).toEqual(touch.expectedResult)
  })
  it('adapts carry-in without changing local state shape and returns a durable result', () => {
    const carry: StageCarry = { hp: 83, expeditionGems: 13, carriedItems: items }
    const initial = outerRuinsAdapter.create(carry), state = replayStage(touch.actions, carry)
    expect(initial.hp).toBe(83); expect(initial.expeditionGems).toBe(13); expect(initial.stageGems).toBe(0)
    const report = outerRuinsAdapter.report(state, carry, touch.actions.length)
    expect(report.status).toBe('COMPLETE')
    if (report.status !== 'COMPLETE') throw new Error('Expected completion')
    expect(report.result).toEqual({ stageId: 'outer-ruins', stageGems: 8, expeditionGems: 21, hpRemaining: 47, carriedItems: items, completion: { tick: state.tick, actionCount: touch.actions.length } })
    expect(Object.keys(initial)).toEqual(Object.keys(initialStageState()))
  })
  it('updates real Stage I completion into a transition with carry/result/events', () => {
    const { runtime } = completedRuntime()
    expect(runtime.state).toMatchObject({ status: 'TRANSITION', currentStage: 'outer-ruins', hp: 64, stageGems: 8, expeditionGems: 8, completedStages: ['outer-ruins'] })
    expect(runtime.state.stageResults[0]).toMatchObject({ stageId: 'outer-ruins', hpRemaining: 64, stageGems: 8 })
    expect(runtime.state.events.slice(-2).map(e => e.type)).toEqual(['STAGE_COMPLETED', 'STAGE_TRANSITION_READY'])
    expect(runtime.state.events.map(e => e.seq)).toEqual([1, 2, 3, 4])
  })
  it('carries exact HP, cumulative Gems, sword and consumed potion; resets only stage Gems', () => {
    const first = reduceExpedition(initialGemRunnerState(), { type: 'STAGE_COMPLETED', result: result(0, 37, 7, 7) })
    const next = reduceExpedition(first, { type: 'CONTINUE' })
    expect(next).toMatchObject({ status: 'PLAYING', currentStage: 'overgrown-temple', currentStageIndex: 1, hp: 37, expeditionGems: 7, stageGems: 0, carriedItems: items })
    expect(next.stageCarryIn).toEqual(expeditionCarry(first))
    expect(first.status).toBe('TRANSITION'); expect(first.stageGems).toBe(7)
    const second = reduceExpedition(next, { type: 'STAGE_COMPLETED', result: result(1, 22, 5, 12) })
    const third = reduceExpedition(second, { type: 'CONTINUE' })
    expect(third).toMatchObject({ hp: 22, expeditionGems: 12, stageGems: 0, currentStage: 'inner-sanctuary' })
  })
  it('whitelists carry and never transports keys, boulders, snakes, monkey or hazards', () => {
    const extras = { ...freshCarry(), keys: ['key'], boulders: [{ x: 1, y: 2 }], snakes: [], monkey: {}, hazards: [] }
    expect(copyCarry(extras)).toEqual(freshCarry())
    const { runtime } = completedRuntime(); runtime.continue()
    expect(Object.keys(runtime.state.stageCarryIn)).toEqual(['hp', 'expeditionGems', 'carriedItems'])
    expect(JSON.stringify(runtime.state.stageResults)).not.toMatch(/boulders|snakes|monkey|keys|hazards/)
  })
  it('Continue advances exactly once to Stage II and cannot skip to Stage III', () => {
    const { runtime, run } = completedRuntime()
    const next = runtime.continue(), length = runtime.transcriptLength
    expect(next.currentStage).toBe('overgrown-temple'); expect(next.stageGems).toBe(0); expect(next.hp).toBe(64)
    expect(runtime.continue()).toBe(next); expect(runtime.transcriptLength).toBe(length)
    run.dispatch({ type: 'TICK' }); expect(runtime.transcriptLength).toBe(length)
    expect(reduceExpedition(next, { type: 'STAGE_COMPLETED', result: result(2, 10, 1, 9) })).toBe(next)
    expect(() => runtime.attachStage(outerRuinsAdapter)).toThrow(/current/)
  })
  it('cannot advance an unfinished or failed attempt and retains completed results on later failure', () => {
    const initial = initialGemRunnerState(); expect(reduceExpedition(initial, { type: 'CONTINUE' })).toBe(initial)
    const first = reduceExpedition(initial, { type: 'STAGE_COMPLETED', result: result(0, 20, 6, 6) }), next = reduceExpedition(first, { type: 'CONTINUE' })
    const failed = reduceExpedition(next, { type: 'STAGE_FAILED', stageId: 'overgrown-temple', progress: { hp: 0, expeditionGems: 7, stageGems: 1, carriedItems: items } })
    expect(failed.status).toBe('FAILED'); expect(failed.stageResults).toEqual(first.stageResults)
    expect(reduceExpedition(failed, { type: 'CONTINUE' })).toBe(failed)
    expect(failed.events.at(-1)?.type).toBe('EXPEDITION_FAILED')
  })
  it('ends the real Stage I runtime on zero HP with a durable failed boundary', () => {
    const runtime = new GemRunnerRuntime(), run = runtime.attachStage(outerRuinsAdapter)
    const firstSpike = keyboard.actual.events.findIndex(e => e.type === 'DAMAGE' && e.source === 'spikes')
    expect(firstSpike).toBeGreaterThan(-1)
    let reachedSpike = false
    for (const action of keyboard.actions) {
      const state = run.dispatch(action)
      if (state.player.x === 8 && state.player.y === 12) { reachedSpike = true; break }
    }
    expect(reachedSpike).toBe(true)
    for (let i = 0; i < 60; i++) run.dispatch({ type: 'TICK' })
    expect(runtime.state.status).toBe('FAILED'); expect(runtime.state.hp).toBe(0)
    expect(runtime.envelope().entries.at(-1)?.type).toBe('STAGE_FAILED')
    expect(runtime.continue().currentStage).toBe('outer-ruins')
    const replay = replayEnvelope(runtime.envelope(), { 'outer-ruins': stageFactory(outerRuinsAdapter) })
    expect(replay.state).toEqual(runtime.state)
  })
  it('cannot complete twice, restore consumed items or invent a Gem total', () => {
    const first = reduceExpedition(initialGemRunnerState(), { type: 'STAGE_COMPLETED', result: result(0, 37, 7, 7) })
    expect(reduceExpedition(first, { type: 'STAGE_COMPLETED', result: result(0, 100, 8, 8) })).toBe(first)
    const next = reduceExpedition(first, { type: 'CONTINUE' })
    expect(() => reduceExpedition(next, { type: 'STAGE_COMPLETED', result: { ...result(1, 37, 2, 9), carriedItems: freshCarry().carriedItems } })).toThrow(/items/)
    expect(() => reduceExpedition(next, { type: 'STAGE_COMPLETED', result: result(1, 37, 2, 2) })).toThrow(/Gems/)
  })
  it('finishes the three-stage lifecycle deterministically using contract results, with no maps for later stages', () => {
    const sequence: ExpeditionAction[] = [
      { type: 'STAGE_COMPLETED', result: result(0, 70, 6, 6) }, { type: 'CONTINUE' },
      { type: 'STAGE_COMPLETED', result: result(1, 50, 5, 11) }, { type: 'CONTINUE' },
      { type: 'STAGE_COMPLETED', result: result(2, 30, 4, 15) },
    ]
    const complete = replayLifecycle(sequence)
    expect(complete).toMatchObject({ status: 'COMPLETE', hp: 30, expeditionGems: 15, completedStages: GEM_RUNNER_STAGES.map(s => s.id) })
    expect(complete.events.at(-1)?.type).toBe('EXPEDITION_COMPLETED')
    expect(reduceExpedition(complete, { type: 'CONTINUE' })).toBe(complete)
    expect(replayLifecycle(JSON.parse(JSON.stringify(sequence)))).toEqual(complete)
  })
  it('records deterministic stage action/boundary order and verifies carry after Continue', () => {
    const { runtime } = completedRuntime(); runtime.continue()
    const envelope = runtime.envelope(), types = envelope.entries.filter(e => e.type !== 'STAGE_ACTION').map(e => e.type)
    expect(types).toEqual(['EXPEDITION_STARTED', 'STAGE_STARTED', 'STAGE_COMPLETED', 'STAGE_ADVANCED', 'STAGE_STARTED'])
    expect(envelope.entries.filter(e => e.type === 'STAGE_ACTION').map(e => e.actionIndex)).toEqual(touch.actions.map((_a, i) => i + 1))
    const replayed = replayEnvelope(JSON.parse(JSON.stringify(envelope)), { 'outer-ruins': stageFactory(outerRuinsAdapter) })
    expect(replayed.envelope()).toEqual(envelope)
  })
  it('rejects reordered boundaries, tampered carry, unsupported schemas and unbuilt-stage actions', () => {
    const { runtime } = completedRuntime(); runtime.continue()
    const good = runtime.envelope(), changed = structuredClone(good)
    const boundary = changed.entries.find(e => e.type === 'STAGE_COMPLETED')!
    const badCarry = { ...boundary, carryOut: freshCarry() }
    const factories = { 'outer-ruins': stageFactory(outerRuinsAdapter) }
    expect(() => replayEnvelope({ ...good, entries: good.entries.map(e => e === good.entries.find(x => x.type === 'STAGE_COMPLETED') ? badCarry : e) }, factories)).toThrow(/mismatch/)
    expect(() => replayEnvelope({ ...good, entries: [...good.entries.slice(0, 2), good.entries.at(-1)!, ...good.entries.slice(2)] }, factories)).toThrow(/boundary/)
    expect(() => replayEnvelope({ ...good, schema: 'bad' as typeof good.schema }, factories)).toThrow(/Unsupported/)
    expect(() => replayEnvelope({ ...good, entries: [...good.entries, { type: 'STAGE_ACTION', stageId: 'overgrown-temple', actionIndex: 1, action: { type: 'TICK' } }] }, factories)).toThrow(/not implemented/)
  })
  it('rejects reset/revive, duplicate stage attachment and invalid adapter results without corrupting the attempt', () => {
    const runtime = new GemRunnerRuntime(), run = runtime.attachStage(outerRuinsAdapter), before = runtime.envelope()
    expect(() => run.dispatch({ type: 'RESET' } as unknown as OuterRuinsAction)).toThrow(/reset/)
    expect(runtime.envelope()).toEqual(before)
    expect(() => runtime.attachStage(outerRuinsAdapter)).toThrow(/current/)
    const bad: StageAdapter<number, { type: 'TICK' }> = { definition: GEM_RUNNER_STAGES[0], create: () => 0, reduce: s => s + 1, isAction: (a): a is { type: 'TICK' } => Boolean(a), report: () => ({ status: 'FAILED', progress: { ...freshCarry(), stageGems: 0 } }) }
    const invalid = new GemRunnerRuntime(), attached = invalid.attachStage(bad), initial = invalid.envelope()
    expect(() => attached.dispatch({ type: 'TICK' })).toThrow(/zero HP/)
    expect(invalid.envelope()).toEqual(initial); expect(attached.state).toBe(0)
  })
})
