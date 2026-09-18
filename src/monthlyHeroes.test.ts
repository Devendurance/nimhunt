import { describe, expect, it } from 'vitest'
import {
  HERO_CATEGORIES,
  MONTHLY_HERO_IDS,
  formatHeroValue,
  isMonthKey,
  maskWalletAddress,
  monthKeyOfUtc,
  monthLabel,
  parseMonthlyHeroesResponse,
  parseWalletMonthlyStatsResponse,
} from './domain/monthlyHeroes.ts'

describe('monthly heroes contract', () => {
  it('keeps the six NimHunt hero identities', () => {
    expect(MONTHLY_HERO_IDS).toEqual(['pathfinder', 'relic-keeper', 'unbroken', 'golden-hand', 'chestbreaker', 'fallen-legend'])
    expect(HERO_CATEGORIES.map(category => category.title)).toEqual([
      'THE PATHFINDER', 'THE RELIC KEEPER', 'THE UNBROKEN', 'THE GOLDEN HAND', 'THE CHESTBREAKER', 'THE FALLEN LEGEND',
    ])
  })

  it('masks wallets without ever echoing the full address', () => {
    const wallet = 'NQ32 AAAA BBBB CCCC DDDD EEEE FFFF GGGG HHHH'
    const masked = maskWalletAddress(wallet)
    expect(masked).not.toContain('AAAA')
    expect(masked.length).toBeLessThan(wallet.length)
    expect(maskWalletAddress('NQ Sierpinski triangle')).not.toBe('NQ Sierpinski triangle')
    expect(maskWalletAddress('ab')).toBe('•••')
  })

  it('validates month keys on UTC calendar boundaries', () => {
    expect(isMonthKey('2026-09')).toBe(true)
    expect(isMonthKey('2026-13')).toBe(false)
    expect(isMonthKey('2026-9')).toBe(false)
    expect(isMonthKey('2026-09-18')).toBe(false)
    expect(monthKeyOfUtc(new Date('2026-09-18T23:59:59.000Z'))).toBe('2026-09')
    expect(monthKeyOfUtc(new Date('2026-10-01T00:00:00.000Z'))).toBe('2026-10')
    expect(monthLabel('2026-09')).toBe('September 2026')
  })

  it('parses the public heroes response and rejects forged ranks or fixtures', () => {
    const valid = {
      ok: true,
      monthKey: '2026-09',
      generatedAt: '2026-09-18T00:00:00.000Z',
      categories: HERO_CATEGORIES.map(def => ({
        heroId: def.heroId,
        title: def.title,
        metricLabel: def.metricLabel,
        leaders: def.heroId === 'relic-keeper' ? [{ rank: 1, maskedWallet: 'NQ32AA…HHHH', value: 185 }] : [],
      })),
    }
    expect(parseMonthlyHeroesResponse(valid)?.monthKey).toBe('2026-09')
    // Wrong rank numbering rejected.
    const badRank = structuredClone(valid)
    badRank.categories[1].leaders = [{ rank: 2, maskedWallet: 'NQ32AA…HHHH', value: 185 }]
    expect(parseMonthlyHeroesResponse(badRank)).toBeNull()
    // Zero/negative values rejected.
    const zero = structuredClone(valid)
    zero.categories[1].leaders = [{ rank: 1, maskedWallet: 'NQ32AA…HHHH', value: 0 }]
    expect(parseMonthlyHeroesResponse(zero)).toBeNull()
    // Extra keys (Luna leakage) rejected.
    const luna = structuredClone(valid) as unknown as Record<string, unknown>
    luna.amountLuna = '10000000'
    expect(parseMonthlyHeroesResponse(luna)).toBeNull()
  })

  it('parses wallet stats and rejects negative or non-integer fields', () => {
    const valid = {
      ok: true,
      monthKey: '2026-09',
      stats: {
        gemsCollected: 12, chestsOpened: 3, expeditionsStarted: 4, expeditionsCompleted: 2,
        expeditionsFailed: 1, vaultsSealed: 1, expeditionMinutes: 21, currentStreak: 2,
        bestStreak: 2, points: 395, nimDelivered: 100, rewardsSecured: 1,
      },
      ranks: { pathfinder: 3, 'relic-keeper': 1, unbroken: 2, 'golden-hand': null, chestbreaker: 4, 'fallen-legend': null },
    }
    expect(parseWalletMonthlyStatsResponse(valid)?.stats.points).toBe(395)
    const negative = structuredClone(valid)
    negative.stats.points = -1
    expect(parseWalletMonthlyStatsResponse(negative)).toBeNull()
  })

  it('formats hero values without backend terminology', () => {
    expect(formatHeroValue('expeditionMinutes', 45)).toBe('45 min')
    expect(formatHeroValue('expeditionMinutes', 125)).toBe('2h 5m')
    expect(formatHeroValue('points', 1240)).toBe('1,240 pts')
    expect(formatHeroValue('bestStreak', 1)).toBe('1 day')
    expect(formatHeroValue('nimDelivered', 200)).toBe('200 NIM')
    expect(formatHeroValue('chestsOpened', 7)).toBe('7 chests')
    expect(formatHeroValue('expeditionsFailed', 2)).toBe('2 failed')
  })
})
