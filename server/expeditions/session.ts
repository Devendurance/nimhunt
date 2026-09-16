import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

export const RUN_SESSION_COOKIE = 'nimhunt_run_session'
export const WALLET_RECOVERY_SESSION_COOKIE = 'nimhunt_wallet_session'
export const RUN_SESSION_MAX_AGE_SECONDS = 24 * 60 * 60

export type RunSessionCapability = {
  readonly raw: string
  readonly entropyBytes: number
}

export type RunSessionRecord = {
  readonly sessionHash: string
  readonly runId: string
  readonly wallet: string
  readonly createdAt: string
  readonly expiresAt: string
  readonly revokedAt: string | null
}

export type WalletRecoverySessionRecord = {
  readonly sessionHash: string
  readonly wallet: string
  readonly purpose: 'reward/daily-state recovery'
  readonly createdAt: string
  readonly expiresAt: string
  readonly revokedAt: string | null
}

export function createRunSessionCapability(): RunSessionCapability {
  const entropyBytes = 32
  return { raw: randomBytes(entropyBytes).toString('base64url'), entropyBytes }
}

export function hashRunSessionCapability(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex')
}

export function serializeRunSessionCookie(raw: string, expiresAt: Date, now = new Date(), secureCookie = true): string {
  return serializeNamedSessionCookie(RUN_SESSION_COOKIE, raw, expiresAt, now, secureCookie)
}

export function serializeWalletRecoverySessionCookie(raw: string, expiresAt: Date, now = new Date(), secureCookie = true): string {
  return serializeNamedSessionCookie(WALLET_RECOVERY_SESSION_COOKIE, raw, expiresAt, now, secureCookie)
}

export function parseRunSessionCookie(cookieHeader: string | undefined): string | null {
  return parseNamedSessionCookie(cookieHeader, RUN_SESSION_COOKIE)
}

export function parseWalletRecoverySessionCookie(cookieHeader: string | undefined): string | null {
  return parseNamedSessionCookie(cookieHeader, WALLET_RECOVERY_SESSION_COOKIE)
}

export type SessionCookieDescription = {
  readonly header: 'yes' | 'no'
  readonly name: 'nimhunt_wallet_session' | 'nimhunt_run_session' | 'none'
  readonly secure: 'yes' | 'no'
  readonly sameSite: string
  readonly path: string
  readonly maxAgePresent: 'yes' | 'no'
}

export function describeSessionCookie(setCookie: string | undefined): SessionCookieDescription {
  if (!setCookie) {
    return {
      header: 'no',
      name: 'none',
      secure: 'no',
      sameSite: '',
      path: '',
      maxAgePresent: 'no',
    }
  }
  const parts = setCookie.split(';').map(part => part.trim())
  const nameValue = parts[0] ?? ''
  const name = nameValue.startsWith(`${WALLET_RECOVERY_SESSION_COOKIE}=`)
    ? WALLET_RECOVERY_SESSION_COOKIE
    : nameValue.startsWith(`${RUN_SESSION_COOKIE}=`)
      ? RUN_SESSION_COOKIE
      : 'none'
  const attributes = new Map<string, string | true>()
  for (const part of parts.slice(1)) {
    const [attributeName, ...value] = part.split('=')
    if (!attributeName) continue
    attributes.set(attributeName.toLowerCase(), value.length > 0 ? value.join('=') : true)
  }
  const sameSite = attributes.get('samesite')
  const path = attributes.get('path')
  return {
    header: 'yes',
    name,
    secure: attributes.has('secure') ? 'yes' : 'no',
    sameSite: typeof sameSite === 'string' ? sameSite : '',
    path: typeof path === 'string' ? path : '',
    maxAgePresent: attributes.has('max-age') ? 'yes' : 'no',
  }
}

function serializeNamedSessionCookie(
  name: string,
  raw: string,
  expiresAt: Date,
  now: Date,
  secureCookie: boolean,
): string {
  const maximumExpiry = now.getTime() + RUN_SESSION_MAX_AGE_SECONDS * 1_000
  const expiryTime = Math.min(expiresAt.getTime(), maximumExpiry)
  const effectiveExpiry = new Date(Number.isFinite(expiryTime) ? expiryTime : maximumExpiry)
  const maxAge = Math.max(0, Math.floor((effectiveExpiry.getTime() - now.getTime()) / 1_000))
  const secure = secureCookie ? '; Secure' : ''
  return `${name}=${encodeURIComponent(raw)}; Path=/api; Max-Age=${maxAge}; Expires=${effectiveExpiry.toUTCString()}; HttpOnly; SameSite=Strict${secure}`
}

function parseNamedSessionCookie(cookieHeader: string | undefined, expectedName: string): string | null {
  if (!cookieHeader) return null
  for (const part of cookieHeader.split(';')) {
    const [name, ...valueParts] = part.trim().split('=')
    if (name !== expectedName || valueParts.length === 0) continue
    try {
      const value = decodeURIComponent(valueParts.join('='))
      return value.length > 0 && value.length <= 256 ? value : null
    } catch {
      return null
    }
  }
  return null
}

export function requireRunSession(raw: string | null | undefined, record: RunSessionRecord | null, now: Date): RunSessionRecord {
  return requireHashedSession(raw, record, now)
}

export function requireWalletRecoverySession(
  raw: string | null | undefined,
  record: WalletRecoverySessionRecord | null,
  now: Date,
): WalletRecoverySessionRecord {
  return requireHashedSession(raw, record, now)
}

function requireHashedSession<T extends { readonly sessionHash: string; readonly expiresAt: string; readonly revokedAt: string | null }>(
  raw: string | null | undefined,
  record: T | null,
  now: Date,
): T {
  if (!raw || !record) throw new Error('INVALID_SESSION')
  const expected = Buffer.from(record.sessionHash, 'hex')
  const actual = Buffer.from(hashRunSessionCapability(raw), 'hex')
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new Error('INVALID_SESSION')
  if (record.revokedAt) throw new Error('SESSION_REVOKED')
  if (now.getTime() >= new Date(record.expiresAt).getTime()) throw new Error('SESSION_EXPIRED')
  return record
}
