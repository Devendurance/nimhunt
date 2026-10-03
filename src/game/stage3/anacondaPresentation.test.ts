/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { anacondaPresentation, headDropPosition, PIT_POSE_KEYS, PIT_PRESENTATION } from './anacondaPresentation'
import { initialStageState, reduceStage, type StageAction, type StageState } from './model'
import { replayEnvelope, stageFactory, type GemRunnerEnvelope } from '../gemRunner/runtime'
import { outerRuinsAdapter } from '../gemRunner/outerRuinsAdapter'
import { overgrownTempleAdapter } from '../gemRunner/overgrownTempleAdapter'
import { innerSanctuaryAdapter } from '../gemRunner/innerSanctuaryAdapter'
import { ANGKOR_V2_BY_KEY } from '../assets/angkorV2Manifest'

const fresh = () => initialStageState({ hp: 100, expeditionGems: 0 })
describe('pit-anchored Anaconda presentation', () => {
  it('keeps an empty shake tell before any serpent appears, then rises monotonically', () => {
    const state = fresh(); state.anaconda.mode = 'EMERGING'; state.anaconda.nextTick = 12
    let previous = 0
    for (let tick = 0; tick <= 12; tick += .25) {
      const visual = anacondaPresentation({ ...state, tick: Math.floor(tick) }, tick % 1)
      expect(visual.height).toBeGreaterThanOrEqual(previous)
      if (tick <= 2) expect(visual.visible).toBe(false)
      expect(visual.base).toEqual({ x: 784, y: 440 }); expect(visual.depthY).toBe(432)
      previous = visual.height
    }
    expect(previous).toBeGreaterThanOrEqual(80); expect(previous).toBeLessThanOrEqual(110)
  })
  it('sends a falling rock to the raised head, not to the arena floor', () => {
    const state = fresh(); state.anaconda.mode = 'VULNERABLE'; state.anaconda.pendingDrop = { id: 'boss-PIT_CENTER', impactTick: 4 }
    const head = anacondaPresentation(state).head
    const halfway = headDropPosition({ ...state, tick: 2 })!, end = headDropPosition({ ...state, tick: 4 })!
    expect(end.x).toBe(head.x); expect(end.y + PIT_PRESENTATION.rockRadius).toBe(head.y)
    expect(halfway.y).toBeLessThan(end.y); expect(end.y).toBeLessThan(400)
  })
  it('fully sinks on defeat without changing pit or depth, and remains gone', () => {
    const state = fresh(); state.anaconda.mode = 'DEFEATED'; state.anaconda.defeatedAt = 0
    let height = Infinity
    for (let tick = 0; tick <= 20; tick += .25) {
      const visual = anacondaPresentation({ ...state, tick: Math.floor(tick) }, tick % 1)
      expect(visual.height).toBeLessThanOrEqual(height); height = visual.height
      expect(visual.pit).toBe('PIT_CENTER'); expect(visual.depthY).toBe(432)
      if (tick >= 14) expect(visual.visible).toBe(false)
    }
  })
  it('uses one bottom anchor and portrait canvas for every pose; visible pixels never determine collision', () => {
    for (const key of Object.values(PIT_POSE_KEYS)) {
      const asset = ANGKOR_V2_BY_KEY[key]
      expect(asset.sourceDimensions).toEqual({ width: 512, height: 768 })
      expect(asset.displayDimensions).toEqual({ width: 64, height: 112 })
      expect(asset.anchor).toEqual({ x: .5, y: PIT_PRESENTATION.anchorY })
      expect(asset.collidable).toBe(false)
    }
  })
  it('replays the approved encounter with full retraction before every pit change and unchanged authority', () => {
    const envelope = JSON.parse(readFileSync('docs/angkor-v2/anaconda-rework/qa/full-expedition-envelope.json', 'utf8')) as GemRunnerEnvelope
    const entry = envelope.entries.find(e => e.type === 'STAGE_STARTED' && e.stageId === 'inner-sanctuary')!
    if (entry.type !== 'STAGE_STARTED') throw new Error('Missing carry')
    let state: StageState = initialStageState(entry.carry), changes = 0
    for (const e of envelope.entries) if (e.type === 'STAGE_ACTION' && e.stageId === 'inner-sanctuary') {
      const before = structuredClone(state), visual = anacondaPresentation(state, 1)
      const next = reduceStage(state, e.action as StageAction)
      anacondaPresentation(state, .5); headDropPosition(state, .5)
      expect(state).toEqual(before)
      if (state.anaconda.activePit !== next.anaconda.activePit) {
        expect(visual.visible).toBe(false); expect(anacondaPresentation(next).visible).toBe(false); changes++
      }
      state = next
    }
    expect(changes).toBe(2)
    expect(state.result).toEqual({ gems: 12, expeditionGems: 29, hp: 52 })
    expect(state.anaconda.successfulHits).toBe(3); expect(anacondaPresentation(state).visible).toBe(false)
  })
  it('reproduces the new vertical-presentation browser run across all three stages exactly', () => {
    const envelope = JSON.parse(readFileSync('docs/angkor-v2/anaconda-vertical/qa/full-expedition-envelope.json', 'utf8')) as GemRunnerEnvelope
    const factories = { 'outer-ruins': stageFactory(outerRuinsAdapter), 'overgrown-temple': stageFactory(overgrownTempleAdapter), 'inner-sanctuary': stageFactory(innerSanctuaryAdapter) }
    expect(replayEnvelope(envelope, factories).envelope()).toEqual(envelope)
    expect(envelope.snapshot).toMatchObject({ status: 'COMPLETE', expeditionGems: 26, hp: 64 })
    expect(envelope.snapshot.completedStages).toHaveLength(3)
  })
})
