// Fairness + semantics tests for authoritative monthly player statistics.
// No fixtures, no client counters: every expectation is derived from
// server-authoritative run/claim/payout facts.
import { describe, expect, it } from 'vitest'
import {
  MONTHLY_HERO_IDS,
  maskWalletAddress,
  type WalletMonthlyStats,
} from '../../src/domain/monthlyHeroes.js'
import {
  MAX_CREDITED_RUN_MS,
  buildMonthlyHeroes,
  buildWalletMonthlyStats,
  computeWalletMonthBoard,
  currentStreakEndingToday,
  longestStreakWithinMonth,
  rankOfWallet,
  type MonthlyFacts,
  type MonthlyRunFacts,
} from './service.js'

const SEPTEMBER = '2026-09'
const TODAY = '2026-09-18'

const WALLET_A = 'NQ32 AAAA BBBB CCCC DDDD EEEE FFFF GGGG HHHH'
const WALLET_B = 'NQ32 1111 2222 3333 4444 5555 6666 7777 8888'

function run(overrides: Partial<MonthlyRunFacts> & { runId: string; wallet: string }): MonthlyRunFacts {
  return {
    mission: 'gem-runner',
    dayKey: '2026-09-10',
    startedAt: '2026-09-10T10:00:00.000Z',
    endedAt: '2026-09-10T10:05:00.000Z',
    gameplayStartedAt: '2026-09-10T10:00:30.000Z',
    verified: null,
    vaultSealed: false,
    ...overrides,
  }
}

function verifiedCompletion(overrides: Partial<MonthlyRunFacts['verified']> = {}) {
  return {
    outcome: 'VERIFIED_ELIGIBLE' as const,
    gemsCollected: 6,
    chestsOpened: 1,
    objectiveReached: false,
    missionSatisfied: true,
    finalHp: 3,
    ...overrides,
  }
}

function boardOf(facts: MonthlyFacts, prior?: Map<string, readonly string[]>) {
  return computeWalletMonthBoard({ facts, monthKey: SEPTEMBER, todayDay: TODAY, priorQualifyingDaysByWallet: prior })
}

function statsOf(facts: MonthlyFacts, wallet: string, prior?: Map<string, readonly string[]>): WalletMonthlyStats {
  const board = boardOf(facts, prior)
  return buildWalletMonthlyStats({ monthKey: SEPTEMBER, board, wallet }).stats
}

