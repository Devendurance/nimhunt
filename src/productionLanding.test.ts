import { describe, expect, it } from 'vitest'
import { Link } from 'react-router-dom'
import { parseDailyHuntStatus } from './api/dailyHunt'
import { formatResetCountdown } from './components/play/huntStatusView'
import { resolveLandingHuntCta } from './components/marketing/landingHuntCta'

describe('live landing status mapping', () => {
  it('maps live remainingSlots/totalSlots without mock numbers', () => {
    const parsed = parseDailyHuntStatus({
      ok: true,
      totalSlots: 69,
      reservedSlots: 26,
      remainingSlots: 43,
      dayKey: '2026-09-18',
      nextResetAt: '2026-09-19T00:00:00.000Z',
    })
    expect(parsed).not.toBeNull()
    expect(parsed?.totalSlots).toBe(69)
    expect(parsed?.remainingSlots).toBe(43)
    const claimed = (parsed?.totalSlots ?? 0) - (parsed?.remainingSlots ?? 0)
    expect(claimed).toBe(26)
    expect(`${parsed?.remainingSlots} / ${parsed?.totalSlots}`).toBe('43 / 69')
  })

  it('derives countdown from server nextResetAt and decrements with time', () => {
    const reset = '2026-09-19T00:00:00.000Z'
    const t0 = Date.parse('2026-09-18T12:00:00.000Z')
    const t1 = t0 + 1_000
    expect(formatResetCountdown(reset, t0)).toBe('12:00:00')
    expect(formatResetCountdown(reset, t1)).toBe('11:59:59')
  })

  it('keeps deep-link resolution unchanged and in-app on /play', () => {
    const deepLink = resolveLandingHuntCta({
      inNimiqPay: false,
      launchConfig: { kind: 'configured', deepLink: 'nimiq://pay/mini-app/nimhunt' },
    })
    expect(deepLink.kind).toBe('deep-link')
    if (deepLink.kind !== 'deep-link') return
    expect(deepLink.href).toContain('nimiq://')
    const inApp = resolveLandingHuntCta({
      inNimiqPay: true,
      launchConfig: { kind: 'configured', deepLink: 'nimiq://pay/mini-app/nimhunt' },
    })
    expect(inApp).toEqual({ kind: 'in-app', label: "Enter today's hunt", href: '/play' })
    expect(Link).toBeDefined()
  })
})
