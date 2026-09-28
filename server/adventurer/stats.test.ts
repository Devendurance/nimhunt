import { describe, expect, it } from 'vitest'
import { deriveAdventurerStats, longestUtcStreak } from './stats.ts'
import type { MonthlyRunFacts } from '../monthlyHeroes/service.ts'

const WALLET = 'NQ32 AAAA BBBB CCCC DDDD EEEE FFFF GGGG HHHH'

function run(overrides: Partial<MonthlyRunFacts> & { runId: string }): MonthlyRunFacts {
  return {
    wallet: WALLET,
    mission: 'gem-runner',
    dayKey: '2026-09-10',
    startedAt: '2026-09-10T10:00:00.000Z',
    endedAt: '2026-09-10T10:05:00.000Z',
    gameplayStartedAt: '2026-09-10T10:00:01.000Z',
    verified: null,
    vaultSealed: false,
    ...overrides,
  }
}

const completed = {
  outcome: 'VERIFIED_ELIGIBLE' as const,
  gemsCollected: 6,
  chestsOpened: 0,
  objectiveReached: false,
  missionSatisfied: true,
  finalHp: 10,
}

describe('authoritative Adventurer lifetime stats', () => {
  it('counts verified success and verified failure gems, excludes practice/non-verified rows, and deduplicates runs', () => {
    const completedRun = run({ runId: 'completed', dayKey: '2026-09-10', verified: completed })
    const failedRun = run({
      runId: 'failed',
      dayKey: '2026-09-11',
      verified: { outcome: 'FAILED', gemsCollected: 3, chestsOpened: 0, objectiveReached: false, missionSatisfied: false, finalHp: 0 },
    })
    const stats = deriveAdventurerStats([
      completedRun,
      { ...completedRun },
      failedRun,
      run({ runId: 'practice-like-no-terminal', dayKey: '2026-09-12', verified: null }),
    ])
    expect(stats).toEqual({ lifetimeGems: 9, expeditionsCompleted: 1, bestStreak: 1 })
  })

  it('uses qualifying completed UTC days for a cross-month best streak', () => {
    const stats = deriveAdventurerStats([
      run({ runId: 'a', dayKey: '2026-08-31', verified: completed }),
      run({ runId: 'b', dayKey: '2026-09-01', verified: completed }),
      run({ runId: 'c', dayKey: '2026-09-02', verified: completed }),
      run({ runId: 'd', dayKey: '2026-09-04', verified: completed }),
    ])
    expect(stats.expeditionsCompleted).toBe(4)
    expect(stats.bestStreak).toBe(3)
  })

  it('does not count failed days as completion streak days', () => {
    expect(longestUtcStreak(new Set(['2026-09-01', '2026-09-02', '2026-09-04']))).toBe(2)
  })
})