describe('monthly stat semantics', () => {
  it('scores a verified gem completion deterministically (6 gems + 1 chest + completion)', () => {
    const stats = statsOf(
      { runs: [run({ runId: 'r1', wallet: WALLET_A, verified: verifiedCompletion() })], claims: [], payouts: [] },
      WALLET_A,
    )
    expect(stats.expeditionsStarted).toBe(1)
    expect(stats.expeditionsCompleted).toBe(1)
    expect(stats.expeditionsFailed).toBe(0)
    expect(stats.gemsCollected).toBe(6)
    expect(stats.chestsOpened).toBe(1)
    // 6*10 + 1*25 + 100 completion.
    expect(stats.points).toBe(185)
    expect(stats.bestStreak).toBe(1)
    expect(stats.expeditionMinutes).toBe(4)
  })

  it('incomplete and abandoned runs contribute starts but no items, completion, or failure', () => {
    const stats = statsOf({
      runs: [
        run({ runId: 'open', wallet: WALLET_A, verified: null, endedAt: null }),
        run({ runId: 'abandoned', wallet: WALLET_A, verified: null, endedAt: '2026-09-10T10:02:00.000Z' }),
      ],
      claims: [],
      payouts: [],
    }, WALLET_A)
    expect(stats.expeditionsStarted).toBe(2)
    expect(stats.expeditionsCompleted).toBe(0)
    expect(stats.expeditionsFailed).toBe(0)
    expect(stats.gemsCollected).toBe(0)
    expect(stats.chestsOpened).toBe(0)
    expect(stats.points).toBe(0)
    expect(stats.bestStreak).toBe(0)
    expect(stats.currentStreak).toBe(0)
  })

  it('failed runs count the failure plus collected items only (no bonuses)', () => {
    const stats = statsOf({
      runs: [run({
        runId: 'fail', wallet: WALLET_A,
        verified: { outcome: 'FAILED', gemsCollected: 3, chestsOpened: 1, objectiveReached: false, missionSatisfied: false, finalHp: 0 },
      })],
      claims: [],
      payouts: [],
    }, WALLET_A)
    expect(stats.expeditionsStarted).toBe(1)
    expect(stats.expeditionsFailed).toBe(1)
    expect(stats.expeditionsCompleted).toBe(0)
    expect(stats.gemsCollected).toBe(3)
    expect(stats.chestsOpened).toBe(1)
    expect(stats.points).toBe(3 * 10 + 1 * 25)
    expect(stats.bestStreak).toBe(0)
  })

  it('vault gameplay verification counts as completion; seal adds exactly one bonus', () => {
    const base = run({
      runId: 'vault', wallet: WALLET_A, mission: 'vault-breaker',
      verified: { outcome: 'VAULT_GAMEPLAY_VERIFIED', gemsCollected: 2, chestsOpened: 0, objectiveReached: true, missionSatisfied: false, finalHp: 2 },
    })
    const unsealed = statsOf({ runs: [{ ...base, vaultSealed: false }], claims: [], payouts: [] }, WALLET_A)
    expect(unsealed.expeditionsCompleted).toBe(1)
    expect(unsealed.vaultsSealed).toBe(0)
    expect(unsealed.points).toBe(2 * 10 + 100)

    const sealed = statsOf({ runs: [{ ...base, vaultSealed: true }], claims: [], payouts: [] }, WALLET_A)
    expect(sealed.expeditionsCompleted).toBe(1)
    expect(sealed.vaultsSealed).toBe(1)
    expect(sealed.points).toBe(2 * 10 + 100 + 50)
  })

  it('duplicate run rows (checkpoint retries) never double-count', () => {
    const completed = run({ runId: 'dup', wallet: WALLET_A, verified: verifiedCompletion() })
    const stats = statsOf({ runs: [completed, { ...completed }], claims: [], payouts: [] }, WALLET_A)
    expect(stats.expeditionsStarted).toBe(1)
    expect(stats.expeditionsCompleted).toBe(1)
    expect(stats.gemsCollected).toBe(6)
    expect(stats.points).toBe(185)
  })

  it('ignores runs outside the requested UTC month', () => {
    const stats = statsOf({
      runs: [
        run({ runId: 'aug', wallet: WALLET_A, dayKey: '2026-08-31', startedAt: '2026-08-31T23:50:00.000Z', endedAt: '2026-08-31T23:55:00.000Z', gameplayStartedAt: null, verified: verifiedCompletion() }),
        run({ runId: 'oct', wallet: WALLET_A, dayKey: '2026-10-01', startedAt: '2026-10-01T00:01:00.000Z', endedAt: '2026-10-01T00:06:00.000Z', gameplayStartedAt: null, verified: verifiedCompletion() }),
      ],
      claims: [],
      payouts: [],
    }, WALLET_A)
    expect(stats.expeditionsStarted).toBe(0)
    expect(stats.points).toBe(0)
    expect(stats.bestStreak).toBe(0)
  })

  it('caps credited expedition time at 15 minutes per run', () => {
    expect(MAX_CREDITED_RUN_MS).toBe(15 * 60 * 1000)
    const stats = statsOf({
      runs: [run({
        runId: 'idle', wallet: WALLET_A,
        startedAt: '2026-09-10T10:00:00.000Z', gameplayStartedAt: '2026-09-10T10:00:00.000Z',
        endedAt: '2026-09-10T10:40:00.000Z', verified: verifiedCompletion({ gemsCollected: 0, chestsOpened: 0 }),
      })],
      claims: [],
      payouts: [],
    }, WALLET_A)
    expect(stats.expeditionMinutes).toBe(15)
  })

  it('uses gameplayStartedAt over startedAt and floors negative clock skew to zero', () => {
    const lobbyIdle = statsOf({
      // 30 min wall time but only 5 min of actual gameplay.
      runs: [run({
        runId: 'lobby', wallet: WALLET_A,
        startedAt: '2026-09-10T10:00:00.000Z', gameplayStartedAt: '2026-09-10T10:25:00.000Z',
        endedAt: '2026-09-10T10:30:00.000Z', verified: verifiedCompletion({ gemsCollected: 0, chestsOpened: 0 }),
      })],
      claims: [],
      payouts: [],
    }, WALLET_A)
    expect(lobbyIdle.expeditionMinutes).toBe(5)

    const skewed = statsOf({
      runs: [run({
        runId: 'skew', wallet: WALLET_A,
        startedAt: '2026-09-10T10:00:00.000Z', gameplayStartedAt: null,
        endedAt: '2026-09-10T09:59:00.000Z', verified: verifiedCompletion({ gemsCollected: 0, chestsOpened: 0 }),
      })],
      claims: [],
      payouts: [],
    }, WALLET_A)
    expect(skewed.expeditionMinutes).toBe(0)
  })
})

