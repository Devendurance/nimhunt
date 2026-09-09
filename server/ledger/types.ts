import type {
  DailyHuntStatus,
  DailyMissionType,
  ExpeditionRewardStatus,
  ExpeditionRunStatus,
  ReserveDailyRewardResult,
  StartExpeditionResult,
  WalletDailyStatus,
} from '../../src/domain/dailyLedger.ts'

export type Clock = {
  now(): Date
}

export type ExpeditionRun = {
  id: string
  dayKey: string
  wallet: string
  missionType: DailyMissionType
  status: ExpeditionRunStatus
  startedAt: string
  endedAt: string | null
  rewardStatus: ExpeditionRewardStatus
  reservationNumber: number | null
}

export type DailyLedger = {
  startExpedition(wallet: string, missionType: string, ignored?: unknown): Promise<StartExpeditionResult>
  completeRun(runId: string, wallet: string): Promise<ExpeditionRun>
  failRun(runId: string, wallet: string): Promise<ExpeditionRun>
  abandonRun(runId: string, wallet: string): Promise<ExpeditionRun>
  reserveDailyReward(runId: string, wallet: string): Promise<ReserveDailyRewardResult>
  getDailyHuntStatus(): Promise<DailyHuntStatus>
  getWalletDailyStatus(wallet: string): Promise<WalletDailyStatus>
  seedReservedSlots(count: number): Promise<void>
}
