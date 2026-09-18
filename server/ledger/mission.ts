import type { DailyMissionType } from '../../src/domain/dailyLedger.js'
import { LedgerError } from './errors.js'

export function parseMissionType(input: unknown): DailyMissionType {
  if (input === 'gem-runner' || input === 'chest-hunter' || input === 'vault-breaker') return input
  throw new LedgerError('UNKNOWN_MISSION_TYPE')
}
