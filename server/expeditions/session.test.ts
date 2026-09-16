import { describe, expect, it } from 'vitest'
import {
  createRunSessionCapability,
  describeSessionCookie,
  hashRunSessionCapability,
  parseRunSessionCookie,
  parseWalletRecoverySessionCookie,
  requireRunSession,
  requireWalletRecoverySession,
  RUN_SESSION_MAX_AGE_SECONDS,
  serializeRunSessionCookie,
  serializeWalletRecoverySessionCookie,
  type RunSessionRecord,
} from './session.ts'

function cookieAttributes(cookie: string) {
  const parts = cookie.split(';').map(part => part.trim())
  const [nameValue, ...attributes] = parts
  const map = new Map<string, string | true>()
  for (const attribute of attributes) {
    const [name, ...value] = attribute.split('=')
    if (!name) continue
    map.set(name.toLowerCase(), value.length > 0 ? value.join('=') : true)
  }
  return { nameValue, map }
}

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
    const now = new Date('2026-09-09T00:02:03.000Z')
    const cookie = serializeRunSessionCookie(capability, new Date('2026-09-09T01:02:03.000Z'), now)

    expect(cookie).toContain('nimhunt_run_session=')
    expect(cookie).toContain('Secure')
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Strict')
    expect(parseRunSessionCookie(cookie)).toBe(capability)
    expect(parseRunSessionCookie(`other=1; nimhunt_run_session=${capability}; ignored=2`)).toBe(capability)
  })

  it('persists until the server run-session expiry and never beyond it', () => {
    const capability = createRunSessionCapability().raw
    const now = new Date('2026-09-09T12:00:00.000Z')
    const expiresAt = new Date('2026-09-10T00:00:00.000Z')
    const cookie = serializeRunSessionCookie(capability, expiresAt, now, true)
    const attributes = cookieAttributes(cookie)

    expect(attributes.map.get('path')).toBe('/api')
    expect(attributes.map.get('max-age')).toBe('43200')
    expect(attributes.map.get('expires')).toBe(expiresAt.toUTCString())
    expect(attributes.map.get('httponly')).toBe(true)
    expect(attributes.map.get('samesite')).toBe('Strict')
    expect(attributes.map.get('secure')).toBe(true)
    expect(cookie).not.toMatch(/Domain=/i)
    expect(Number(attributes.map.get('max-age'))).toBeLessThanOrEqual(RUN_SESSION_MAX_AGE_SECONDS)
    expect(new Date(String(attributes.map.get('expires'))).getTime()).toBe(expiresAt.getTime())
  })

  it('caps cookie lifetime at 24h and never exceeds the server expiry', () => {
    const capability = createRunSessionCapability().raw
    const now = new Date('2026-09-09T00:00:00.000Z')
    const farExpiry = new Date('2026-09-12T00:00:00.000Z')
    const capped = serializeRunSessionCookie(capability, farExpiry, now, true)
    const cappedAttributes = cookieAttributes(capped)
    const capExpiry = new Date(now.getTime() + RUN_SESSION_MAX_AGE_SECONDS * 1_000)

    expect(cappedAttributes.map.get('max-age')).toBe(String(RUN_SESSION_MAX_AGE_SECONDS))
    expect(cappedAttributes.map.get('expires')).toBe(capExpiry.toUTCString())
    expect(new Date(String(cappedAttributes.map.get('expires'))).getTime()).toBeLessThan(farExpiry.getTime())
  })

  it('uses the API path, explicit expiry, and omits Secure only for local HTTP', () => {
    const capability = createRunSessionCapability().raw
    const now = new Date('2026-09-09T01:02:03.000Z')
    const expiresAt = new Date('2026-09-09T02:02:03.000Z')
    const cookie = serializeRunSessionCookie(capability, expiresAt, now, false)
    const attributes = cookieAttributes(cookie)

    expect(cookie).toContain('Path=/api')
    expect(attributes.map.get('max-age')).toBe('3600')
    expect(attributes.map.get('expires')).toBe('Wed, 09 Sep 2026 02:02:03 GMT')
    expect(attributes.map.get('httponly')).toBe(true)
    expect(attributes.map.get('samesite')).toBe('Strict')
    expect(attributes.map.has('secure')).toBe(false)
    expect(cookie).not.toContain('; Secure')
  })

  it('still rejects expired or revoked server sessions when a cookie is presented', () => {
    const capability = createRunSessionCapability().raw
    const record: RunSessionRecord = {
      sessionHash: hashRunSessionCapability(capability),
      runId: 'run-1',
      wallet: 'NQ00 TEST',
      createdAt: '2026-09-09T12:00:00.000Z',
      expiresAt: '2026-09-10T00:00:00.000Z',
      revokedAt: null,
    }
    const cookie = serializeRunSessionCookie(
      capability,
      new Date(record.expiresAt),
      new Date(record.createdAt),
      true,
    )

    expect(cookie).toContain('Max-Age=')
    expect(cookie).toContain('Expires=')
    expect(() => requireRunSession(capability, record, new Date('2026-09-10T00:00:00.000Z'))).toThrow('SESSION_EXPIRED')
    expect(() => requireRunSession(capability, { ...record, revokedAt: '2026-09-09T18:00:00.000Z' }, new Date('2026-09-09T18:01:00.000Z'))).toThrow('SESSION_REVOKED')
    expect(() => requireRunSession(null, record, new Date('2026-09-09T12:00:00.000Z'))).toThrow('INVALID_SESSION')
  })

  it('issues a separate wallet recovery cookie that cannot be parsed as a run session', () => {
    const capability = createRunSessionCapability().raw
    const now = new Date('2026-09-16T12:00:00.000Z')
    const expiresAt = new Date('2026-09-17T00:00:00.000Z')
    const cookie = serializeWalletRecoverySessionCookie(capability, expiresAt, now, true)
    const attributes = cookieAttributes(cookie)

    expect(cookie).toContain('nimhunt_wallet_session=')
    expect(cookie).not.toContain('nimhunt_run_session=')
    expect(attributes.map.get('path')).toBe('/api')
    expect(attributes.map.get('httponly')).toBe(true)
    expect(attributes.map.get('samesite')).toBe('Strict')
    expect(parseWalletRecoverySessionCookie(cookie)).toBe(capability)
    expect(parseRunSessionCookie(cookie)).toBeNull()
    expect(() => requireWalletRecoverySession(capability, {
      sessionHash: hashRunSessionCapability(capability),
      wallet: 'NQ00 TEST',
      purpose: 'reward/daily-state recovery',
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      revokedAt: null,
    }, new Date('2026-09-17T00:00:00.000Z'))).toThrow('SESSION_EXPIRED')
  })

  it('omits Secure on local-LAN wallet recovery cookies and keeps it for production', () => {
    const capability = createRunSessionCapability().raw
    const now = new Date('2026-09-16T12:00:00.000Z')
    const expiresAt = new Date('2026-09-16T12:05:00.000Z')
    const local = describeSessionCookie(serializeWalletRecoverySessionCookie(capability, expiresAt, now, false))
    const production = describeSessionCookie(serializeWalletRecoverySessionCookie(capability, expiresAt, now, true))

    expect(local).toEqual({
      header: 'yes',
      name: 'nimhunt_wallet_session',
      secure: 'no',
      sameSite: 'Strict',
      path: '/api',
      maxAgePresent: 'yes',
    })
    expect(production).toEqual({
      header: 'yes',
      name: 'nimhunt_wallet_session',
      secure: 'yes',
      sameSite: 'Strict',
      path: '/api',
      maxAgePresent: 'yes',
    })
    expect(JSON.stringify(local)).not.toContain(capability)
    expect(JSON.stringify(production)).not.toContain(capability)
  })
})
