import { describe, expect, it } from 'vitest'
import { createRunState, clampHP } from './runState'
import { evaluateMission, GEM_RUNNER_TARGET } from './mission'
import { applyHazard } from '../systems/hazards'
import { collectGem } from '../systems/collectibles'
import { resolveTileEntry } from '../systems/tileEntry'
import { calculateMove } from '../systems/movement'
import { ANGKOR_ROOM_01, ROOM_01_CONTENTS } from '../world/room01'
import { DIRECTION_VECTORS, getTileAt, isWalkableTile, type GridCoord } from '../world/grid'

describe('Development Gem Runner', () => {
  it('starts fresh with 100 HP and a deterministic target of six', () => {
    expect(createRunState()).toEqual({ hp: 100, gemsCollected: 0, collectedGemIds: [], chestsOpened: 0, openedChestIds: [], missionStatus: 'IN_PROGRESS', runStatus: 'PLAYING' })
    expect(GEM_RUNNER_TARGET).toBe(6)
    expect(createRunState().collectedGemIds).not.toBe(createRunState().collectedGemIds)
  })
  it.each([[-20, 0], [120, 100], [45, 45]])('clamps %s HP to %s', (input, expected) => expect(clampHP(input)).toBe(expected))
  it.each([['SPIKES', 75], ['POISON', 80]] as const)('%s applies its exact damage', (type, hp) => {
    expect(applyHazard(createRunState(), type).hp).toBe(hp)
    expect(applyHazard({ ...createRunState(), hp: 5 }, type).hp).toBe(0)
  })
  it('collects a gem once without mutating the input', () => {
    const initial = createRunState()
    const collected = collectGem(initial, 'gem-1')
    expect(collected.gemsCollected).toBe(1)
    expect(collectGem(collected, 'gem-1')).toBe(collected)
    expect(initial.gemsCollected).toBe(0)
  })
  it('reset restores collection availability and all run fields', () => {
    const played = evaluateMission(applyHazard(collectGem(createRunState(), 'gem-1'), 'POISON'))
    expect(played.hp).toBe(80)
    const reset = createRunState()
    expect(reset.hp).toBe(100)
    expect(reset.gemsCollected).toBe(0)
    expect(reset.missionStatus).toBe('IN_PROGRESS')
    expect(reset.runStatus).toBe('PLAYING')
    expect(collectGem(reset, 'gem-1').gemsCollected).toBe(1)
  })
  it('six gems while alive completes, but zero HP always fails', () => {
    expect(evaluateMission({ ...createRunState(), gemsCollected: 6, hp: 1 }).runStatus).toBe('MISSION_COMPLETE')
    expect(evaluateMission({ ...createRunState(), gemsCollected: 6, hp: 0 }).missionStatus).toBe('FAILED')
    expect(evaluateMission({ ...createRunState(), hp: 0 }).runStatus).toBe('FAILED')
  })
  it('blocked movement on a hazard and stationary events have no effects', () => {
    const initial = createRunState()
    const blocked = calculateMove(ANGKOR_ROOM_01, { x: 1, y: 1 }, 'UP')
    const contents = { gems: [{ id: 'g', x: 1, y: 1 }], hazards: [{ type: 'POISON' as const, x: 1, y: 1 }] }
    expect(resolveTileEntry(initial, blocked, contents)).toBe(initial)
    expect(resolveTileEntry(initial, { ...blocked, success: true }, contents)).toBe(initial)
  })
  it('hazard re-entry damages again, without any per-frame damage', () => {
    const entry = calculateMove(ANGKOR_ROOM_01, { x: 4, y: 3 }, 'RIGHT')
    const leave = calculateMove(ANGKOR_ROOM_01, { x: 5, y: 3 }, 'LEFT')
    let run = resolveTileEntry(createRunState(), entry, ROOM_01_CONTENTS)
    expect(run.hp).toBe(75)
    run = resolveTileEntry(run, leave, ROOM_01_CONTENTS)
    expect(run.hp).toBe(75)
    expect(resolveTileEntry(run, entry, ROOM_01_CONTENTS).hp).toBe(50)
  })
  it('lethal damage takes precedence over a sixth gem on the same entry', () => {
    const move = calculateMove(ANGKOR_ROOM_01, { x: 4, y: 3 }, 'RIGHT')
    const result = resolveTileEntry({ ...createRunState(), hp: 25, gemsCollected: 5 }, move, { gems: [{ id: 'six', x: 5, y: 3 }], hazards: ROOM_01_CONTENTS.hazards })
    expect(result.gemsCollected).toBe(6)
    expect(result.runStatus).toBe('FAILED')
  })
  it.each(['FAILED', 'MISSION_COMPLETE'] as const)('%s rejects further tile effects', runStatus => {
    const state = { ...createRunState(), runStatus }
    const move = calculateMove(ANGKOR_ROOM_01, { x: 3, y: 3 }, 'LEFT')
    expect(resolveTileEntry(state, move, ROOM_01_CONTENTS)).toBe(state)
    expect(collectGem(state, 'new')).toBe(state)
    expect(applyHazard(state, 'POISON')).toBe(state)
  })
  it('has eight unique reachable gems without crossing either hazard', () => {
    const key = ({ x, y }: GridCoord) => x + ',' + y
    const { gems, hazards } = ROOM_01_CONTENTS
    expect(gems).toHaveLength(8)
    expect(new Set(gems.map(g => g.id)).size).toBe(8)
    const contents = [...gems, ...hazards, ANGKOR_ROOM_01.playerStart]
    expect(new Set(contents.map(key)).size).toBe(contents.length)
    expect(contents.every(p => isWalkableTile(getTileAt(ANGKOR_ROOM_01, p)))).toBe(true)
    const blocked = new Set(hazards.map(key))
    const queue = [ANGKOR_ROOM_01.playerStart]
    const seen = new Set(queue.map(key))
    for (let i = 0; i < queue.length; i++) {
      for (const vector of Object.values(DIRECTION_VECTORS)) {
        const next = { x: queue[i].x + vector.x, y: queue[i].y + vector.y }
        if (seen.has(key(next)) || blocked.has(key(next)) || !isWalkableTile(getTileAt(ANGKOR_ROOM_01, next))) continue
        seen.add(key(next)); queue.push(next)
      }
    }
    expect(gems.filter(g => seen.has(key(g)))).toHaveLength(8)
  })
})
