import { serializeCanonicalSeal } from './treasureSeal.ts'

export const PRODUCT_REWARD_CLAIM_VERSION = 1 as const
export const PRODUCT_REWARD_CLAIM_TYPE = 'NIMHUNT_REWARD_CLAIM_V1' as const

const PRODUCT_REWARD_CLAIM_BASE_FIELDS = [
  'version',
  'type',
  'claimId',
  'wallet',
  'runId',
  'mission',
  'dayKey',
  'runChallenge',
  'rulesVersion',
  'roomVersion',
  'blueprintVersion',
  'blueprintId',
  'blueprintHash',
  'transcriptHash',
] as const

export type ProductRewardClaimMission = 'gem-runner' | 'chest-hunter' | 'vault-breaker'

type ProductRewardClaimBase = {
  readonly version: typeof PRODUCT_REWARD_CLAIM_VERSION
  readonly type: typeof PRODUCT_REWARD_CLAIM_TYPE
  readonly claimId: string
  readonly wallet: string
  readonly runId: string
  readonly mission: ProductRewardClaimMission
  readonly dayKey: string
  readonly runChallenge: string
  readonly rulesVersion: string
  readonly roomVersion: string
  readonly blueprintVersion: string
  readonly blueprintId: string
  readonly blueprintHash: string
  readonly transcriptHash: string
}

export type GemChestRewardClaimPayload = ProductRewardClaimBase & {
  readonly mission: 'gem-runner' | 'chest-hunter'
}

export type VaultRewardClaimPayload = ProductRewardClaimBase & {
  readonly mission: 'vault-breaker'
  readonly vaultSealHash: string
}

export type ProductRewardClaimPayload = GemChestRewardClaimPayload | VaultRewardClaimPayload

export function serializeProductRewardClaim(payload: ProductRewardClaimPayload): string {
  const canonical: Record<string, string | number> = {
    version: payload.version,
    type: payload.type,
    claimId: payload.claimId,
    wallet: payload.wallet,
    runId: payload.runId,
    mission: payload.mission,
    dayKey: payload.dayKey,
    runChallenge: payload.runChallenge,
    rulesVersion: payload.rulesVersion,
    roomVersion: payload.roomVersion,
    blueprintVersion: payload.blueprintVersion,
    blueprintId: payload.blueprintId,
    blueprintHash: payload.blueprintHash,
    transcriptHash: payload.transcriptHash,
  }
  if (payload.mission === 'vault-breaker') canonical.vaultSealHash = payload.vaultSealHash
  return serializeCanonicalSeal(canonical)
}

export function parseProductRewardClaim(payload: unknown): ProductRewardClaimPayload | null {
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
  if (record.version !== PRODUCT_REWARD_CLAIM_VERSION || record.type !== PRODUCT_REWARD_CLAIM_TYPE) return null
  if (!isMission(record.mission)) return null
  if (!PRODUCT_REWARD_CLAIM_BASE_FIELDS.every(field => keys.includes(field))) return null
  if (record.mission === 'vault-breaker') {
    if (keys.length !== PRODUCT_REWARD_CLAIM_BASE_FIELDS.length + 1 || !keys.includes('vaultSealHash')) return null
    if (!isHash(record.vaultSealHash)) return null
  } else if (keys.length !== PRODUCT_REWARD_CLAIM_BASE_FIELDS.length || keys.includes('vaultSealHash')) {
    return null
  }
  if (!isBoundedString(record.claimId, 128) || !isBoundedString(record.wallet, 80) || !isBoundedString(record.runId, 128)) {
    return null
  }
  if (!isUtcDay(record.dayKey)) return null
  if (!isBoundedToken(record.runChallenge, 256) || !isBoundedToken(record.rulesVersion, 64)) return null
  if (!isBoundedToken(record.roomVersion, 64) || !isBoundedToken(record.blueprintVersion, 64)) return null
  if (!isBoundedString(record.blueprintId, 256) || !isHash(record.blueprintHash) || !isHash(record.transcriptHash)) {
    return null
  }

  const result = record.mission === 'vault-breaker'
    ? {
        version: PRODUCT_REWARD_CLAIM_VERSION,
        type: PRODUCT_REWARD_CLAIM_TYPE,
        claimId: record.claimId,
        wallet: record.wallet,
        runId: record.runId,
        mission: 'vault-breaker' as const,
        dayKey: record.dayKey,
        runChallenge: record.runChallenge,
        rulesVersion: record.rulesVersion,
        roomVersion: record.roomVersion,
        blueprintVersion: record.blueprintVersion,
        blueprintId: record.blueprintId,
        blueprintHash: record.blueprintHash,
        transcriptHash: record.transcriptHash,
        vaultSealHash: record.vaultSealHash as string,
      }
    : {
        version: PRODUCT_REWARD_CLAIM_VERSION,
        type: PRODUCT_REWARD_CLAIM_TYPE,
        claimId: record.claimId,
        wallet: record.wallet,
        runId: record.runId,
        mission: record.mission,
        dayKey: record.dayKey,
        runChallenge: record.runChallenge,
        rulesVersion: record.rulesVersion,
        roomVersion: record.roomVersion,
        blueprintVersion: record.blueprintVersion,
        blueprintId: record.blueprintId,
        blueprintHash: record.blueprintHash,
        transcriptHash: record.transcriptHash,
      }
  return payload === serializeProductRewardClaim(result) ? result : null
}

export function isCanonicalProductRewardClaim(payload: string, parsed: ProductRewardClaimPayload): boolean {
  return payload === serializeProductRewardClaim(parsed)
}

function isMission(value: unknown): value is ProductRewardClaimMission {
  return value === 'gem-runner' || value === 'chest-hunter' || value === 'vault-breaker'
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

function isUtcDay(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}
