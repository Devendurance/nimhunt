import { createHash, randomUUID, timingSafeEqual } from 'node:crypto'
import { automaticPayoutsAllowed, type PayoutExecutionConfig, type TreasurySecret } from './config.ts'
import { isPayoutError, PayoutError } from './errors.ts'
import { runPayoutWorker, type PayoutWorkerLog, type PayoutWorkerReport } from './worker.ts'
import {
  type PayoutCycleResult,
  type PayoutOperationsSnapshot,
  type PayoutStore,
  type TreasuryAdapter,
} from './types.ts'
import { utcDayKey } from '../ledger/utcDay.ts'

export const PAYOUT_CYCLE_PATH = '/api/internal/payout-cycle'
export const DEFAULT_PAYOUT_MAX_PER_CYCLE = 5
export const MAX_PAYOUT_MAX_PER_CYCLE = 69
export const MIN_PAYOUT_CRON_SECRET_LENGTH = 32
export const MAX_PAYOUT_CRON_SECRET_LENGTH = 4096

export type PayoutSchedulerSecretSource = 'CRON_SECRET' | 'NIMHUNT_PAYOUT_CRON_SECRET' | null

export type PayoutSchedulerConfig = {
  readonly maxPerCycle: number
  readonly cronSecret: string | null
  readonly cronSecretSource?: PayoutSchedulerSecretSource
}

const VITE_SCHEDULER_SECRET_KEYS = [
  'VITE_CRON_SECRET',
  'VITE_NIMHUNT_PAYOUT_CRON_SECRET',
] as const

export type PayoutOperationsStatus = {
  readonly automationEnvEnabled: boolean
  readonly automationDbEnabled: boolean
  readonly automationEnabled: boolean
  readonly treasuryPublicAddress: string | null
  readonly treasuryBalanceLuna: string | null
  readonly minimumReserveLuna: string | null
  readonly executionDay: string
  readonly executionDayCommittedLuna: string
  readonly remainingDailyBudgetLuna: string | null
  readonly pendingCount: number
  readonly processingCount: number
  readonly submittedCount: number
  readonly confirmedTodayCount: number
  readonly reviewCount: number
  readonly blockCount: number
  readonly lastCycleAt: string | null
  readonly lastCycleId: string | null
  readonly lastCycleResult: PayoutCycleResult | null
  readonly lastCycleErrors: readonly string[]
}

export type ScheduledPayoutCycleResult = {
  readonly authorized: true
  readonly automationEnabled: boolean
  readonly envAutomationEnabled: boolean
  readonly dbAutomationEnabled: boolean
  readonly cycleRan: true
  readonly result: PayoutCycleResult
  readonly errors: readonly string[]
  readonly signed: number
  readonly broadcast: number
  readonly report: PayoutWorkerReport
  readonly operations: PayoutOperationsStatus
}

export function readPayoutSchedulerConfig(
  env: Record<string, string | undefined> = process.env,
): PayoutSchedulerConfig {
  assertNoBrowserSchedulerSecrets(env)
  const rawMax = env.NIMHUNT_PAYOUT_MAX_PER_CYCLE
  const maxPerCycle = rawMax === undefined
    ? DEFAULT_PAYOUT_MAX_PER_CYCLE
    : parseMaxPerCycle(rawMax)
  // Canonical production secret is Vercel-native CRON_SECRET. Vercel Cron sends
  // `Authorization: Bearer <CRON_SECRET>` to the configured cron path when
  // CRON_SECRET is set in the project environment.
  // NIMHUNT_PAYOUT_CRON_SECRET is retained only as a local/dev alias.
  // Production must set exactly one value via CRON_SECRET; never both with
  // identical values and never any VITE_* variant.
  const rawCron = env.CRON_SECRET?.trim()
  const rawAlias = env.NIMHUNT_PAYOUT_CRON_SECRET?.trim()
  const useCron = rawCron !== undefined && rawCron.length > 0
  const useAlias = !useCron && rawAlias !== undefined && rawAlias.length > 0
  const cronSecret = useCron ? rawCron : useAlias ? rawAlias : null
  const cronSecretSource: PayoutSchedulerSecretSource = useCron
    ? 'CRON_SECRET'
    : useAlias
      ? 'NIMHUNT_PAYOUT_CRON_SECRET'
      : null
  if (cronSecret !== null && (
    cronSecret.length < MIN_PAYOUT_CRON_SECRET_LENGTH
    || cronSecret.length > MAX_PAYOUT_CRON_SECRET_LENGTH
  )) {
    throw new PayoutError('PAYOUT_SCHEDULER_SECRET_INVALID')
  }
  return { maxPerCycle, cronSecret, cronSecretSource }
}

function assertNoBrowserSchedulerSecrets(env: Record<string, string | undefined>): void {
  for (const key of VITE_SCHEDULER_SECRET_KEYS) {
    if (env[key]?.trim()) throw new PayoutError('PAYOUT_SCHEDULER_SECRET_INVALID')
  }
}

