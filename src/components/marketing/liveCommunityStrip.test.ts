// Live-community strip tests: grammar and visibility rules.
import { describe, expect, it } from 'vitest'
import {
  formatGamerText,
  formatOnlineText,
  shouldShowCommunityStrip,
} from './liveCommunityStripView.ts'

describe('live community copy', () => {
  it('uses the final exploring/gamers wording with singular/plural grammar', () => {
    expect(formatOnlineText(0)).toBe('0 exploring now')
    expect(formatOnlineText(1)).toBe('1 exploring now')
    expect(formatOnlineText(7)).toBe('7 exploring now')
    expect(formatOnlineText(1234)).toBe('1,234 exploring now')
    expect(formatGamerText(1)).toBe('1 gamer has entered Angkor')
    expect(formatGamerText(38)).toBe('38 gamers have entered Angkor')
  })

  it('never exposes wallet data in copy helpers', () => {
    const text = `${formatOnlineText(5)} ${formatGamerText(9)}`
    expect(text).not.toMatch(/NQ|wallet|address/i)
  })
})

describe('live community visibility', () => {
  it('renders while Presence is live (even at 0) or still connecting', () => {
    expect(
      shouldShowCommunityStrip({ presenceStatus: 'live', gamerStatus: 'unavailable', gamerCount: null }),
    ).toBe(true)
    expect(
      shouldShowCommunityStrip({ presenceStatus: 'connecting', gamerStatus: 'unavailable', gamerCount: null }),
    ).toBe(true)
  })

  it('hides the online stat only when Presence failed', () => {
    expect(
      shouldShowCommunityStrip({ presenceStatus: 'unavailable', gamerStatus: 'live', gamerCount: 40 }),
    ).toBe(true)
    expect(
      shouldShowCommunityStrip({ presenceStatus: 'unavailable', gamerStatus: 'unavailable', gamerCount: null }),
    ).toBe(false)
  })

  it('retains the last valid gamer count on API failure', () => {
    expect(
      shouldShowCommunityStrip({ presenceStatus: 'unavailable', gamerStatus: 'unavailable', gamerCount: 40 }),
    ).toBe(true)
  })
})
