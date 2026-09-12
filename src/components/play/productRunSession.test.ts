import { afterEach, describe, expect, it } from 'vitest'
import type { VerifyExpeditionResult } from '../../domain/expeditionProof.ts'
import {
  clearRememberedProductTerminal,
  getRememberedProductTerminal,
  rememberProductTerminal,
  retainProductTerminalFor,
} from './productRunSession.ts'

function verified(mission: 'gem-runner' | 'chest-hunter' | 'vault-breaker', runId = 'run-1'): VerifyExpeditionResult {
  return {
    runId,
    checkpointHash: 'e'.repeat(64),
    outcome: mission === 'vault-breaker' ? 'VAULT_GAMEPLAY_VERIFIED' : 'VERIFIED_ELIGIBLE',
    status: mission === 'vault-breaker' ? 'STARTED' : 'COMPLETED',
    rewardStatus: mission === 'vault-breaker' ? 'NONE' : 'ELIGIBLE',
    finalHp: 80,
    gemsCollected: mission === 'gem-runner' ? 6 : 0,
    chestsOpened: mission === 'chest-hunter' ? 4 : 0,
    objectiveReached: mission === 'vault-breaker',
    hasTempleKey: mission === 'vault-breaker',
    missionSatisfied: mission !== 'vault-breaker',
    finalSeq: 8,
    transcriptHash: '4'.repeat(64),
    stateHash: '5'.repeat(64),
    verifiedAt: '2026-09-09T12:05:00.000Z',
  }
}

describe('product run terminal session', () => {
  afterEach(() => {
    clearRememberedProductTerminal()
  })

  it('remembers Gem and Chest VERIFIED_ELIGIBLE for the current run only', () => {
    rememberProductTerminal('gem-runner', verified('gem-runner'))
    expect(getRememberedProductTerminal('gem-runner', 'run-1')?.result.outcome).toBe('VERIFIED_ELIGIBLE')
    expect(getRememberedProductTerminal('gem-runner', 'run-2')).toBeNull()
    expect(getRememberedProductTerminal('chest-hunter', 'run-1')).toBeNull()

    rememberProductTerminal('chest-hunter', verified('chest-hunter', 'run-2'))
    expect(getRememberedProductTerminal('gem-runner', 'run-1')).toBeNull()
    expect(getRememberedProductTerminal('chest-hunter', 'run-2')?.result.chestsOpened).toBe(4)
  })

  it('ignores failed verification and clears when the product route leaves that run', () => {
    rememberProductTerminal('gem-runner', { ...verified('gem-runner'), outcome: 'FAILED', status: 'FAILED', rewardStatus: 'NONE', missionSatisfied: false })
    expect(getRememberedProductTerminal('gem-runner', 'run-1')).toBeNull()

    rememberProductTerminal('gem-runner', verified('gem-runner'))
    retainProductTerminalFor('gem-runner', 'run-1')
    expect(getRememberedProductTerminal('gem-runner', 'run-1')).not.toBeNull()
    retainProductTerminalFor('gem-runner', 'run-other')
    expect(getRememberedProductTerminal('gem-runner', 'run-1')).toBeNull()

    rememberProductTerminal('vault-breaker', verified('vault-breaker'))
    expect(getRememberedProductTerminal('vault-breaker', 'run-1')?.result.outcome).toBe('VAULT_GAMEPLAY_VERIFIED')
    clearRememberedProductTerminal()
    expect(getRememberedProductTerminal('vault-breaker', 'run-1')).toBeNull()
  })
})
