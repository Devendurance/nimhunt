import { describe, expect, it } from 'vitest'
import { formatExpeditionsLeftToday, formatResetCountdown, resolveHuntStatusView } from './huntStatusView.ts'

describe('HuntStatus live treasure view', () => {
  it('does not present the fixture treasure count as live while loading or unavailable', () => {
    const loading = resolveHuntStatusView({ kind: 'loading', walletStatus: null })
    const unavailable = resolveHuntStatusView({ kind: 'unavailable', walletStatus: null })
    expect(loading.treasuresRemaining).toBe('—')
    expect(loading.treasuresTotal).toBe('—')
    expect(unavailable.treasuresRemaining).toBe('—')
    expect(unavailable.treasuresTotal).toBe('—')
    expect(loading.resetDisplay).toBe('—')
    expect(unavailable.resetDisplay).toBe('—')
    expect(unavailable.badge).toBe('UNAVAILABLE')
    expect(loading.badge).toBe('CHECKING')
    expect(loading.expeditionsRemaining).toBe('—')
    expect(loading.expeditionsLabel).toBe('wallet required')
  })

  it('uses the server remaining count when the daily hunt is live', () => {
    const view = resolveHuntStatusView(
      {
        kind: 'live',
        remainingSlots: 21,
        totalSlots: 69,
        nextResetAt: '2026-09-09T00:00:00.000Z',
        walletStatus: null,
      },
    )
    expect(view.treasuresRemaining).toBe('21')
    expect(view.treasuresTotal).toBe('69')
    expect(view.badge).toBe('LIVE')
    expect(view.expeditionsRemaining).toBe('—')
  })

  it('uses wallet attempts only after a deliberate product start provides a wallet', () => {
    const view = resolveHuntStatusView(
      {
        kind: 'live',
        remainingSlots: 21,
        totalSlots: 69,
        nextResetAt: '2026-09-09T00:00:00.000Z',
        walletStatus: {
          dayKey: '2026-09-09',
          expeditionsStarted: 1,
          expeditionsRemaining: 2,
          rewardAlreadyReserved: false,
          nextResetAt: '2026-09-10T00:00:00.000Z',
        },
      },
    )
    expect(view.expeditionsRemaining).toBe('2')
    expect(view.expeditionsLabel).toBe('expeditions left today')
    expect(formatExpeditionsLeftToday({
      dayKey: '2026-09-09',
      expeditionsStarted: 1,
      expeditionsRemaining: 2,
      rewardAlreadyReserved: false,
      nextResetAt: '2026-09-10T00:00:00.000Z',
    })).toBe('2 EXPEDITIONS LEFT TODAY')
  })

  it('keeps attempts unknown before a wallet is known and shows 0 after three starts', () => {
    expect(formatExpeditionsLeftToday(null)).toBeNull()
    const empty = resolveHuntStatusView({ kind: 'live', remainingSlots: 21, totalSlots: 69, nextResetAt: '2026-09-09T00:00:00.000Z', walletStatus: null })
    expect(empty.expeditionsRemaining).toBe('—')
    expect(empty.expeditionsLabel).toBe('wallet required')
    expect(formatExpeditionsLeftToday({
      dayKey: '2026-09-09',
      expeditionsStarted: 3,
      expeditionsRemaining: 0,
      rewardAlreadyReserved: false,
      nextResetAt: '2026-09-10T00:00:00.000Z',
    })).toBe('0 EXPEDITIONS LEFT TODAY')
    expect(formatExpeditionsLeftToday({
      dayKey: '2026-09-09',
      expeditionsStarted: 2,
      expeditionsRemaining: 1,
      rewardAlreadyReserved: false,
      nextResetAt: '2026-09-10T00:00:00.000Z',
    })).toBe('1 EXPEDITION LEFT TODAY')
  })

  it('formats the UTC reset countdown from the server timestamp', () => {
    expect(formatResetCountdown('2026-09-09T00:00:00.000Z', Date.parse('2026-09-08T12:00:00.000Z'))).toBe('12:00:00')
  })
})
