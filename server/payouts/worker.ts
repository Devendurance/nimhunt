import { randomUUID } from 'node:crypto'
import {
  automaticPayoutsAllowed,
  requireAutomaticPayoutConfig,
  requirePayoutAmountLuna,
  requirePayoutNetwork,
  type PayoutExecutionConfig,
  type TreasurySecret,
} from './config.js'
import { utcDayKey } from '../ledger/utcDay.js'
import { isPayoutError, PayoutError } from './errors.js'
import { createPayoutService } from './service.js'
import {
  AUTOMATED_PAYOUT_FEE_LUNA,
  type PayoutStore,
  type RewardPayout,
  type TreasuryAdapter,
} from './types.js'

export type PayoutWorkerReport = {
  readonly cycleId: string
  readonly eligibleClaims: number
  readonly payoutsCreated: number
  readonly pending: number
  readonly submitted: number
  readonly confirmed: number
  readonly signed: number
  readonly broadcast: number
  readonly treasuryLow: boolean
  readonly dailyCapReached: boolean
  readonly reviewSkipped: number
  readonly blockSkipped: number
  readonly errors: readonly string[]
  readonly wouldCreate: number
  readonly wouldProcess: number
  readonly dryRun: boolean
  readonly executionDay: string
  readonly executionDayCommittedLuna: string
  readonly executionDayRemainingLuna: string
}

export type PayoutWorkerLog = {
  (event: Record<string, unknown>): void
}

export async function preparePayoutsWithoutBroadcast(options: {
  readonly store: PayoutStore
  readonly config: PayoutExecutionConfig
  readonly createLimit?: number
  readonly claimId?: string
}): Promise<RewardPayout[]> {
  const network = requirePayoutNetwork(options.config)
  const amountLuna = requirePayoutAmountLuna(options.config)
  const claimIds = options.claimId
    ? [options.claimId]
    : (await options.store.listUnpaidReservedClaims(options.createLimit ?? 69)).map(claim => claim.claimId)
  const created: RewardPayout[] = []
  for (const claimId of claimIds) {
    const result = await options.store.create({
      claimId,
      payoutId: randomUUID(),
      amountLuna,
      network,
    })
    created.push(result.payout)
  }
  return created
}

