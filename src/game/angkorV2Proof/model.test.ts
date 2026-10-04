import { createHash } from 'node:crypto'
import { hashV2 } from './model'
import { describe, expect, it } from 'vitest'
import { advanceV2, canonicalV2, initialV2, isV2Action, replayV2, type V2Action } from './model'
import { createV2Blueprint, validV2Blueprint } from './blueprint'
import { advanceRun, createInitialRun, replayActions } from '../replay/engine'
import { hashBlueprint, hashReplayState, hashTranscript } from '../replay/canonical'
import { createRoom01Blueprint } from '../world/room01'

import { recordedActions } from './fixtures.testSupport'
const fixtures = ['gem-runner', 'chest-hunter', 'vault-breaker'] as const
describe('versioned authoritative nine-stage bridge', () => {
  for (const mission of fixtures) it(`reuses all three ${mission} reducers and reproduces the approved full recording`, () => {
    const { actions, envelope } = recordedActions(mission)
    const state = replayV2(mission, actions)
    expect(state.expedition).toEqual(envelope.snapshot)
    expect(state.expedition.status).toBe('COMPLETE')
    expect(state.expedition.stageResults).toHaveLength(3)
    expect(canonicalV2(replayV2(mission, JSON.parse(JSON.stringify(actions))))).toBe(canonicalV2(state))
    const blueprint = createV2Blueprint('2026-10-04', mission)
    expect(validV2Blueprint(blueprint)).toBe(true)
    expect(hashBlueprint(blueprint)).toBe(blueprint.blueprintHash)
    const replay = replayActions({ blueprint, mission, rulesVersion: blueprint.rulesVersion, roomVersion: blueprint.roomVersion }, actions)
    expect(replay.angkorV2).toEqual(state)
    expect(replay.run).toMatchObject({ missionStatus: 'COMPLETE', hp: state.expedition.hp })
    expect(() => advanceV2(state, { seq: state.seq + 1, type: 'V2_CONTINUE', stageId: state.expedition.currentStage })).toThrow()
  }, 120_000)
  it('rejects skipped/reordered stages, asserted result/carry/HP/boss fields and invalid sequence', () => {
    const state = initialV2('vault-breaker'), action: V2Action = { seq: 1, type: 'V2_TICK', stageId: 'temple-approach' }
    expect(() => advanceV2(state, { ...action, stageId: 'inner-vault' })).toThrow()
    expect(() => advanceV2(state, { ...action, type: 'V2_CONTINUE' })).toThrow()
    expect(() => advanceV2(state, { ...action, seq: 2 })).toThrow()
    for (const field of ['hp', 'result', 'carry', 'gems', 'bossDefeated', 'anchorsBroken']) expect(isV2Action({ ...action, [field]: 100 })).toBe(false)
    expect(state).toEqual(initialV2('vault-breaker'))
  })
  it('rejects illegal movement and prevents unlimited movement with frozen simulation', () => {
    let state = initialV2('vault-breaker')
    expect(isV2Action({ seq: 1, type: 'V2_MOVE', stageId: 'temple-approach', direction: 'DIAGONAL' })).toBe(false)
    for (let i = 0; i < 2; i++) state = advanceV2(state, { seq: state.seq + 1, type: 'V2_MOVE', stageId: 'temple-approach', direction: i % 2 ? 'LEFT' : 'RIGHT' })
    expect(() => advanceV2(state, { seq: state.seq + 1, type: 'V2_MOVE', stageId: 'temple-approach', direction: 'RIGHT' })).toThrow(/TICKS/)
  })
  it('commits local boss/objective state and forbids old-version transcript semantics', () => {
    const blueprint = createV2Blueprint('2026-10-04', 'gem-runner'), state = createInitialRun({ blueprint, mission: blueprint.mission, rulesVersion: blueprint.rulesVersion, roomVersion: blueprint.roomVersion })
    expect(hashReplayState({ ...state, angkorV2: { ...state.angkorV2!, local: { forged: true } } })).not.toBe(hashReplayState(state))
    expect(advanceRun(state, { seq: 1, type: 'MOVE', direction: 'UP' }).accepted).toBe(false)
    expect(validV2Blueprint({ ...blueprint, angkorV2: { version: 1, stages: [] } })).toBe(false)
    expect(() => hashTranscript({ version: 1, runId: 'run', wallet: 'wallet', mission: blueprint.mission, rulesVersion: blueprint.rulesVersion, roomVersion: blueprint.roomVersion, blueprintVersion: blueprint.blueprintVersion, blueprintId: blueprint.blueprintId, blueprintHash: blueprint.blueprintHash, actions: [] })).toThrow(/VERSION/)
    const old = createRoom01Blueprint('2026-10-04', 'gem-runner')
    const initial = createInitialRun({ blueprint: old, mission: old.mission, rulesVersion: old.rulesVersion, roomVersion: old.roomVersion })
    expect(advanceRun(initial, { seq: 1, type: 'V2_TICK', stageId: 'outer-ruins' }).accepted).toBe(false)
    expect(initial.angkorV2).toBeUndefined()
  })
  it('uses standard SHA-256 with the original domain bytes and cannot bank idle ticks to freeze enemies', () => {
    const data = { version: 2, nested: { y: 1, x: 2 } }
    expect(hashV2('VECTOR', data)).toBe(createHash('sha256').update(`NIMHUNT:ANGKOR_V2:VECTOR:v1\n${canonicalV2(data)}`).digest('hex'))
    let state = initialV2('vault-breaker')
    for (let i = 0; i < 50; i++) state = advanceV2(state, { seq: state.seq + 1, type: 'V2_TICK', stageId: 'temple-approach' })
    for (const direction of ['RIGHT', 'LEFT'] as const) state = advanceV2(state, { seq: state.seq + 1, type: 'V2_MOVE', stageId: 'temple-approach', direction })
    expect(() => advanceV2(state, { seq: state.seq + 1, type: 'V2_MOVE', stageId: 'temple-approach', direction: 'RIGHT' })).toThrow(/TICKS/)
  })

})
