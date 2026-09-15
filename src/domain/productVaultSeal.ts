import { serializeCanonicalSeal } from './treasureSeal.ts'

export const PRODUCT_VAULT_SEAL_VERSION = 1 as const
export const PRODUCT_VAULT_SEAL_TYPE = 'NIMHUNT_VAULT_SEAL_V1' as const
export const PRODUCT_VAULT_SEAL_MISSION = 'vault-breaker' as const
export const PRODUCT_VAULT_SEAL_WORLD = 'ANGKOR_RUINS' as const
export const PRODUCT_VAULT_SEAL_ROOM = 'ROOM_01' as const
export const PRODUCT_VAULT_SEAL_OBJECTIVE = 'TEMPLE_VAULT' as const

const PRODUCT_VAULT_SEAL_FIELDS = [
  'version',
  'type',
  'wallet',
  'runId',
  'mission',
  'world',
  'room',
  'objective',
  'runChallenge',
  'rulesVersion',
  'roomVersion',
  'blueprintVersion',
  'blueprintId',
  'blueprintHash',
  'vaultCheckpointHash',
] as const

export type ProductVaultSealPayload = {
  readonly version: typeof PRODUCT_VAULT_SEAL_VERSION
  readonly type: typeof PRODUCT_VAULT_SEAL_TYPE
  readonly wallet: string
  readonly runId: string
  readonly mission: typeof PRODUCT_VAULT_SEAL_MISSION
  readonly world: typeof PRODUCT_VAULT_SEAL_WORLD
  readonly room: typeof PRODUCT_VAULT_SEAL_ROOM
  readonly objective: typeof PRODUCT_VAULT_SEAL_OBJECTIVE
  readonly runChallenge: string
  readonly rulesVersion: string
  readonly roomVersion: string
  readonly blueprintVersion: string
  readonly blueprintId: string
  readonly blueprintHash: string
  readonly vaultCheckpointHash: string
}

export function serializeProductVaultSeal(payload: ProductVaultSealPayload): string {
  return serializeCanonicalSeal({
    version: payload.version,
    type: payload.type,
    wallet: payload.wallet,
    runId: payload.runId,
    mission: payload.mission,
    world: payload.world,
    room: payload.room,
    objective: payload.objective,
    runChallenge: payload.runChallenge,
    rulesVersion: payload.rulesVersion,
    roomVersion: payload.roomVersion,
    blueprintVersion: payload.blueprintVersion,
    blueprintId: payload.blueprintId,
    blueprintHash: payload.blueprintHash,
    vaultCheckpointHash: payload.vaultCheckpointHash,
  })
}

export function parseProductVaultSeal(payload: unknown): ProductVaultSealPayload | null {
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
  if (keys.length !== PRODUCT_VAULT_SEAL_FIELDS.length || PRODUCT_VAULT_SEAL_FIELDS.some(field => !keys.includes(field))) {
    return null
  }
  if (record.version !== PRODUCT_VAULT_SEAL_VERSION || record.type !== PRODUCT_VAULT_SEAL_TYPE) return null
  if (record.mission !== PRODUCT_VAULT_SEAL_MISSION) return null
  if (record.world !== PRODUCT_VAULT_SEAL_WORLD) return null
  if (record.room !== PRODUCT_VAULT_SEAL_ROOM) return null
  if (record.objective !== PRODUCT_VAULT_SEAL_OBJECTIVE) return null
  if (!isBoundedString(record.wallet, 80) || !isBoundedString(record.runId, 128)) return null
  if (!isBoundedToken(record.runChallenge, 256) || !isBoundedToken(record.rulesVersion, 64)) return null
  if (!isBoundedToken(record.roomVersion, 64) || !isBoundedToken(record.blueprintVersion, 64)) return null
  if (!isBoundedString(record.blueprintId, 256) || !isHash(record.blueprintHash) || !isHash(record.vaultCheckpointHash)) {
    return null
  }

  const result: ProductVaultSealPayload = {
    version: PRODUCT_VAULT_SEAL_VERSION,
    type: PRODUCT_VAULT_SEAL_TYPE,
    wallet: record.wallet,
    runId: record.runId,
    mission: PRODUCT_VAULT_SEAL_MISSION,
    world: PRODUCT_VAULT_SEAL_WORLD,
    room: PRODUCT_VAULT_SEAL_ROOM,
    objective: PRODUCT_VAULT_SEAL_OBJECTIVE,
    runChallenge: record.runChallenge,
    rulesVersion: record.rulesVersion,
    roomVersion: record.roomVersion,
    blueprintVersion: record.blueprintVersion,
    blueprintId: record.blueprintId,
    blueprintHash: record.blueprintHash,
    vaultCheckpointHash: record.vaultCheckpointHash,
  }
  return payload === serializeProductVaultSeal(result) ? result : null
}

export function isCanonicalProductVaultSeal(payload: string, parsed: ProductVaultSealPayload): boolean {
  return payload === serializeProductVaultSeal(parsed)
}

function isBoundedString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength
}

function isBoundedToken(value: unknown, maxLength: number): value is string {
  return isBoundedString(value, maxLength) && /^[A-Za-z0-9._-]+$/.test(value)
}

function isHash(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)
}