export async function runPayoutWorker(options: {
  readonly store: PayoutStore
  readonly treasury: TreasuryAdapter
  readonly config: PayoutExecutionConfig
  readonly secret?: TreasurySecret | null
  readonly max?: number
  readonly log?: PayoutWorkerLog
  readonly dryRun?: boolean
  readonly mockAvailableLuna?: bigint
  readonly onSigned?: () => void
  readonly onBroadcast?: () => void
}): Promise<PayoutWorkerReport> {
  const cycleId = randomUUID()
  const max = clampMax(options.max)
  const log = options.log ?? (() => undefined)
  const errors: string[] = []
  let eligibleClaims = 0
  let payoutsCreated = 0
  let submitted = 0
  let confirmed = 0
  let signed = 0
  let broadcast = 0
  let treasuryLow = false
  let dailyCapReached = false
  let reviewSkipped = 0
  let blockSkipped = 0

  const executionDay = utcDayKey(new Date())
  async function finish(
    value: Omit<PayoutWorkerReport, 'wouldCreate' | 'wouldProcess' | 'dryRun' | 'executionDay' | 'executionDayCommittedLuna' | 'executionDayRemainingLuna' | 'signed' | 'broadcast'> & Partial<PayoutWorkerReport>,
  ): Promise<PayoutWorkerReport> {
    const accounting = await readExecutionDayAccounting(options.store, options.config, executionDay, errors)
    return report({ ...value, ...accounting, signed, broadcast })
  }

  log({ cycleId, event: 'cycle_start', max, executionDay })

  async function discoverEligible(): Promise<void> {
    try {
      const skips = await options.store.countUnpaidRiskSkips()
      reviewSkipped = skips.reviewSkipped
      blockSkipped = skips.blockSkipped
      const unpaid = await options.store.listUnpaidReservedClaims(max)
      eligibleClaims = unpaid.length
    } catch (error) {
      errors.push(codeOf(error))
    }
  }

  const dbEnabled = await options.store.getAutomationEnabled().catch(error => {
    errors.push(codeOf(error))
    return false
  })
  const dryRun = options.dryRun === true
  const execute = !dryRun && automaticPayoutsAllowed(options.config) && dbEnabled === true

  if (dryRun) {
    await discoverEligible()
    const pending = await countStatus(options.store, 'PENDING')
    const retryable = await countStatus(options.store, 'FAILED_RETRYABLE')
    const wouldCreate = eligibleClaims
    const wouldProcess = Math.min(max, pending + retryable)
    const nextAmount = (wouldCreate > 0 || wouldProcess > 0) ? (options.config.amountLuna ?? 0n) : 0n
    treasuryLow = mockedTreasuryLow(options.config, options.mockAvailableLuna) && nextAmount > 0n
    dailyCapReached = await estimateDailyCapReached(options.store, options.config, nextAmount, executionDay)
    log({
      cycleId,
      event: 'dry_run',
      envAutomatic: options.config.automaticPayoutsEnabled === true,
      dbAutomatic: dbEnabled,
      mockAvailableLuna: options.mockAvailableLuna == null ? null : options.mockAvailableLuna.toString(),
      executionDay,
      note: 'Dry-run never acquires, signs, broadcasts, or mutates payout status.',
    })
    return finish({
      cycleId,
      eligibleClaims,
      payoutsCreated: 0,
      pending,
      submitted: 0,
      confirmed: 0,
      treasuryLow,
      dailyCapReached,
      reviewSkipped,
      blockSkipped,
      errors,
      wouldCreate,
      wouldProcess,
      dryRun: true,
    })
  }

  let service: ReturnType<typeof createPayoutService> | null = null
  try {
    service = createPayoutService({
      store: options.store,
      treasury: options.treasury,
      config: options.config,
      hooks: {
        onSigned: () => {
          signed += 1
          options.onSigned?.()
        },
        onBroadcast: () => {
          broadcast += 1
          options.onBroadcast?.()
        },
      },
    })
  } catch (error) {
    errors.push(codeOf(error))
  }

  if (service) {
    const firstReconcile = await reconcileSubmitted(options, max, log, errors, service)
    submitted += firstReconcile.submitted
    confirmed += firstReconcile.confirmed

    const recovered = await recoverProcessing(service, options.store, max, log, errors)
    submitted += recovered.submitted
    confirmed += recovered.confirmed
  }

  await discoverEligible()

  if (!execute) {
    log({
      cycleId,
      event: 'kill_switch',
      envAutomatic: options.config.automaticPayoutsEnabled === true,
      mainnetEnabled: options.config.mainnetEnabled,
      network: options.config.network,
      dbAutomatic: dbEnabled,
      note: 'Read-only reconciliation and safe PROCESSING recovery may run. Acquisition, signing, and broadcast are stopped.',
    })
    return finish({
      cycleId,
      eligibleClaims,
      payoutsCreated,
      pending: await countStatus(options.store, 'PENDING'),
      submitted,
      confirmed,
      treasuryLow,
      dailyCapReached,
      reviewSkipped,
      blockSkipped,
      errors,
    })
  }

  let amountLuna: bigint
  let maxDailyRewardLuna: bigint
  let treasuryMinReserveLuna: bigint
  try {
    const required = requireAutomaticPayoutConfig(options.config, options.secret)
    amountLuna = required.amountLuna
    maxDailyRewardLuna = required.maxDailyRewardLuna
    treasuryMinReserveLuna = required.treasuryMinReserveLuna
    requirePayoutNetwork(options.config, 'mainnet')
    if (options.treasury.network !== 'mainnet') throw new PayoutError('PAYOUT_NETWORK_INVALID')
  } catch (error) {
    errors.push(codeOf(error))
    return finish({
      cycleId,
      eligibleClaims,
      payoutsCreated,
      pending: await countStatus(options.store, 'PENDING'),
      submitted,
      confirmed,
      treasuryLow,
      dailyCapReached,
      reviewSkipped,
      blockSkipped,
      errors,
    })
  }

  if (!service) {
    return finish({
      cycleId,
      eligibleClaims,
      payoutsCreated,
      pending: await countStatus(options.store, 'PENDING'),
      submitted,
      confirmed,
      treasuryLow,
      dailyCapReached,
      reviewSkipped,
      blockSkipped,
      errors,
    })
  }
  const activeService = service
  const unpaid = await options.store.listUnpaidReservedClaims(max)
  eligibleClaims = Math.max(eligibleClaims, unpaid.length)
  for (const claim of unpaid) {
    try {
      const before = await options.store.getByClaim(claim.claimId)
      const created = await activeService.ensureForReservedClaim(claim.claimId)
      if (!before) {
        payoutsCreated += 1
        logPayout(log, created, 'none', 'PENDING')
      }
    } catch (error) {
      errors.push(codeOf(error))
    }
  }

  for (let index = 0; index < max; index += 1) {
    let availableForRewards: bigint
    try {
      const balance = await options.treasury.getBalance()
      availableForRewards = balance - treasuryMinReserveLuna
      if (availableForRewards < amountLuna + AUTOMATED_PAYOUT_FEE_LUNA) {
        treasuryLow = true
        log({ cycleId, event: 'treasury_low', availableForRewards: availableForRewards.toString() })
        break
      }
    } catch (error) {
      errors.push(codeOf(error))
      treasuryLow = true
      break
    }

    let acquired
    try {
      acquired = await options.store.acquireAutomated({
        availableForRewardsLuna: availableForRewards < 0n ? 0n : availableForRewards,
        maxDailyRewardLuna,
        feeLuna: AUTOMATED_PAYOUT_FEE_LUNA,
      })
    } catch (error) {
      errors.push(codeOf(error))
      break
    }

    if (!acquired.payout) {
      if (acquired.reason === 'TREASURY_LOW') treasuryLow = true
      if (acquired.reason === 'DAILY_CAP_REACHED') dailyCapReached = true
      if (acquired.reason === 'AUTOMATION_DISABLED') {
        log({ cycleId, event: 'kill_switch', dbAutomatic: false })
      }
      break
    }

    logPayout(log, acquired.payout, 'PENDING', 'PROCESSING')
    try {
      const executed = await activeService.executeAcquired(acquired.payout)
      if (executed.status === 'SUBMITTED') {
        submitted += 1
        logPayout(log, executed, 'PROCESSING', 'SUBMITTED', executed.txHash)
      } else if (executed.status === 'CONFIRMED') {
        confirmed += 1
        logPayout(log, executed, 'PROCESSING', 'CONFIRMED', executed.txHash)
      } else {
        logPayout(log, executed, 'PROCESSING', executed.status)
      }
    } catch (error) {
      errors.push(codeOf(error))
      break
    }
  }

  const finalReconcile = await reconcileSubmitted(options, max, log, errors, service)
  submitted += finalReconcile.submitted
  confirmed += finalReconcile.confirmed

  return finish({
    cycleId,
    eligibleClaims,
    payoutsCreated,
    pending: await countStatus(options.store, 'PENDING'),
    submitted,
    confirmed,
    treasuryLow,
    dailyCapReached,
    reviewSkipped,
    blockSkipped,
    errors,
  })
}

