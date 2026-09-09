import type { MissionType } from '../../src/game/replay/types.ts'
import {
  serializeStartPayload,
  START_EXPEDITION_TYPE,
  START_EXPEDITION_VERSION,
  type StartExpeditionPayload,
} from '../../src/domain/startAuthorization.ts'
import { normalizeNimiqWallet } from '../ledger/wallet.ts'
import { sha256Hex } from './crypto.ts'

export { serializeStartPayload, START_EXPEDITION_TYPE, START_EXPEDITION_VERSION } from '../../src/domain/startAuthorization.ts'
export type { StartExpeditionPayload } from '../../src/domain/startAuthorization.ts'

const START_FIELDS = [
  'version',
  'type',
  'wallet',
  'mission',
  'dayKey',
  'challenge',
  'blueprintId',
  'blueprintHash',
] as const

export type SignedStartRequest = {
  readonly payload: string
  readonly publicKey: string
  readonly signature: string
}

export function parseStartPayload(payload: unknown): StartExpeditionPayload | null {
  if (typeof payload !== 'string' || payload.length === 0 || payload.length > 4_096) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(payload)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null

  const record = parsed as Record<string, unknown>
  const keys = Object.keys(record)
  if (keys.length !== START_FIELDS.length || START_FIELDS.some(field => !keys.includes(field))) return null
  if (record.version !== START_EXPEDITION_VERSION || record.type !== START_EXPEDITION_TYPE) return null
  if (!isMission(record.mission) || !isBoundedString(record.wallet, 80)) return null
  if (!isUtcDay(record.dayKey) || !isBoundedString(record.challenge, 256)) return null
  if (!isBoundedString(record.blueprintId, 256) || !/^[0-9a-f]{64}$/.test(asString(record.blueprintHash))) return null
  if (!/^[A-Za-z0-9_-]+$/.test(record.challenge)) return null
  const blueprintHash = asString(record.blueprintHash)

  let wallet: string
  try {
    wallet = normalizeNimiqWallet(record.wallet)
  } catch {
    return null
  }
  if (wallet !== record.wallet) return null

  const result: StartExpeditionPayload = {
    version: START_EXPEDITION_VERSION,
    type: START_EXPEDITION_TYPE,
    wallet,
    mission: record.mission,
    dayKey: record.dayKey,
    challenge: record.challenge,
    blueprintId: record.blueprintId,
    blueprintHash,
  }
  return isCanonicalStartPayload(payload, result) ? result : null
}

export function isCanonicalStartPayload(payload: string, parsed: StartExpeditionPayload): boolean {
  return payload === serializeStartPayload(parsed)
}

export function hashChallenge(challenge: string): string {
  return sha256Hex(challenge)
}

export function fingerprintStartAuthorization(input: SignedStartRequest): string {
  return sha256Hex(`${input.payload}\n${input.publicKey}\n${input.signature}`)
}

function isMission(value: unknown): value is MissionType {
  return value === 'gem-runner' || value === 'chest-hunter' || value === 'vault-breaker'
}

function isBoundedString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function isUtcDay(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}
