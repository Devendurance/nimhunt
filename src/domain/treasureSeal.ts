export const TEST_SEAL_TYPE = 'NIMHUNT_TEST_SEAL' as const
export const TEST_SEAL_MISSION = 'VAULT_BREAKER' as const
export const TEST_SEAL_ENVIRONMENT = 'development' as const
export const TEST_SEAL_VERSION = 1 as const

export type TestTreasureSealPayload = {
  version: typeof TEST_SEAL_VERSION
  type: typeof TEST_SEAL_TYPE
  wallet: string
  mission: typeof TEST_SEAL_MISSION
  environment: typeof TEST_SEAL_ENVIRONMENT
}

export type CanonicalTreasureSeal = {
  version: typeof TEST_SEAL_VERSION
  type: string
  wallet: string
  mission: string
  environment: string
}

export function buildTestTreasureSealPayload(wallet: string): TestTreasureSealPayload {
  return {
    version: TEST_SEAL_VERSION,
    type: TEST_SEAL_TYPE,
    wallet,
    mission: TEST_SEAL_MISSION,
    environment: TEST_SEAL_ENVIRONMENT,
  }
}

export function serializeTreasureSeal(payload: CanonicalTreasureSeal): string {
  const canonical: CanonicalTreasureSeal = {
    version: payload.version,
    type: payload.type,
    wallet: payload.wallet,
    mission: payload.mission,
    environment: payload.environment,
  }

  return serializeCanonicalSeal(canonical)
}

/** One shared deterministic serializer for every seal payload shape. */
export function serializeCanonicalSeal(canonical: Record<string, string | number>): string {
  return JSON.stringify(canonical, null, 2)
}

export function serializeTestTreasureSeal(payload: TestTreasureSealPayload): string {
  return serializeTreasureSeal(payload)
}

export function tamperTestSealMission(canonicalPayload: string): string {
  const from = '"mission": "VAULT_BREAKER"'
  const to = '"mission": "GEM_RUNNER"'
  if (!canonicalPayload.includes(from)) {
    throw new Error('Test payload does not contain the VAULT_BREAKER mission field.')
  }
  return canonicalPayload.replace(from, to)
}

export function parseTreasureSealJson(payload: string): CanonicalTreasureSeal | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(payload)
  } catch {
    return null
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
  const record = parsed as Record<string, unknown>
  if (record.version !== TEST_SEAL_VERSION) return null
  if (typeof record.type !== 'string' || record.type.length === 0) return null
  if (typeof record.wallet !== 'string' || record.wallet.length === 0) return null
  if (typeof record.mission !== 'string' || record.mission.length === 0) return null
  if (typeof record.environment !== 'string' || record.environment.length === 0) return null

  return {
    version: TEST_SEAL_VERSION,
    type: record.type,
    wallet: record.wallet,
    mission: record.mission,
    environment: record.environment,
  }
}

export function isCanonicalTreasureSeal(payload: string, parsed: CanonicalTreasureSeal): boolean {
  return payload === serializeTreasureSeal(parsed)
}
