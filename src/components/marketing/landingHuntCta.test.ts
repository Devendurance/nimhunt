import { afterEach, describe, expect, it, vi } from 'vitest'
import { init } from '@nimiq/mini-app-sdk'
import { detectNimiqPayHost } from '../../integrations/nimiq/nimiqClient'
import { HuntCTA } from './HuntCTA.tsx'
import {
  ENTER_TODAYS_HUNT_LABEL,
  HUNT_IN_NIMIQ_PAY_LABEL,
  IN_APP_HUNT_HREF,
  resolveLandingHuntCta,
} from './landingHuntCta.ts'

vi.mock('@nimiq/mini-app-sdk', () => ({
  init: vi.fn(),
}))

const unavailable = { kind: 'unavailable' as const }
const configured = { kind: 'configured' as const, deepLink: 'nimiq://pay/mini-app/nimhunt' }

describe('landing hunt CTA', () => {
  it('keeps Hunt in Nimiq Pay outside the mini app', () => {
    expect(resolveLandingHuntCta({ inNimiqPay: false, launchConfig: unavailable })).toEqual({
      kind: 'unavailable',
      label: HUNT_IN_NIMIQ_PAY_LABEL,
    })
    expect(resolveLandingHuntCta({
      inNimiqPay: false,
      launchConfig: configured,
      label: 'Hunt in Nimiq Pay',
    })).toEqual({
      kind: 'deep-link',
      label: HUNT_IN_NIMIQ_PAY_LABEL,
      href: configured.deepLink,
    })
  })

  it('routes Enter today\'s hunt to /play when already inside Nimiq Pay', () => {
    expect(resolveLandingHuntCta({ inNimiqPay: true, launchConfig: unavailable })).toEqual({
      kind: 'in-app',
      label: ENTER_TODAYS_HUNT_LABEL,
      href: IN_APP_HUNT_HREF,
    })
    expect(resolveLandingHuntCta({
      inNimiqPay: true,
      launchConfig: configured,
      label: 'Hunt in Nimiq Pay',
    })).toEqual({
      kind: 'in-app',
      label: ENTER_TODAYS_HUNT_LABEL,
      href: '/play',
    })
  })

  it('does not deep-link back into Nimiq Pay from inside Nimiq Pay', () => {
    const cta = resolveLandingHuntCta({ inNimiqPay: true, launchConfig: configured })
    expect(cta.kind).toBe('in-app')
    if (cta.kind !== 'in-app') return
    expect(cta.href).toBe('/play')
    expect(cta.href).not.toContain('nimiq://')
    expect(cta.label).not.toBe(HUNT_IN_NIMIQ_PAY_LABEL)
  })
})

describe('landing hunt CTA environment detection', () => {
  afterEach(() => {
    Reflect.deleteProperty(globalThis, 'nimiq')
    Reflect.deleteProperty(globalThis, 'nimiqPay')
    vi.mocked(init).mockReset()
  })

  it('does not request account or init() merely to detect the host', () => {
    Object.assign(globalThis, { nimiqPay: { language: 'en' } })
    const cta = resolveLandingHuntCta({
      inNimiqPay: detectNimiqPayHost(),
      launchConfig: unavailable,
    })
    expect(cta).toEqual({
      kind: 'in-app',
      label: ENTER_TODAYS_HUNT_LABEL,
      href: '/play',
    })
    expect(init).not.toHaveBeenCalled()
  })

  it('keeps the external CTA when the Nimiq Pay host is absent', () => {
    const cta = resolveLandingHuntCta({
      inNimiqPay: detectNimiqPayHost(),
      launchConfig: unavailable,
    })
    expect(cta).toEqual({
      kind: 'unavailable',
      label: HUNT_IN_NIMIQ_PAY_LABEL,
    })
    const tree = HuntCTA({ onUnavailable: vi.fn() }) as { type: unknown; props: { children: unknown[] } }
    expect(tree.type).toBe('button')
    expect(tree.props.children[0]).toBe(HUNT_IN_NIMIQ_PAY_LABEL)
    expect(init).not.toHaveBeenCalled()
  })

  it('renders an in-app /play link from HuntCTA without opening Nimiq Pay again', () => {
    Object.assign(globalThis, { nimiqPay: { language: 'en' } })
    const onUnavailable = vi.fn()
    const tree = HuntCTA({ onUnavailable, label: 'Hunt in Nimiq Pay' }) as {
      type: unknown
      props: { href?: string; children: unknown[] }
    }
    expect(tree.type).toBe('a')
    expect(tree.props.href).toBe('/play')
    expect(tree.props.children[0]).toBe(ENTER_TODAYS_HUNT_LABEL)
    expect(onUnavailable).not.toHaveBeenCalled()
    expect(init).not.toHaveBeenCalled()
  })
})
