import { describe, expect, it } from 'vitest'
import { V2Session } from '../../game/angkorV2Proof/session'
import { createV2Blueprint } from '../../game/angkorV2Proof/blueprint'
import { createInitialRun } from '../../game/replay/engine'
import { formatV2CheckpointMetrics, v2CheckpointDebugEnabled, v2ControlsLocked, v2GameplayNotice } from './v2CheckpointNotice'

function session() {
  const blueprint = createV2Blueprint('2026-10-04', 'gem-runner')
  return new V2Session({
    initial: createInitialRun({ mission: blueprint.mission, blueprint, rulesVersion: blueprint.rulesVersion, roomVersion: blueprint.roomVersion }),
    runId: 'run',
    checkpointHash: 'initial',
    send: () => new Promise(() => undefined),
  })
}

describe('V2 checkpoint gameplay notice', () => {
  it('keeps ordinary saves quiet and only warns on abnormal backlog', () => {
    expect(v2GameplayNotice({ practice: false, pendingCount: 16, backpressured: false })).toBe('Progress saves automatically.')
    expect(v2GameplayNotice({ practice: false, pendingCount: 79, backpressured: false })).toBe('Progress saves automatically.')
    expect(v2GameplayNotice({ practice: false, pendingCount: 80, backpressured: false }))
      .toBe('Connection is catching up — progress is still secured.')
    expect(v2GameplayNotice({ practice: false, pendingCount: 127, backpressured: false }))
      .toBe('Connection is catching up — progress is still secured.')
    expect(v2GameplayNotice({ practice: false, pendingCount: 128, backpressured: true }))
      .toBe('Connection is slow — securing progress…')
    expect(v2GameplayNotice({ practice: true, pendingCount: 0, backpressured: false }))
      .toBe('Explore all three stages. Practice never creates a reward expedition.')
  })
  it('keeps the D-pad active while catching up and locks only at hard backpressure', () => {
    expect(v2ControlsLocked({ loadedStage: 'outer-ruins', stageId: 'outer-ruins', canAct: true })).toBe(false)
    expect(v2ControlsLocked({ loadedStage: 'outer-ruins', stageId: 'outer-ruins', canAct: false })).toBe(true)
    const live = session()
    for (let i = 0; i < 80; i++) live.dispatch({ type: 'TICK' })
    expect(live.canAct).toBe(true)
    expect(v2ControlsLocked({ loadedStage: 'outer-ruins', stageId: 'outer-ruins', canAct: live.canAct })).toBe(false)
    expect(v2CheckpointDebugEnabled('')).toBe(false)
    expect(v2CheckpointDebugEnabled('?tab=hunt')).toBe(false)
    expect(v2CheckpointDebugEnabled('?dev=1')).toBe(true)
    expect(formatV2CheckpointMetrics(live)).toContain('pending 80')
    expect(formatV2CheckpointMetrics(live)).toContain('ok')
  })
})
