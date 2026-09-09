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

  it('uses the API path, explicit expiry, and omits Secure only for local HTTP', () => {
    const capability = createRunSessionCapability().raw
    const now = new Date('2026-09-09T01:02:03.000Z')
    const expiresAt = new Date('2026-09-09T02:02:03.000Z')
    const cookie = serializeRunSessionCookie(capability, expiresAt, now, false)

    expect(cookie).toContain('Path=/api')
    expect(cookie).toContain('Max-Age=3600')
    expect(cookie).toContain('Expires=Wed, 09 Sep 2026 02:02:03 GMT')
    expect(cookie).not.toContain('; Secure')
  })
})
