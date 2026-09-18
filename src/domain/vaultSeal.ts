import { serializeCanonicalSeal } from './treasureSeal.js'

export const VAULT_SEAL_VERSION = 1 as const
export const VAULT_SEAL_TYPE = 'NIMHUNT_VAULT_SEAL_PREVIEW' as const
export const VAULT_SEAL_MISSION = 'VAULT_BREAKER' as const
export const VAULT_SEAL_WORLD = 'ANGKOR_RUINS' as const
export const VAULT_SEAL_ROOM = 'ROOM_01' as const
export const VAULT_SEAL_OBJECTIVE = 'TEMPLE_VAULT' as const
export const VAULT_SEAL_ENVIRONMENT = 'development' as const

export type VaultSealPayload = {
  version: typeof VAULT_SEAL_VERSION
  type: typeof VAULT_SEAL_TYPE
  wallet: string
  mission: string
  world: string
  room: string
  objective: string
  environment: string
}

export function buildVaultSealPayload(wallet: string): VaultSealPayload {
  return {
    version: VAULT_SEAL_VERSION,
    type: VAULT_SEAL_TYPE,
    wallet,
    mission: VAULT_SEAL_MISSION,
    world: VAULT_SEAL_WORLD,
    room: VAULT_SEAL_ROOM,
    objective: VAULT_SEAL_OBJECTIVE,
    environment: VAULT_SEAL_ENVIRONMENT,
  }
}

export function serializeVaultSeal(payload: VaultSealPayload): string {
  return serializeCanonicalSeal({
    version: payload.version,
    type: payload.type,
    wallet: payload.wallet,
    mission: payload.mission,
    world: payload.world,
    room: payload.room,
    objective: payload.objective,
    environment: payload.environment,
  })
}

export function tamperVaultSealMission(canonicalPayload: string): string {
  const from = '"mission": "VAULT_BREAKER"'
  const to = '"mission": "GEM_RUNNER"'
  if (!canonicalPayload.includes(from)) {
    throw new Error('Vault payload does not contain the VAULT_BREAKER mission field.')
  }
  return canonicalPayload.replace(from, to)
}

export function parseVaultSealJson(payload: string): VaultSealPayload | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(payload)
  } catch {
    return null
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
  const record = parsed as Record<string, unknown>
  if (record.version !== VAULT_SEAL_VERSION) return null
  if (record.type !== VAULT_SEAL_TYPE) return null
  if (typeof record.wallet !== 'string' || record.wallet.length === 0) return null
  if (typeof record.mission !== 'string' || record.mission.length === 0) return null
  if (typeof record.world !== 'string' || record.world.length === 0) return null
  if (typeof record.room !== 'string' || record.room.length === 0) return null
  if (typeof record.objective !== 'string' || record.objective.length === 0) return null
  if (typeof record.environment !== 'string' || record.environment.length === 0) return null

  return {
    version: VAULT_SEAL_VERSION,
    type: VAULT_SEAL_TYPE,
    wallet: record.wallet,
    mission: record.mission,
    world: record.world,
    room: record.room,
    objective: record.objective,
    environment: record.environment,
  }
}

export function isCanonicalVaultSeal(payload: string, parsed: VaultSealPayload): boolean {
  return payload === serializeVaultSeal(parsed)
}