describe('streak accounting', () => {
  it('counts multiple same-day completions as one streak day', () => {
    const stats = statsOf({
      runs: [
        run({ runId: 'a', wallet: WALLET_A, dayKey: '2026-09-10', startedAt: '2026-09-10T08:00:00.000Z', endedAt: '2026-09-10T08:05:00.000Z', gameplayStartedAt: null, verified: verifiedCompletion() }),
        run({ runId: 'b', wallet: WALLET_A, dayKey: '2026-09-10', startedAt: '2026-09-10T18:00:00.000Z', endedAt: '2026-09-10T18:05:00.000Z', gameplayStartedAt: null, verified: verifiedCompletion() }),
      ],
      claims: [],
      payouts: [],
    }, WALLET_A)
    expect(stats.expeditionsCompleted).toBe(2)
    expect(stats.bestStreak).toBe(1)
  })

  it('measures best streak within the month across gaps', () => {
    const days = new Set(['2026-09-01', '2026-09-02', '2026-09-04', '2026-09-05', '2026-09-06', '2026-08-31'])
    expect(longestStreakWithinMonth(days, SEPTEMBER)).toBe(3)
    expect(longestStreakWithinMonth(new Set(), SEPTEMBER)).toBe(0)
  })

  it('ends current streak today, or yesterday when today is quiet', () => {
    const days = new Set(['2026-09-16', '2026-09-17', '2026-09-18'])
    expect(currentStreakEndingToday(days, '2026-09-18')).toBe(3)
    expect(currentStreakEndingToday(new Set(['2026-09-16', '2026-09-17']), '2026-09-18')).toBe(2)
    expect(currentStreakEndingToday(new Set(['2026-09-16']), '2026-09-18')).toBe(0)
    expect(currentStreakEndingToday(new Set(['2026-09-19']), '2026-09-18')).toBe(0)
  })

  it('honours the UTC day boundary for streaks', () => {
    // 23:59 UTC Sep 10 + 00:01 UTC Sep 11 are consecutive UTC days.
    const stats = statsOf({
      runs: [
        run({ runId: 'late', wallet: WALLET_A, dayKey: '2026-09-10', startedAt: '2026-09-10T23:59:00.000Z', endedAt: '2026-09-10T23:59:30.000Z', gameplayStartedAt: null, verified: verifiedCompletion() }),
        run({ runId: 'early', wallet: WALLET_A, dayKey: '2026-09-11', startedAt: '2026-09-11T00:01:00.000Z', endedAt: '2026-09-11T00:02:00.000Z', gameplayStartedAt: null, verified: verifiedCompletion() }),
      ],
      claims: [],
      payouts: [],
    }, WALLET_A)
    expect(stats.bestStreak).toBe(2)
  })

  it('extends current streak across the month boundary via look-back days', () => {
    const facts: MonthlyFacts = {
      runs: [run({ runId: 'sep1', wallet: WALLET_A, dayKey: '2026-09-01', startedAt: '2026-09-01T08:00:00.000Z', endedAt: '2026-09-01T08:05:00.000Z', gameplayStartedAt: null, verified: verifiedCompletion() })],
      claims: [],
      payouts: [],
    }
    const without = statsOf(facts, WALLET_A)
    expect(without.currentStreak).toBe(0)
    const prior = new Map([[WALLET_A, ['2026-08-30', '2026-08-31']]])
    const board = computeWalletMonthBoard({ facts, monthKey: SEPTEMBER, todayDay: '2026-09-01', priorQualifyingDaysByWallet: prior })
    expect(buildWalletMonthlyStats({ monthKey: SEPTEMBER, board, wallet: WALLET_A }).stats.currentStreak).toBe(3)
    // bestStreak stays month-internal.
    expect(buildWalletMonthlyStats({ monthKey: SEPTEMBER, board, wallet: WALLET_A }).stats.bestStreak).toBe(1)
  })
})

