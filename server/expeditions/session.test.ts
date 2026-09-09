import { describe, expect, it } from 'vitest'
import {
  createRunSessionCapability,
  hashRunSessionCapability,
  parseRunSessionCookie,
  serializeRunSessionCookie,
} from './session.ts'

describe('authenticated run sessions', () => {
  it('generates at least 256 bits and persists only a hashable representation', () => {
    const first = createRunSessionCapability()
    const second = createRunSessionCapability()

    expect(first.raw).not.toBe(second.raw)
    expect(first.entropyBytes).toBeGreaterThanOrEqual(32)
    expect(first.raw).not.toBe(hashRunSessionCapability(first.raw))
    expect(hashRunSessionCapability(first.raw)).toMatch(/^[0-9a-f]{64}$/)
  })

  it('uses a strict secure same-origin cookie and parses only its value', () => {
    const capability = createRunSessionCapability().raw
    const cookie = serializeRunSessionCookie(capability, new Date('2026-09-09T01:02:03.000Z'))

    expect(cookie).toContain('nimhunt_run_session=')
    expect(cookie).toContain('Secure')
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Strict')
    expect(parseRunSessionCookie(cookie)).toBe(capability)
    expect(parseRunSessionCookie(`other=1; nimhunt_run_session=${capability}; ignored=2`)).toBe(capability)
  })
})
