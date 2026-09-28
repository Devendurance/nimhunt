import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import {
  ADVENTURER_SESSION_COOKIE,
  ADVENTURER_SESSION_MAX_AGE_SECONDS,
  type AdventurerSession,
} from '../../src/domain/adventurer.js'
import { AdventurerError } from './errors.js'
import type { StoredAdventurerSession } from './types.js'

export function createAdventurerSessionCapability(): string {
  return randomBytes(32).toString('base64url')
}

export function hashAdventurerSessionCapability(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex')
}

export function serializeAdventurerSessionCookie(raw: string, expiresAt: Date, now = new Date(), secureCookie = true): string {
  const maximumExpiry = now.getTime() + ADVENTURER_SESSION_MAX_AGE_SECONDS * 1_000
  const expiryTime = Math.min(expiresAt.getTime(), maximumExpiry)
  const effectiveExpiry = new Date(Number.isFinite(expiryTime) ? expiryTime : maximumExpiry)
  const maxAge = Math.max(0, Math.floor((effectiveExpiry.getTime() - now.getTime()) / 1_000))
  const secure = secureCookie ? '; Secure' : ''
  return `${ADVENTURER_SESSION_COOKIE}=${encodeURIComponent(raw)}; Path=/api; Max-Age=${maxAge}; Expires=${effectiveExpiry.toUTCString()}; HttpOnly; SameSite=Strict${secure}`
}

export function parseAdventurerSessionCookie(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null
  for (const part of cookieHeader.split(';')) {
    const [name, ...valueParts] = part.trim().split('=')
    if (name !== ADVENTURER_SESSION_COOKIE || valueParts.length === 0) continue
    try {
      const value = decodeURIComponent(valueParts.join('='))
      return value.length > 0 && value.length <= 256 ? value : null
    } catch {
      return null
    }
  }
  return null
}

export function toAdventurerSession(record: StoredAdventurerSession): AdventurerSession {
  return {
    playerId: record.playerId,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
  }
}

export function requireAdventurerSession(
  raw: string | null | undefined,
  record: StoredAdventurerSession | null,
  now: Date,
): StoredAdventurerSession {
  if (!raw || !record) throw new AdventurerError('ADVENTURER_SESSION_INVALID')
  const expected = Buffer.from(record.sessionHash, 'hex')
  const actual = Buffer.from(hashAdventurerSessionCapability(raw), 'hex')
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new AdventurerError('ADVENTURER_SESSION_INVALID')
  }
  if (record.revokedAt || now.getTime() >= new Date(record.expiresAt).getTime()) {
    throw new AdventurerError('ADVENTURER_SESSION_INVALID')
  }
  return record
}
