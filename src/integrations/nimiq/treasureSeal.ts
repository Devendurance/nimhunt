export {
  buildTestTreasureSealPayload,
  serializeTestTreasureSeal,
  serializeTreasureSeal,
  tamperTestSealMission,
  TEST_SEAL_ENVIRONMENT,
  TEST_SEAL_MISSION,
  TEST_SEAL_TYPE,
  TEST_SEAL_VERSION,
} from '../../domain/treasureSeal'
export type { CanonicalTreasureSeal, TestTreasureSealPayload } from '../../domain/treasureSeal'

export function shortenNimiqAddress(address: string): string {
  const compact = address.replace(/\s+/g, '')
  if (compact.length <= 14) return address.trim()
  return `${compact.slice(0, 6)}…${compact.slice(-4)}`
}
