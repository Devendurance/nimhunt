import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

export const RUN_SESSION_COOKIE = 'nimhunt_run_session'
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

export function createRunSessionCapability(): RunSessionCapability {
  const entropyBytes = 32
  return { raw: randomBytes(entropyBytes).toString('base64url'), entropyBytes }
}

export function hashRunSessionCapability(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex')
}

export function serializeRunSessionCookie(raw: string, expiresAt: Date, now = new Date()): string {
  const maxAge = Math.max(0, Math.floor((expiresAt.getTime() - now.getTime()) / 1_000))
  return `${RUN_SESSION_COOKIE}=${encodeURIComponent(raw)}; Path=/; Max-Age=${Math.min(maxAge, RUN_SESSION_MAX_AGE_SECONDS)}; Secure; HttpOnly; SameSite=Strict`
}

export function parseRunSessionCookie(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null
  for (const part of cookieHeader.split(';')) {
    const [name, ...valueParts] = part.trim().split('=')
    if (name !== RUN_SESSION_COOKIE || valueParts.length === 0) continue
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
  if (!raw || !record) throw new Error('INVALID_SESSION')
  const expected = Buffer.from(record.sessionHash, 'hex')
  const actual = Buffer.from(hashRunSessionCapability(raw), 'hex')
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new Error('INVALID_SESSION')
  if (record.revokedAt) throw new Error('SESSION_REVOKED')
  if (now.getTime() >= new Date(record.expiresAt).getTime()) throw new Error('SESSION_EXPIRED')
  return record
}
