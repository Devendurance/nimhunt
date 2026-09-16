import { afterEach, describe, expect, it } from 'vitest'
import type { VerifyExpeditionResult } from '../../domain/expeditionProof.ts'
import {
  clearRememberedProductTerminal,
  getPersistedReservedRewardClaim,
  getRememberedProductTerminal,
  persistReservedRewardClaim,
  rememberProductRewardClaim,
  rememberProductTerminal,
  rememberProductVaultSeal,
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

const memorySession = new Map<string, string>()
const sessionStorageStub = {
  getItem(key: string) {
    return memorySession.get(key) ?? null
  },
  setItem(key: string, value: string) {
    memorySession.set(key, value)
  },
  clear() {
    memorySession.clear()
  },
}

describe('product run terminal session', () => {
  afterEach(() => {
    clearRememberedProductTerminal()
    memorySession.clear()
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
    rememberProductVaultSeal({
      runId: 'run-1',
      wallet: 'NQ07 TEST',
      canonicalPayload: '{}',
      vaultSealHash: 'aa'.repeat(32),
      publicKey: 'bb'.repeat(32),
      vaultCheckpointHash: 'e'.repeat(64),
      verifiedAt: '2026-09-09T12:06:00.000Z',
    })
    expect(getRememberedProductTerminal('vault-breaker', 'run-1')?.vaultSeal?.vaultSealHash).toBe('aa'.repeat(32))
    clearRememberedProductTerminal()
    expect(getRememberedProductTerminal('vault-breaker', 'run-1')).toBeNull()
  })

  it('persists a reserved claim so reopen can recover payout status after memory is cleared', () => {
    Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: sessionStorageStub })
    persistReservedRewardClaim('claim-confirmed')
    rememberProductTerminal('gem-runner', verified('gem-runner'))
    rememberProductRewardClaim({
      outcome: 'RESERVED',
      claimId: 'claim-confirmed',
      runId: 'run-1',
      reservationNumber: 1,
      remainingSlots: 68,
      totalSlots: 69,
      finalizedAt: '2026-09-16T12:10:00.000Z',
    })
    clearRememberedProductTerminal()
    expect(getRememberedProductTerminal('gem-runner', 'run-1')).toBeNull()
    expect(getPersistedReservedRewardClaim()).toEqual({ claimId: 'claim-confirmed' })
  })
})