export function requirePayoutSchedulerSecret(config: PayoutSchedulerConfig): string {
  if (!config.cronSecret) throw new PayoutError('PAYOUT_SCHEDULER_SECRET_UNAVAILABLE')
  if (!isUsablePayoutSchedulerSecret(config.cronSecret)) {
    throw new PayoutError('PAYOUT_SCHEDULER_SECRET_INVALID')
  }
  return config.cronSecret
}

export function isUsablePayoutSchedulerSecret(value: string | null | undefined): value is string {
  return typeof value === 'string'
    && value.length >= MIN_PAYOUT_CRON_SECRET_LENGTH
    && value.length <= MAX_PAYOUT_CRON_SECRET_LENGTH
}

export function authorizePayoutSchedulerRequest(
  headers: Readonly<Record<string, string | undefined>> | undefined,
  expectedSecret: string | null | undefined,
): boolean {
  if (!isUsablePayoutSchedulerSecret(expectedSecret)) return false
  const candidate = readSchedulerSecretHeader(headers)
  return candidate !== null && constantTimeSecretEqual(expectedSecret, candidate)
}

export function constantTimeSecretEqual(expected: string, candidate: string): boolean {
  const expectedDigest = createHash('sha256').update(expected).digest()
  const candidateDigest = createHash('sha256').update(candidate).digest()
  const equal = timingSafeEqual(expectedDigest, candidateDigest)
  return equal && expected.length === candidate.length
}

export async function executeScheduledPayoutCycle(options: {
  readonly store: PayoutStore
  readonly treasury: TreasuryAdapter
  readonly config: PayoutExecutionConfig
  readonly scheduler: PayoutSchedulerConfig
  readonly secret?: TreasurySecret | null
  readonly log?: PayoutWorkerLog
  readonly now?: () => Date
}): Promise<ScheduledPayoutCycleResult> {
  assertMaxPerCycle(options.scheduler.maxPerCycle)
  const now = options.now ?? (() => new Date())
  let signed = 0
  let broadcast = 0
  let report: PayoutWorkerReport

  try {
    report = await runPayoutWorker({
      store: options.store,
      treasury: options.treasury,
      config: options.config,
      secret: options.secret,
      max: options.scheduler.maxPerCycle,
      log: options.log,
      onSigned: () => { signed += 1 },
      onBroadcast: () => { broadcast += 1 },
    })
  } catch (error) {
    const cycleAt = now().toISOString()
    await options.store.recordCycleResult({
      cycleId: randomUUID(),
      cycleAt,
      result: 'FAILED',
      errors: [safeErrorCode(error)],
    }).catch(() => undefined)
    throw error
  }

  const cycleErrors = [...safeCycleErrors(report.errors)]
  const envAutomationEnabled = options.config.automaticPayoutsEnabled === true
  const dbAutomationEnabled = await options.store.getAutomationEnabled().catch(() => false)
  const automationEnabled = automaticPayoutsAllowed(options.config) && dbAutomationEnabled
  const result: PayoutCycleResult = cycleErrors.length > 0
    ? 'FAILED'
    : automationEnabled
      ? 'COMPLETED'
      : 'DISABLED'
  const cycleAt = now().toISOString()
  try {
    await options.store.recordCycleResult({
      cycleId: report.cycleId,
      cycleAt,
      result,
      errors: cycleErrors,
    })
  } catch {
    cycleErrors.push('PAYOUT_CYCLE_STATE_UNAVAILABLE')
  }

  const operations = await readPayoutOperationsStatus({
    store: options.store,
    treasury: options.treasury,
    config: options.config,
    now: now(),
  })
  return {
    authorized: true,
    automationEnabled,
    envAutomationEnabled,
    dbAutomationEnabled,
    cycleRan: true,
    result: cycleErrors.length > 0 ? 'FAILED' : result,
    errors: cycleErrors,
    signed,
    broadcast,
    report,
    operations,
  }
}

