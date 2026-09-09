import type { DailyMissionType } from '../../src/domain/dailyLedger.ts'
import { LedgerError } from './errors.ts'

export function parseMissionType(input: unknown): DailyMissionType {
  if (input === 'gem-runner' || input === 'chest-hunter' || input === 'vault-breaker') return input
  throw new LedgerError('UNKNOWN_MISSION_TYPE')
}
