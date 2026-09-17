import { describe, expect, it } from 'vitest'
import { PLAYER_MOVE_DURATION_MS } from '../../src/game/config/timing.ts'
import {
  assessRewardRisk,
  hashInstallId,
  isImpossibleRunSpeed,
  minimumPlausibleCompletionMs,
  parseInstallId,
} from './riskGate.ts'
import type { DurableExpeditionRun } from './types.ts'

function verifiedResult(verifiedAt = '2026-09-17T12:00:20.000Z') {
  return {
    runId: 'run-1',
    checkpointHash: '44'.repeat(32),
    outcome: 'VERIFIED_ELIGIBLE' as const,
    status: 'COMPLETED' as const,
    rewardStatus: 'ELIGIBLE' as const,
    finalHp: 100,
    gemsCollected: 5,
    chestsOpened: 0,
    objectiveReached: true,
    hasTempleKey: false,
    missionSatisfied: true,
    finalSeq: 15,
    transcriptHash: '55'.repeat(32),
    stateHash: '66'.repeat(32),
    verifiedAt,
  }
}

function run(overrides: Partial<DurableExpeditionRun> = {}): DurableExpeditionRun {
  return {
    runId: 'run-1',
    dayKey: '2026-09-17',
    wallet: 'NQ-WALLET-A',
    mission: 'gem-runner',
    status: 'COMPLETED',
    rewardStatus: 'ELIGIBLE',
    startedAt: '2026-09-17T12:00:00.000Z',
    expiresAt: '2026-09-18T00:00:00.000Z',
    gameplayStartedAt: '2026-09-17T12:00:01.000Z',
    runChallenge: 'aa'.repeat(32),
    blueprint: {} as DurableExpeditionRun['blueprint'],
    state: {} as DurableExpeditionRun['state'],
    checkpoint: {} as DurableExpeditionRun['checkpoint'],
    initialStateHash: '11'.repeat(32),
    initialTranscriptHash: '22'.repeat(32),
    initialCheckpointHash: '33'.repeat(32),
    checkpointHash: '44'.repeat(32),
    seq: 15,
    actions: [],
    batches: [],
    terminal: {
      type: 'VERIFIED',
      result: verifiedResult(),
    },
    vaultSeal: null,
    ...overrides,
  }
}

describe('privacy-light reward risk gate', () => {
  it('derives a conservative impossible-speed bound from the 160ms move tween', () => {
    expect(PLAYER_MOVE_DURATION_MS).toBe(160)
    expect(minimumPlausibleCompletionMs(15)).toBe(15 * 144 - 750)
    expect(isImpossibleRunSpeed({
      actionCount: 15,
      startedAt: '2026-09-17T12:00:00.000Z',
      verifiedAt: '2026-09-17T12:00:00.400Z',
    })).toBe(true)
    expect(isImpossibleRunSpeed({
      actionCount: 15,
      startedAt: '2026-09-17T12:00:00.000Z',
      verifiedAt: '2026-09-17T12:00:20.000Z',
    })).toBe(false)
    expect(minimumPlausibleCompletionMs(1)).toBeNull()
  })

  it('passes a human-like run and blocks only objective automation', () => {
    const human = assessRewardRisk({
      run: run(),
      now: new Date('2026-09-17T12:00:20.000Z'),
      installIdHash: hashInstallId('11111111-1111-4111-8111-111111111111'),
      concurrentActiveRuns: 0,
      installWalletCount: 1,
      installStartCount: 3,
      installRecoveryCount: 1,
      installPatternWalletCount: 1,
    })
    expect(human).toMatchObject({ result: 'PASS', reasonCodes: [] })

    const speed = assessRewardRisk({
      run: run({
        gameplayStartedAt: '2026-09-17T12:00:01.000Z',
        terminal: {
          type: 'VERIFIED',
          result: verifiedResult('2026-09-17T12:00:01.200Z'),
        },
      }),
      now: new Date('2026-09-17T12:00:01.200Z'),
      installIdHash: null,
      concurrentActiveRuns: 0,
      installWalletCount: 1,
      installStartCount: 1,
      installRecoveryCount: 0,
      installPatternWalletCount: 1,
    })
    expect(speed.result).toBe('BLOCK')
    expect(speed.reasonCodes).toContain('IMPOSSIBLE_SPEED')
    expect(speed.reasonCategory).toBe('TIMING')

    const concurrent = assessRewardRisk({
      run: run(),
      now: new Date('2026-09-17T12:00:20.000Z'),
      installIdHash: null,
      concurrentActiveRuns: 1,
      installWalletCount: 1,
      installStartCount: 1,
      installRecoveryCount: 0,
      installPatternWalletCount: 1,
    })
    expect(concurrent).toMatchObject({ result: 'BLOCK', reasonCategory: 'SESSION' })
    expect(concurrent.reasonCodes).toContain('CONCURRENT_ACTIVE_RUN')
  })

  it('reviews Sybil signals without blocking 1-2 wallets on one install', () => {
    const twoWallets = assessRewardRisk({
      run: run(),
      now: new Date('2026-09-17T12:00:20.000Z'),
      installIdHash: hashInstallId('11111111-1111-4111-8111-111111111111'),
      concurrentActiveRuns: 0,
      installWalletCount: 2,
      installStartCount: 6,
      installRecoveryCount: 2,
      installPatternWalletCount: 2,
    })
    expect(twoWallets.result).toBe('PASS')

    const fanout = assessRewardRisk({
      run: run(),
      now: new Date('2026-09-17T12:00:20.000Z'),
      installIdHash: hashInstallId('11111111-1111-4111-8111-111111111111'),
      concurrentActiveRuns: 0,
      installWalletCount: 3,
      installStartCount: 6,
      installRecoveryCount: 2,
      installPatternWalletCount: 2,
    })
    expect(fanout.result).toBe('REVIEW')
    expect(fanout.reasonCodes).toContain('INSTALL_WALLET_FANOUT')
    expect(parseInstallId('no')).toBeUndefined()
    expect(hashInstallId('11111111-1111-4111-8111-111111111111')).toMatch(/^[0-9a-f]{64}$/)
    expect(hashInstallId('11111111-1111-4111-8111-111111111111')).not.toContain('11111111')
  })
})