async function recoverProcessing(
  service: ReturnType<typeof createPayoutService>,
  store: PayoutStore,
  max: number,
  log: PayoutWorkerLog,
  errors: string[],
): Promise<{ submitted: number; confirmed: number }> {
  let submitted = 0
  let confirmed = 0
  const stale = await store.listByStatus('PROCESSING', max)
  for (const payout of stale) {
    try {
      if (payout.txHash) {
        const persisted = await store.markSubmitted(payout.payoutId, payout.txHash)
        logPayout(log, persisted, 'PROCESSING', 'SUBMITTED', persisted.txHash)
        submitted += 1
        continue
      }
      const recovered = await service.recoverAmbiguous(payout)
      logPayout(log, recovered, 'PROCESSING', recovered.status, recovered.txHash)
      if (recovered.status === 'SUBMITTED') submitted += 1
      if (recovered.status === 'CONFIRMED') confirmed += 1
    } catch (error) {
      errors.push(codeOf(error))
    }
  }
  return { submitted, confirmed }
}

async function reconcileSubmitted(
  options: {
    readonly store: PayoutStore
    readonly treasury: TreasuryAdapter
    readonly config: PayoutExecutionConfig
  },
  max: number,
  log: PayoutWorkerLog,
  errors: string[],
  service?: ReturnType<typeof createPayoutService>,
): Promise<{ submitted: number; confirmed: number }> {
  const submitted = 0
  let confirmed = 0
  let active = service
  if (!active) {
    try {
      active = createPayoutService({
        store: options.store,
        treasury: options.treasury,
        config: options.config,
      })
    } catch (error) {
      errors.push(codeOf(error))
      return { submitted, confirmed }
    }
  }
  const rows = await options.store.listByStatus('SUBMITTED', max)
  for (const payout of rows) {
    try {
      const result = await active.reconcile(payout)
      if (!result) continue
      if (result.status === 'CONFIRMED') {
        confirmed += 1
        logPayout(log, result, 'SUBMITTED', 'CONFIRMED', result.txHash)
      } else if (result.status !== 'SUBMITTED') {
        logPayout(log, result, 'SUBMITTED', result.status, result.txHash)
      }
    } catch (error) {
      errors.push(codeOf(error))
    }
  }
  return { submitted, confirmed }
}