describe('NIM attribution', () => {
  const TX = 'ab'.repeat(32)
  void TX

  it('counts only CONFIRMED payouts as delivered; pending never counts', () => {
    const facts: MonthlyFacts = {
      runs: [],
      claims: [
        { claimId: 'c-pending', runId: 'r1', wallet: WALLET_A, dayKey: '2026-09-16', status: 'RESERVED' },
        { claimId: 'c-done', runId: 'r2', wallet: WALLET_A, dayKey: '2026-09-17', status: 'RESERVED' },
      ],
      payouts: [
        { claimId: 'c-pending', wallet: WALLET_A, amountLuna: '10000000', status: 'PENDING' },
        { claimId: 'c-done', wallet: WALLET_A, amountLuna: '10000000', status: 'CONFIRMED' },
      ],
    }
    const stats = statsOf(facts, WALLET_A)
    expect(stats.rewardsSecured).toBe(2)
    expect(stats.nimDelivered).toBe(100)
  })

  it('attributes delivered NIM by rewardDay month, not confirmation timing', () => {
    const facts: MonthlyFacts = {
      runs: [],
      // August reward confirmed later still counts for August; September board ignores it.
      claims: [{ claimId: 'c-aug', runId: 'r9', wallet: WALLET_A, dayKey: '2026-08-31', status: 'RESERVED' }],
      payouts: [{ claimId: 'c-aug', wallet: WALLET_A, amountLuna: '10000000', status: 'CONFIRMED' }],
    }
    expect(statsOf(facts, WALLET_A).nimDelivered).toBe(0)
    const august = computeWalletMonthBoard({ facts, monthKey: '2026-08', todayDay: '2026-09-18' })
    expect(buildWalletMonthlyStats({ monthKey: '2026-08', board: august, wallet: WALLET_A }).stats.nimDelivered).toBe(100)
  })

  it('ignores non-reserved claims and malformed payout amounts', () => {
    const facts: MonthlyFacts = {
      runs: [],
      claims: [
        { claimId: 'c-prep', runId: 'r1', wallet: WALLET_A, dayKey: '2026-09-16', status: 'PREPARED' },
        { claimId: 'c-bad', runId: 'r2', wallet: WALLET_A, dayKey: '2026-09-16', status: 'RESERVED' },
      ],
      payouts: [{ claimId: 'c-bad', wallet: WALLET_A, amountLuna: 'not-a-number', status: 'CONFIRMED' }],
    }
    const stats = statsOf(facts, WALLET_A)
    expect(stats.rewardsSecured).toBe(1)
    expect(stats.nimDelivered).toBe(0)
  })
})