export async function readPayoutOperationsStatus(options: {
  readonly store: PayoutStore
  readonly treasury: TreasuryAdapter
  readonly config: PayoutExecutionConfig
  readonly now?: Date
}): Promise<PayoutOperationsStatus> {
  const snapshot = await readSnapshotWithFallback(options.store, options.now ?? new Date())
  const treasuryPublicAddress = readTreasuryAddress(options.treasury)
  const treasuryBalanceLuna = await readTreasuryBalance(options.treasury)
  const cap = options.config.maxDailyRewardLuna
  const remaining = cap == null
    ? null
    : cap > snapshot.executionDayCommittedLuna
      ? (cap - snapshot.executionDayCommittedLuna).toString()
      : '0'

  return {
    automationEnvEnabled: options.config.automaticPayoutsEnabled === true,
    automationDbEnabled: snapshot.automationEnabled,
    automationEnabled: automaticPayoutsAllowed(options.config) && snapshot.automationEnabled,
    treasuryPublicAddress,
    treasuryBalanceLuna,
    minimumReserveLuna: options.config.treasuryMinReserveLuna == null
      ? null
      : options.config.treasuryMinReserveLuna.toString(),
    executionDay: snapshot.executionDay,
    executionDayCommittedLuna: snapshot.executionDayCommittedLuna.toString(),
    remainingDailyBudgetLuna: remaining,
    pendingCount: snapshot.pendingCount,
    processingCount: snapshot.processingCount,
    submittedCount: snapshot.submittedCount,
    confirmedTodayCount: snapshot.confirmedTodayCount,
    reviewCount: snapshot.reviewCount,
    blockCount: snapshot.blockCount,
    lastCycleAt: snapshot.lastCycleAt,
    lastCycleId: snapshot.lastCycleId,
    lastCycleResult: snapshot.lastCycleResult,
    lastCycleErrors: safeCycleErrors(snapshot.lastCycleErrors),
  }
}

function parseMaxPerCycle(raw: string): number {
  const trimmed = raw.trim()
  if (!/^[0-9]+$/.test(trimmed)) throw new PayoutError('PAYOUT_CYCLE_LIMIT_INVALID')
  const parsed = Number(trimmed)
  assertMaxPerCycle(parsed)
  return parsed
}

function assertMaxPerCycle(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_PAYOUT_MAX_PER_CYCLE) {
    throw new PayoutError('PAYOUT_CYCLE_LIMIT_INVALID')
  }
}

function readSchedulerSecretHeader(
  headers: Readonly<Record<string, string | undefined>> | undefined,
): string | null {
  const authorization = getHeader(headers, 'authorization')
  const custom = getHeader(headers, 'x-nimhunt-payout-cron-secret')
  if (authorization !== undefined && custom !== undefined) return null
  if (authorization !== undefined) {
    if (!/^Bearer [^\s]+$/.test(authorization)) return null
    return authorization.slice('Bearer '.length)
  }
  if (custom === undefined) return null
  const candidate = custom.trim()
  return candidate.length > 0 && candidate.length <= MAX_PAYOUT_CRON_SECRET_LENGTH ? candidate : null
}

function getHeader(
  headers: Readonly<Record<string, string | undefined>> | undefined,
  name: string,
): string | undefined {
  if (!headers) return undefined
  const expected = name.toLowerCase()
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === expected) return value
  }
  return undefined
}

async function readSnapshotWithFallback(store: PayoutStore, now: Date): Promise<PayoutOperationsSnapshot> {
  try {
    return await store.getOperationsSnapshot()
  } catch {
    return fallbackSnapshot(store, now)
  }
}

async function fallbackSnapshot(store: PayoutStore, now: Date): Promise<PayoutOperationsSnapshot> {
  const executionDay = utcDayKey(now)
  const [automationEnabled, pendingCount, processingCount, submittedCount, confirmed, risks, committed] = await Promise.all([
    store.getAutomationEnabled().catch(() => false),
    countStatus(store, 'PENDING'),
    countStatus(store, 'PROCESSING'),
    countStatus(store, 'SUBMITTED'),
    store.listByStatus('CONFIRMED', 69).catch(() => []),
    store.countUnpaidRiskSkips().catch(() => ({ reviewSkipped: 0, blockSkipped: 0 })),
    store.getExecutionDaySpend(executionDay).catch(() => 0n),
  ])
  return {
    automationEnabled,
    pendingCount,
    processingCount,
    submittedCount,
    confirmedTodayCount: confirmed.filter(payout => payout.confirmedAt && utcDayKey(new Date(payout.confirmedAt)) === executionDay).length,
    reviewCount: risks.reviewSkipped,
    blockCount: risks.blockSkipped,
    executionDay,
    executionDayCommittedLuna: committed,
    lastCycleAt: null,
    lastCycleId: null,
    lastCycleResult: null,
    lastCycleErrors: [],
  }
}

async function countStatus(
  store: PayoutStore,
  status: 'PENDING' | 'PROCESSING' | 'SUBMITTED',
): Promise<number> {
  try {
    return (await store.listByStatus(status, 69)).length
  } catch {
    return 0
  }
}

async function readTreasuryBalance(treasury: TreasuryAdapter): Promise<string | null> {
  try {
    const balance = await treasury.getBalance()
    return balance >= 0n ? balance.toString() : null
  } catch {
    return null
  }
}

function readTreasuryAddress(treasury: TreasuryAdapter): string | null {
  try {
    const address = treasury.address().trim()
    return address.length > 0 ? address : null
  } catch {
    return null
  }
}

function safeCycleErrors(errors: readonly string[]): string[] {
  return errors
    .filter(error => /^[A-Z0-9_]+$/.test(error))
    .slice(0, 20)
}

function safeErrorCode(error: unknown): string {
  if (isPayoutError(error)) return error.code
  return 'PAYOUT_UNAVAILABLE'
}