async function countStatus(store: PayoutStore, status: 'PENDING' | 'FAILED_RETRYABLE'): Promise<number> {
  return (await store.listByStatus(status, 69)).length
}

async function estimateDailyCapReached(
  store: PayoutStore,
  config: PayoutExecutionConfig,
  nextAmountLuna: bigint,
  executionDay: string,
): Promise<boolean> {
  if (config.maxDailyRewardLuna == null || nextAmountLuna <= 0n) return false
  try {
    const committed = await store.getExecutionDaySpend(executionDay)
    return committed + nextAmountLuna > config.maxDailyRewardLuna
  } catch {
    return false
  }
}

async function readExecutionDayAccounting(
  store: PayoutStore,
  config: PayoutExecutionConfig,
  executionDay: string,
  errors: string[],
): Promise<{
  readonly executionDay: string
  readonly executionDayCommittedLuna: string
  readonly executionDayRemainingLuna: string
}> {
  let committed = 0n
  try {
    committed = await store.getExecutionDaySpend(executionDay)
  } catch (error) {
    errors.push(codeOf(error))
  }
  const cap = config.maxDailyRewardLuna ?? 0n
  const remaining = cap > committed ? cap - committed : 0n
  return {
    executionDay,
    executionDayCommittedLuna: committed.toString(),
    executionDayRemainingLuna: remaining.toString(),
  }
}

function mockedTreasuryLow(config: PayoutExecutionConfig, mockAvailableLuna: bigint | undefined): boolean {
  if (mockAvailableLuna == null) return false
  const amountLuna = config.amountLuna ?? 0n
  const reserveLuna = config.treasuryMinReserveLuna ?? 0n
  return mockAvailableLuna < amountLuna + reserveLuna + AUTOMATED_PAYOUT_FEE_LUNA
}

function report(value: Omit<PayoutWorkerReport, 'wouldCreate' | 'wouldProcess' | 'dryRun' | 'executionDay' | 'executionDayCommittedLuna' | 'executionDayRemainingLuna'> & Partial<PayoutWorkerReport>): PayoutWorkerReport {
  return {
    ...value,
    wouldCreate: value.wouldCreate ?? 0,
    wouldProcess: value.wouldProcess ?? 0,
    dryRun: value.dryRun ?? false,
    signed: value.signed ?? 0,
    broadcast: value.broadcast ?? 0,
    executionDay: value.executionDay ?? utcDayKey(new Date()),
    executionDayCommittedLuna: value.executionDayCommittedLuna ?? '0',
    executionDayRemainingLuna: value.executionDayRemainingLuna ?? '0',
  }
}

function clampMax(value: number | undefined): number {
  if (value == null || !Number.isInteger(value) || value < 1) return 5
  return Math.min(value, 69)
}

function codeOf(error: unknown): string {
  if (isPayoutError(error)) return error.code
  return 'PAYOUT_UNAVAILABLE'
}

function logPayout(
  log: PayoutWorkerLog,
  payout: RewardPayout,
  from: string,
  to: string,
  txHash?: string | null,
): void {
  log({
    payoutId: shortenId(payout.payoutId),
    recipient: shortenWallet(payout.wallet),
    amountLuna: payout.amountLuna.toString(),
    reservationDay: payout.dayKey,
    executionDay: payout.executionDayKey,
    transition: `${from}->${to}`,
    ...(txHash ? { txHash } : {}),
  })
}

export function shortenPayoutId(value: string): string {
  return shortenId(value)
}

export function shortenPayoutWallet(value: string): string {
  return shortenWallet(value)
}

function shortenId(value: string): string {
  return `${value.replaceAll('-', '').slice(0, 8)}…`
}

function shortenWallet(value: string): string {
  const compact = value.replace(/\s+/g, '')
  return `${compact.slice(0, 6)}…${compact.slice(-4)}`
}
