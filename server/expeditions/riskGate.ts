import { DAILY_REWARD_SLOTS } from '../../src/domain/dailyLedger.ts'
import type { PrepareRewardClaimResult } from '../../src/domain/expeditionProof.ts'
import { isInstallId } from '../../src/domain/installId.ts'
import { PLAYER_MOVE_DURATION_MS, PLAYER_MOVE_FRAME_SLACK_MS } from '../../src/game/config/timing.ts'
import { sha256Hex } from './crypto.ts'
import type { DurableExpeditionRun } from './types.ts'

export const INSTALL_ID_HASH_PREFIX = 'nimhunt-install-v1:'
export const RISK_NETWORK_RENDER_SLACK_MS = 750
export const INSTALL_WALLET_FANOUT_REVIEW_LIMIT = 2
export const INSTALL_START_VELOCITY_REVIEW_LIMIT = 18
export const INSTALL_RECOVERY_VELOCITY_REVIEW_LIMIT = 24
export const INSTALL_PATTERN_WALLET_REVIEW_LIMIT = 2

export type RiskResult = 'PASS' | 'REVIEW' | 'BLOCK'
export type RiskReasonCode =
  | 'CONCURRENT_ACTIVE_RUN'
  | 'IMPOSSIBLE_SPEED'
  | 'INSTALL_WALLET_FANOUT'
  | 'INSTALL_START_VELOCITY'
  | 'INSTALL_RECOVERY_VELOCITY'
  | 'INSTALL_RUN_PATTERN'
export type RiskReasonCategory = 'TIMING' | 'SESSION' | 'ELIGIBILITY'
export type RiskSignalKind = 'START_CHALLENGE' | 'START' | 'RECOVERY_CHALLENGE' | 'CLAIM'

export type RiskContext = {
  readonly installId?: string
}

export type RiskSignal = {
  readonly kind: RiskSignalKind
  readonly wallet: string
  readonly dayKey: string
  readonly installIdHash: string | null
  readonly runId?: string | null
  readonly patternHash?: string | null
}

export type RiskAssessmentInput = {
  readonly run: DurableExpeditionRun
  readonly now: Date
  readonly installIdHash: string | null
  readonly concurrentActiveRuns: number
  readonly installWalletCount: number
  readonly installStartCount: number
  readonly installRecoveryCount: number
  readonly installPatternWalletCount: number
}

export type RiskAssessment = {
  readonly result: RiskResult
  readonly reasonCodes: readonly RiskReasonCode[]
  readonly reasonCategory: RiskReasonCategory | null
}

export function parseInstallId(value: unknown): string | undefined {
  return isInstallId(value) ? value : undefined
}

export function hashInstallId(installId: string): string {
  return sha256Hex(`${INSTALL_ID_HASH_PREFIX}${installId.trim().toLowerCase()}`)
}

export function runPatternHash(run: Pick<DurableExpeditionRun, 'actions'>): string {
  return sha256Hex(run.actions.map(action => action.direction).join(','))
}

export function minimumPlausibleCompletionMs(actionCount: number): number | null {
  if (!Number.isInteger(actionCount) || actionCount < 1) return null
  const perAction = PLAYER_MOVE_DURATION_MS - PLAYER_MOVE_FRAME_SLACK_MS
  if (perAction <= 0) return null
  const minimum = actionCount * perAction - RISK_NETWORK_RENDER_SLACK_MS
  return minimum > 0 ? minimum : null
}

export function isImpossibleRunSpeed(input: {
  readonly actionCount: number
  readonly startedAt: string
  readonly verifiedAt: string
}): boolean {
  const minimum = minimumPlausibleCompletionMs(input.actionCount)
  if (minimum === null) return false
  const started = Date.parse(input.startedAt)
  const verified = Date.parse(input.verifiedAt)
  if (!Number.isFinite(started) || !Number.isFinite(verified) || verified < started) return false
  return verified - started < minimum
}

export function assessRewardRisk(input: RiskAssessmentInput): RiskAssessment {
  const reasonCodes: RiskReasonCode[] = []
  if (input.concurrentActiveRuns > 0) reasonCodes.push('CONCURRENT_ACTIVE_RUN')
  if (isImpossibleSpeedFromRun(input.run)) reasonCodes.push('IMPOSSIBLE_SPEED')
  if (input.installIdHash) {
    if (input.installWalletCount > INSTALL_WALLET_FANOUT_REVIEW_LIMIT) reasonCodes.push('INSTALL_WALLET_FANOUT')
    if (input.installStartCount > INSTALL_START_VELOCITY_REVIEW_LIMIT) reasonCodes.push('INSTALL_START_VELOCITY')
    if (input.installRecoveryCount > INSTALL_RECOVERY_VELOCITY_REVIEW_LIMIT) reasonCodes.push('INSTALL_RECOVERY_VELOCITY')
    if (input.installPatternWalletCount > INSTALL_PATTERN_WALLET_REVIEW_LIMIT) reasonCodes.push('INSTALL_RUN_PATTERN')
  }

  const blocked = reasonCodes.some(code => code === 'CONCURRENT_ACTIVE_RUN' || code === 'IMPOSSIBLE_SPEED')
  const reviewed = reasonCodes.some(code =>
    code === 'INSTALL_WALLET_FANOUT'
    || code === 'INSTALL_START_VELOCITY'
    || code === 'INSTALL_RECOVERY_VELOCITY'
    || code === 'INSTALL_RUN_PATTERN',
  )
  if (blocked) {
    return {
      result: 'BLOCK',
      reasonCodes,
      reasonCategory: reasonCodes.includes('CONCURRENT_ACTIVE_RUN') ? 'SESSION' : 'TIMING',
    }
  }
  if (reviewed) {
    return { result: 'REVIEW', reasonCodes, reasonCategory: 'ELIGIBILITY' }
  }
  return { result: 'PASS', reasonCodes, reasonCategory: null }
}

export function publicBlockCategory(codes: readonly RiskReasonCode[]): RiskReasonCategory {
  if (codes.includes('CONCURRENT_ACTIVE_RUN')) return 'SESSION'
  if (codes.includes('IMPOSSIBLE_SPEED')) return 'TIMING'
  return 'ELIGIBILITY'
}

export function dailyRewardSlotCount(): number {
  return DAILY_REWARD_SLOTS
}

function isImpossibleSpeedFromRun(run: DurableExpeditionRun): boolean {
  if (run.terminal?.type !== 'VERIFIED') return false
  const startedAt = run.gameplayStartedAt ?? run.startedAt
  return isImpossibleRunSpeed({
    actionCount: run.seq,
    startedAt,
    verifiedAt: run.terminal.result.verifiedAt,
  })
}

export function toRiskPrepareResult(
  runId: string,
  assessment: RiskAssessment,
): Extract<PrepareRewardClaimResult, { outcome: 'REVIEW' | 'BLOCK' }> | null {
  if (assessment.result === 'PASS') return null
  if (assessment.result === 'REVIEW') return { outcome: 'REVIEW', runId }
  return {
    outcome: 'BLOCK',
    runId,
    reasonCategory: assessment.reasonCategory ?? 'ELIGIBILITY',
  }
}