describe('hero boards and deterministic ties', () => {
  function heroFacts(): MonthlyFacts {
    return {
      runs: [
        run({ runId: 'a1', wallet: WALLET_A, verified: verifiedCompletion({ gemsCollected: 6, chestsOpened: 2 }) }),
        run({ runId: 'b1', wallet: WALLET_B, dayKey: '2026-09-11', startedAt: '2026-09-11T09:00:00.000Z', endedAt: '2026-09-11T09:06:00.000Z', gameplayStartedAt: null, verified: verifiedCompletion({ gemsCollected: 6, chestsOpened: 2 }) }),
      ],
      claims: [],
      payouts: [],
    }
  }

  it('breaks exact ties by completions, then earliest activity, then wallet', () => {
    const board = boardOf(heroFacts())
    // Identical points (210) and completions (1); A started first -> A ranks 1.
    expect(rankOfWallet(board, WALLET_A, 'relic-keeper')).toBe(1)
    expect(rankOfWallet(board, WALLET_B, 'relic-keeper')).toBe(2)

    const heroes = buildMonthlyHeroes({ monthKey: SEPTEMBER, generatedAt: new Date('2026-09-18T00:00:00.000Z').toISOString(), board })
    const relic = heroes.categories.find(category => category.heroId === 'relic-keeper')
    expect(relic?.leaders.map(leader => leader.rank)).toEqual([1, 2])
    expect(relic?.leaders[0]?.maskedWallet).toBe(maskWalletAddress(WALLET_A))
    expect(relic?.leaders[0]?.value).toBe(210)
  })

  it('prefers more completions when the primary metric ties', () => {
    const facts: MonthlyFacts = {
      runs: [
        // A: 1 completion with 10 gems (200 pts). B: 2 completions, fewer gems (200 pts).
        run({ runId: 'a1', wallet: WALLET_A, verified: verifiedCompletion({ gemsCollected: 10, chestsOpened: 0 }) }),
        run({ runId: 'b1', wallet: WALLET_B, dayKey: '2026-09-11', startedAt: '2026-09-11T09:00:00.000Z', endedAt: '2026-09-11T09:02:00.000Z', gameplayStartedAt: null, verified: verifiedCompletion({ gemsCollected: 0, chestsOpened: 0 }) }),
        run({ runId: 'b2', wallet: WALLET_B, dayKey: '2026-09-12', startedAt: '2026-09-12T09:00:00.000Z', endedAt: '2026-09-12T09:02:00.000Z', gameplayStartedAt: null, verified: verifiedCompletion({ gemsCollected: 0, chestsOpened: 0 }) }),
      ],
      claims: [],
      payouts: [],
    }
    const board = boardOf(facts)
    expect(rankOfWallet(board, WALLET_B, 'relic-keeper')).toBe(1)
    expect(rankOfWallet(board, WALLET_A, 'relic-keeper')).toBe(2)
  })

  it('returns empty leaders (never fixtures) with zero qualifying players', () => {
    const board = boardOf({ runs: [], claims: [], payouts: [] })
    const heroes = buildMonthlyHeroes({ monthKey: SEPTEMBER, generatedAt: new Date().toISOString(), board })
    expect(heroes.monthKey).toBe(SEPTEMBER)
    expect(heroes.categories).toHaveLength(6)
    for (const category of heroes.categories) expect(category.leaders).toEqual([])
  })

  it('never exposes full wallet addresses on the public board', () => {
    const board = boardOf(heroFacts())
    const heroes = buildMonthlyHeroes({ monthKey: SEPTEMBER, generatedAt: new Date().toISOString(), board })
    const text = JSON.stringify(heroes)
    expect(text).not.toContain(WALLET_A)
    expect(text).not.toContain(WALLET_B)
    expect(text).not.toMatch(/install|runId|claimId|risk|seal|snapshot/i)
  })

  it('boards claim-only wallets on the NIM board and ranks null elsewhere', () => {
    const facts: MonthlyFacts = {
      runs: [],
      claims: [{ claimId: 'c1', runId: 'r1', wallet: WALLET_A, dayKey: '2026-09-05', status: 'RESERVED' }],
      payouts: [{ claimId: 'c1', wallet: WALLET_A, amountLuna: '10000000', status: 'CONFIRMED' }],
    }
    const board = boardOf(facts)
    expect(rankOfWallet(board, WALLET_A, 'golden-hand')).toBe(1)
    expect(rankOfWallet(board, WALLET_A, 'relic-keeper')).toBeNull()
    const wallet = buildWalletMonthlyStats({ monthKey: SEPTEMBER, board, wallet: WALLET_A })
    expect(wallet.stats.expeditionsStarted).toBe(0)
    expect(wallet.ranks['golden-hand']).toBe(1)
    expect(wallet.ranks['relic-keeper']).toBeNull()
  })

  it('covers all six hero identities', () => {
    expect(MONTHLY_HERO_IDS).toEqual(['pathfinder', 'relic-keeper', 'unbroken', 'golden-hand', 'chestbreaker', 'fallen-legend'])
  })
})
