import {
  NIMHUNT_ADVENTURER_SESSION_V1,
  NIMHUNT_CREATE_ADVENTURER_V1,
  NIMHUNT_RENAME_ADVENTURER_V1,
  serializeAdventurerSessionPayload,
  serializeCreateAdventurerPayload,
  serializeRenameAdventurerPayload,
  type AdventurerSessionPayload,
  type CreateAdventurerPayload,
  type RenameAdventurerPayload,
} from '../../src/domain/adventurer.js'
import { normalizeNimiqWallet } from '../ledger/wallet.js'
import { sha256Hex } from '../expeditions/crypto.js'

export {
  NIMHUNT_ADVENTURER_SESSION_V1,
  NIMHUNT_CREATE_ADVENTURER_V1,
  NIMHUNT_RENAME_ADVENTURER_V1,
  serializeAdventurerSessionPayload,
  serializeCreateAdventurerPayload,
  serializeRenameAdventurerPayload,
}
export type { AdventurerSessionPayload, CreateAdventurerPayload, RenameAdventurerPayload }

export type SignedAdventurerRequest = {
  readonly payload: string
  readonly publicKey: string
  readonly signature: string
}

const CREATE_FIELDS = ['version', 'type', 'wallet', 'displayName', 'avatarId', 'challenge', 'issuedAt', 'expiresAt'] as const
const SESSION_FIELDS = ['version', 'type', 'wallet', 'challenge', 'issuedAt', 'expiresAt'] as const
const RENAME_FIELDS = ['version', 'type', 'playerId', 'currentName', 'newName', 'challenge', 'issuedAt', 'expiresAt'] as const

export function parseCreateAdventurerPayload(payload: unknown): CreateAdventurerPayload | null {
  const record = parseObject(payload, CREATE_FIELDS)
  if (!record || record.version !== NIMHUNT_CREATE_ADVENTURER_V1 || record.type !== 'CREATE_ADVENTURER') return null
  if (!isBoundedString(record.wallet, 80) || !isBoundedString(record.displayName, 20) || !isBoundedString(record.avatarId, 64)) return null
  if (!isChallenge(record.challenge) || !isIsoTimestamp(record.issuedAt) || !isIsoTimestamp(record.expiresAt)) return null
  if (new Date(record.expiresAt).getTime() <= new Date(record.issuedAt).getTime()) return null
  const wallet = normalizeWallet(record.wallet)
  if (!wallet || wallet !== record.wallet) return null
  const result: CreateAdventurerPayload = {
    version: NIMHUNT_CREATE_ADVENTURER_V1,
    type: 'CREATE_ADVENTURER',
    wallet,
    displayName: record.displayName,
    avatarId: record.avatarId,
    challenge: record.challenge,
    issuedAt: record.issuedAt,
    expiresAt: record.expiresAt,
  }
  return payload === serializeCreateAdventurerPayload(result) ? result : null
}

export function parseAdventurerSessionPayload(payload: unknown): AdventurerSessionPayload | null {
  const record = parseObject(payload, SESSION_FIELDS)
  if (!record || record.version !== NIMHUNT_ADVENTURER_SESSION_V1 || record.type !== 'ADVENTURER_SESSION') return null
  if (!isBoundedString(record.wallet, 80) || !isChallenge(record.challenge) || !isIsoTimestamp(record.issuedAt) || !isIsoTimestamp(record.expiresAt)) return null
  if (new Date(record.expiresAt).getTime() <= new Date(record.issuedAt).getTime()) return null
  const wallet = normalizeWallet(record.wallet)
  if (!wallet || wallet !== record.wallet) return null
  const result: AdventurerSessionPayload = {
    version: NIMHUNT_ADVENTURER_SESSION_V1,
    type: 'ADVENTURER_SESSION',
    wallet,
    challenge: record.challenge,
    issuedAt: record.issuedAt,
    expiresAt: record.expiresAt,
  }
  return payload === serializeAdventurerSessionPayload(result) ? result : null
}

export function parseRenameAdventurerPayload(payload: unknown): RenameAdventurerPayload | null {
  const record = parseObject(payload, RENAME_FIELDS)
  if (!record || record.version !== NIMHUNT_RENAME_ADVENTURER_V1 || record.type !== 'RENAME_ADVENTURER') return null
  if (!isUuid(record.playerId) || !isBoundedString(record.currentName, 20) || !isBoundedString(record.newName, 20)) return null
  if (!isChallenge(record.challenge) || !isIsoTimestamp(record.issuedAt) || !isIsoTimestamp(record.expiresAt)) return null
  if (new Date(record.expiresAt).getTime() <= new Date(record.issuedAt).getTime()) return null
  const result: RenameAdventurerPayload = {
    version: NIMHUNT_RENAME_ADVENTURER_V1,
    type: 'RENAME_ADVENTURER',
    playerId: record.playerId,
    currentName: record.currentName,
    newName: record.newName,
    challenge: record.challenge,
    issuedAt: record.issuedAt,
    expiresAt: record.expiresAt,
  }
  return payload === serializeRenameAdventurerPayload(result) ? result : null
}

export function hashAdventurerChallenge(challenge: string): string {
  return sha256Hex(challenge)
}

export function fingerprintAdventurerAuthorization(input: SignedAdventurerRequest): string {
  return sha256Hex(`${input.payload}\n${input.publicKey}\n${input.signature}`)
}

function parseObject(payload: unknown, fields: readonly string[]): Record<string, unknown> | null {
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
  if (keys.length !== fields.length || fields.some(field => !keys.includes(field))) return null
  return record
}

function normalizeWallet(value: unknown): string | null {
  try {
    return normalizeNimiqWallet(value)
  } catch {
    return null
  }
}

function isBoundedString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength
}

function isChallenge(value: unknown): value is string {
  return isBoundedString(value, 256) && /^[A-Za-z0-9_-]+$/.test(value)
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}
