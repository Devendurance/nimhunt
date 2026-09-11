import { describe, expect, it } from 'vitest'
import type { ProductActiveExpedition } from '../../domain/expeditionProof.ts'
import {
  canMountProduct,
  createProductGateAttemptGuard,
  INITIAL_PRODUCT_GATE_STATE,
  reduceProductGate,
  validateProductActive,
} from './productGateState.ts'

const active = {
  runId: 'run-1',
  mission: 'gem-runner',
  status: 'STARTED',
  gameplayStartedAt: null,
  state: { seq: 0, run: { runStatus: 'PLAYING', missionStatus: 'IN_PROGRESS' } },
} as ProductActiveExpedition

describe('product expedition gate', () => {
  it('does not mount until gameplay start succeeds', () => {
    const marking = reduceProductGate(INITIAL_PRODUCT_GATE_STATE, { type: 'ACTIVE_RECEIVED', active })
    const ready = reduceProductGate(marking, { type: 'GAMEPLAY_STARTED', runId: 'run-1', outcome: 'GAMEPLAY_STARTED' })

    expect(marking.status).toBe('MARKING_GAMEPLAY_START')
    expect(canMountProduct(marking)).toBe(false)
    expect(ready.status).toBe('READY')
    expect(canMountProduct(ready)).toBe(true)
  })

  it('accepts an idempotent gameplay-start response for the retained active run', () => {
    const marking = reduceProductGate(INITIAL_PRODUCT_GATE_STATE, { type: 'ACTIVE_RECEIVED', active })
    const ready = reduceProductGate(marking, { type: 'GAMEPLAY_STARTED', runId: 'run-1', outcome: 'GAMEPLAY_ALREADY_STARTED' })

    expect(ready).toMatchObject({ status: 'READY', active })
  })

  it('rejects a mission mismatch or a post-marker active response', () => {
    expect(validateProductActive(active, 'chest-hunter', 'run-1')).toBe('MISSION_MISMATCH')
    expect(validateProductActive(active, 'gem-runner', 'run-2')).toBe('MALFORMED_ACTIVE')
    expect(validateProductActive({ ...active, gameplayStartedAt: '2026-09-09T12:01:00.000Z' }, 'gem-runner', 'run-1')).toBe('ACTIVE_RUN_UNAVAILABLE')
  })

  it('does not become ready for a gameplay-start response from another run', () => {
    const marking = reduceProductGate(INITIAL_PRODUCT_GATE_STATE, { type: 'ACTIVE_RECEIVED', active })
    const rejected = reduceProductGate(marking, { type: 'GAMEPLAY_STARTED', runId: 'run-2', outcome: 'GAMEPLAY_STARTED' })

    expect(rejected).toMatchObject({ status: 'ERROR', error: 'GAMEPLAY_START_FAILED', active: null })
    expect(canMountProduct(rejected)).toBe(false)
  })

  it('does not begin the same route attempt twice', () => {
    const guard = createProductGateAttemptGuard()

    expect(guard.begin('gem-runner:run-1')).toBe(true)
    expect(guard.begin('gem-runner:run-1')).toBe(false)
    expect(guard.begin('gem-runner:run-2')).toBe(true)
  })
})
