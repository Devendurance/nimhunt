import { describe, expect, it } from 'vitest'
import { playFixture } from '../../data/play.fixtures'
import { formatResetCountdown, resolveHuntStatusView } from './huntStatusView.ts'

describe('HuntStatus live treasure view', () => {
  it('does not present the fixture treasure count as live while loading or unavailable', () => {
    expect(resolveHuntStatusView({ kind: 'loading' }, playFixture).treasuresRemaining).toBe('—')
    expect(resolveHuntStatusView({ kind: 'unavailable' }, playFixture).treasuresRemaining).toBe('—')
    expect(resolveHuntStatusView({ kind: 'unavailable' }, playFixture).badge).toBe('TREASURE COUNT UNAVAILABLE')
    expect(resolveHuntStatusView({ kind: 'loading' }, playFixture).badge).toBe('LOADING')
  })

  it('uses the server remaining count when the daily hunt is live', () => {
    const view = resolveHuntStatusView(
      {
        kind: 'live',
        remainingSlots: 21,
        totalSlots: 69,
        nextResetAt: '2026-09-09T00:00:00.000Z',
      },
      playFixture,
    )
    expect(view.treasuresRemaining).toBe('21')
    expect(view.treasuresTotal).toBe('69')
    expect(view.badge).toBe('LIVE · SERVER')
    expect(view.treasuresRemaining).not.toBe(String(playFixture.treasuresRemaining))
  })

  it('formats the UTC reset countdown from the server timestamp', () => {
    expect(formatResetCountdown('2026-09-09T00:00:00.000Z', Date.parse('2026-09-08T12:00:00.000Z'))).toBe('12:00:00')
  })
})
