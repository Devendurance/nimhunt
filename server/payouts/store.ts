import { randomUUID } from 'node:crypto'
import { utcDayKey } from '../ledger/utcDay.js'
import { PayoutError } from './errors.js'
import { readPayoutRpc, type PayoutRpcClient } from './db.js'
import {
  PAYOUT_NETWORKS,
  PAYOUT_STATUSES,
  type AutomatedAcquireReason,
  type PayoutCycleResult,
  type PayoutNetwork,
  type PayoutOperationsSnapshot,
  type PayoutStatus,
  type PayoutStore,
  type PublicRewardPayout,
  type RewardPayout,
  type UnpaidReservedClaim,
} from './types.js'

export function createPayoutStore(rpc: PayoutRpcClient): PayoutStore {
  return {
    async create(input) {
      const payload = readPayoutRpc(await rpc.rpc('create_reward_payout', {
        p_claim_id: input.claimId,
        p_payout_id: input.payoutId,
        p_amount_luna: input.amountLuna.toString(),
        p_network: input.network,
      }))
      return {
        existing: payload.existing === true,
        payout: asPayout(asRecord(payload.payout)),
      }
    },
    async acquire() {
      const payload = readPayoutRpc(await rpc.rpc('acquire_reward_payout'))
      return payload.payout == null ? null : asPayout(asRecord(payload.payout))
    },
    async markSubmitted(payoutId, txHash) {
      const payload = readPayoutRpc(await rpc.rpc('mark_reward_payout_submitted', {
        p_payout_id: payoutId,
        p_tx_hash: txHash,
      }))
      return asPayout(asRecord(payload.payout))
    },
    async markConfirmed(payoutId, txHash) {
      const payload = readPayoutRpc(await rpc.rpc('mark_reward_payout_confirmed', {
        p_payout_id: payoutId,
        p_tx_hash: txHash,
      }))
      return asPayout(asRecord(payload.payout))
    },
    async markFailed(input) {
      const payload = readPayoutRpc(await rpc.rpc('mark_reward_payout_failed', {
        p_payout_id: input.payoutId,
        p_status: input.status,
        p_failure_code: input.failureCode,
        p_failure_message_safe: input.failureMessageSafe,
      }))
      return asPayout(asRecord(payload.payout))
    },
    async get(payoutId) {
      const payload = readPayoutRpc(await rpc.rpc('get_reward_payout', { p_payout_id: payoutId }))
      return asPayout(asRecord(payload.payout))
    },
    async getByClaim(claimId) {
      const payload = readPayoutRpc(await rpc.rpc('get_reward_payout_by_claim', { p_claim_id: claimId }))
      return payload.payout == null ? null : asPayout(asRecord(payload.payout))
    },
    async getPublicForSession(claimId, sessionHash) {
      const payload = readPayoutRpc(await rpc.rpc('get_reward_payout_for_session', {
        p_claim_id: claimId,
        p_run_session_hash: sessionHash,
      }))
      return {
        claimId: asString(payload.claim_id),
        payout: payload.payout == null ? null : asPublicPayout(asRecord(payload.payout)),
      }
    },
    async listUnpaidReservedClaims(limit) {
      const payload = readPayoutRpc(await rpc.rpc('list_unpaid_reserved_claims', { p_limit: limit }))
      const claims = payload.claims
      if (!Array.isArray(claims)) return []
      return claims.map(entry => asUnpaidClaim(asRecord(entry)))
    },
    async countUnpaidRiskSkips() {
      const payload = readPayoutRpc(await rpc.rpc('count_unpaid_reward_risk_skips'))
      return {
        reviewSkipped: asNumber(payload.review_skipped),
        blockSkipped: asNumber(payload.block_skipped),
      }
    },
    async listByStatus(status, limit) {
      const payload = readPayoutRpc(await rpc.rpc('list_reward_payouts', {
        p_status: status,
        p_limit: limit,
      }))
      const payouts = payload.payouts
      if (!Array.isArray(payouts)) return []
      return payouts.map(entry => asPayout(asRecord(entry)))
    },
    async getAutomationEnabled() {
      const payload = readPayoutRpc(await rpc.rpc('get_payout_automation_control'))
      return payload.automatic_payouts_enabled === true
    },
    async setAutomationEnabled(enabled) {
      const payload = readPayoutRpc(await rpc.rpc('set_payout_automation_enabled', {
        p_enabled: enabled,
      }))
      return payload.automatic_payouts_enabled === true
    },
    async getExecutionDaySpend(executionDayKey) {
      const payload = readPayoutRpc(await rpc.rpc('get_execution_day_payout_spend', {
        p_execution_day: executionDayKey,
      }))
      return asNonNegativeBigInt(payload.committed_luna)
    },
    async getOperationsSnapshot() {
      const payload = readPayoutRpc(await rpc.rpc('get_payout_operations_status'))
      return asOperationsSnapshot(payload)
    },
    async recordCycleResult(input) {
      readPayoutRpc(await rpc.rpc('record_payout_cycle_result', {
        p_cycle_id: input.cycleId,
        p_cycle_at: input.cycleAt,
        p_result: input.result,
        p_errors: input.errors,
      }))
    },
    async acquireAutomated(input) {
      const payload = readPayoutRpc(await rpc.rpc('acquire_automated_reward_payout', {
        p_available_for_rewards_luna: input.availableForRewardsLuna,
        p_max_daily_reward_luna: input.maxDailyRewardLuna,
        p_fee_luna: input.feeLuna,
      }))
      return {
        payout: payload.payout == null ? null : asPayout(asRecord(payload.payout)),
        reason: asAcquireReason(payload.reason),
      }
    },
  }
}

export function createMemoryPayoutStore(options: {
  readonly claims?: ReadonlyMap<string, MemoryClaimRecord>
  readonly sessions?: ReadonlyMap<string, { readonly runId: string; readonly expiresAt: string; readonly revokedAt: string | null }>
  readonly clock?: { now(): Date }
} = {}): PayoutStore & {
  seedClaim(claim: MemoryClaimRecord): void
  seedSession(hash: string, session: { readonly runId: string; readonly expiresAt: string; readonly revokedAt: string | null }): void
  seedAssessment(runId: string, result: 'PASS' | 'REVIEW' | 'BLOCK'): void
} {
  const clock = options.clock ?? { now: () => new Date() }
  const mutex = new AsyncMutex()
  const payouts = new Map<string, RewardPayout>()
  const byClaim = new Map<string, string>()
  const claims = new Map(options.claims ?? [])
  const sessions = new Map(options.sessions ?? [])
  const assessments = new Map<string, 'PASS' | 'REVIEW' | 'BLOCK'>()
  let automationEnabled = false
  let lastCycle: {
    readonly cycleAt: string
    readonly cycleId: string
    readonly result: PayoutCycleResult
    readonly errors: readonly string[]
  } | null = null

  const store: PayoutStore & {
    seedClaim(claim: MemoryClaimRecord): void
    seedSession(hash: string, session: { readonly runId: string; readonly expiresAt: string; readonly revokedAt: string | null }): void
    seedAssessment(runId: string, result: 'PASS' | 'REVIEW' | 'BLOCK'): void
  } = {
    seedClaim(claim) {
      claims.set(claim.claimId, claim)
    },
    seedSession(hash, session) {
      sessions.set(hash, session)
    },
    seedAssessment(runId, result) {
      assessments.set(runId, result)
    },
    create(input) {
      return mutex.run(() => {
        const claim = claims.get(input.claimId)
        if (!claim) throw new PayoutError('CLAIM_NOT_FOUND')
        const existingId = byClaim.get(claim.claimId)
        if (existingId) {
          const existing = payouts.get(existingId)
          if (!existing) throw new PayoutError('PAYOUT_NOT_FOUND')
          return { existing: true, payout: existing }
        }
        if (claim.status !== 'RESERVED' || !claim.publicKey || !claim.signature || !claim.finalizedAt) {
          throw new PayoutError('CLAIM_NOT_ELIGIBLE')
        }
        if (input.amountLuna <= 0n) throw new PayoutError('PAYOUT_AMOUNT_INVALID')
        if (!PAYOUT_NETWORKS.includes(input.network)) throw new PayoutError('PAYOUT_NETWORK_INVALID')
        const now = clock.now().toISOString()
        const payout: RewardPayout = {
          payoutId: input.payoutId || randomUUID(),
          claimId: claim.claimId,
          runId: claim.runId,
          wallet: claim.wallet,
          dayKey: claim.dayKey,
          executionDayKey: null,
          amountLuna: input.amountLuna,
          network: input.network,
          status: 'PENDING',
          attemptCount: 0,
          txHash: null,
          failureCode: null,
          failureMessageSafe: null,
          createdAt: now,
          processingStartedAt: null,
          submittedAt: null,
          confirmedAt: null,
          updatedAt: now,
        }
        payouts.set(payout.payoutId, payout)
        byClaim.set(payout.claimId, payout.payoutId)
        return { existing: false, payout }
      })
    },
    acquire() {
      return mutex.run(() => {
        const next = nextAcquirable(payouts)
        if (!next) return null
        const now = clock.now().toISOString()
        const acquired: RewardPayout = {
          ...next,
          status: 'PROCESSING',
          executionDayKey: utcDayKey(clock.now()),
          attemptCount: next.attemptCount + 1,
          processingStartedAt: now,
          failureCode: null,
          failureMessageSafe: null,
          updatedAt: now,
        }
        payouts.set(acquired.payoutId, acquired)
        return acquired
      })
    },
    markSubmitted(payoutId, txHash) {
      return mutex.run(() => {
        const current = requirePayout(payouts, payoutId)
        if (current.status === 'SUBMITTED' || current.status === 'CONFIRMED') {
          if (current.txHash !== txHash) throw new PayoutError('PAYOUT_TX_MISMATCH')
          return current
        }
        if (current.status !== 'PROCESSING') throw new PayoutError('PAYOUT_STATUS_INVALID')
        if (current.txHash && current.txHash !== txHash) throw new PayoutError('PAYOUT_TX_MISMATCH')
        const now = clock.now().toISOString()
        const next: RewardPayout = {
          ...current,
          status: 'SUBMITTED',
          txHash,
          submittedAt: current.submittedAt ?? now,
          failureCode: null,
          failureMessageSafe: null,
          updatedAt: now,
        }
        payouts.set(next.payoutId, next)
        return next
      })
    },
    markConfirmed(payoutId, txHash) {
      return mutex.run(() => {
        const current = requirePayout(payouts, payoutId)
        if (current.status === 'CONFIRMED') {
          if (current.txHash !== txHash) throw new PayoutError('PAYOUT_TX_MISMATCH')
          return current
        }
        if (current.status !== 'SUBMITTED' || !current.txHash) throw new PayoutError('PAYOUT_STATUS_INVALID')
        if (current.txHash !== txHash) throw new PayoutError('PAYOUT_TX_MISMATCH')
        const now = clock.now().toISOString()
        const next: RewardPayout = {
          ...current,
          status: 'CONFIRMED',
          confirmedAt: current.confirmedAt ?? now,
          failureCode: null,
          failureMessageSafe: null,
          updatedAt: now,
        }
        payouts.set(next.payoutId, next)
        return next
      })
    },
    markFailed(input) {
      return mutex.run(() => {
        const current = requirePayout(payouts, input.payoutId)
        if (current.status === 'CONFIRMED') throw new PayoutError('PAYOUT_STATUS_INVALID')
        if (input.status === 'FAILED_RETRYABLE' && current.txHash) throw new PayoutError('PAYOUT_RESEND_UNSAFE')
        const now = clock.now().toISOString()
        const next: RewardPayout = {
          ...current,
          status: input.status,
          failureCode: input.failureCode,
          failureMessageSafe: input.failureMessageSafe,
          updatedAt: now,
        }
        payouts.set(next.payoutId, next)
        return next
      })
    },
    async get(payoutId) {
      return requirePayout(payouts, payoutId)
    },
    async getByClaim(claimId) {
      const payoutId = byClaim.get(claimId)
      return payoutId ? payouts.get(payoutId) ?? null : null
    },
    async getPublicForSession(claimId, sessionHash) {
      const session = sessions.get(sessionHash)
      if (!session || session.revokedAt || clock.now().getTime() >= new Date(session.expiresAt).getTime()) {
        throw new PayoutError('RUN_SESSION_INVALID')
      }
      const claim = claims.get(claimId)
      if (!claim || claim.runId !== session.runId) throw new PayoutError('CLAIM_NOT_FOUND')
      if (claim.status !== 'RESERVED') throw new PayoutError('CLAIM_NOT_ELIGIBLE')
      const payoutId = byClaim.get(claim.claimId)
      const payout = payoutId ? payouts.get(payoutId) ?? null : null
      return {
        claimId: claim.claimId,
        payout: payout ? toPublicPayout(payout) : null,
      }
    },
    async listUnpaidReservedClaims(limit) {
      return [...claims.values()]
        .filter(claim => (
          claim.status === 'RESERVED'
          && claim.publicKey
          && claim.signature
          && claim.finalizedAt
          && !byClaim.has(claim.claimId)
          && assessments.get(claim.runId) === 'PASS'
        ))
        .sort((left, right) => {
          const time = (left.finalizedAt ?? '').localeCompare(right.finalizedAt ?? '')
          return time !== 0 ? time : left.claimId.localeCompare(right.claimId)
        })
        .slice(0, limit)
        .map(claim => ({
          claimId: claim.claimId,
          runId: claim.runId,
          wallet: claim.wallet,
          dayKey: claim.dayKey,
        }))
    },
    async countUnpaidRiskSkips() {
      let reviewSkipped = 0
      let blockSkipped = 0
      for (const claim of claims.values()) {
        if (claim.status !== 'RESERVED' || byClaim.has(claim.claimId)) continue
        const result = assessments.get(claim.runId)
        if (result === 'REVIEW') reviewSkipped += 1
        if (result === 'BLOCK') blockSkipped += 1
      }
      return { reviewSkipped, blockSkipped }
    },
    async listByStatus(status, limit) {
      return [...payouts.values()]
        .filter(payout => payout.status === status)
        .sort(comparePayoutOrder)
        .slice(0, limit)
    },
    async getAutomationEnabled() {
      return automationEnabled
    },
    async setAutomationEnabled(enabled) {
      automationEnabled = enabled
      return automationEnabled
    },
    getExecutionDaySpend(executionDayKey) {
      return mutex.run(() => sumCommitted(payouts, executionDayKey))
    },
    getOperationsSnapshot() {
      return mutex.run(() => {
        const executionDay = utcDayKey(clock.now())
        let confirmedTodayCount = 0
        let reviewCount = 0
        let blockCount = 0
        for (const payout of payouts.values()) {
          if (payout.status === 'CONFIRMED' && payout.confirmedAt && utcDayKey(new Date(payout.confirmedAt)) === executionDay) {
            confirmedTodayCount += 1
          }
        }
        for (const claim of claims.values()) {
          if (claim.status !== 'RESERVED' || byClaim.has(claim.claimId)) continue
          const result = assessments.get(claim.runId)
          if (result === 'REVIEW') reviewCount += 1
          if (result === 'BLOCK') blockCount += 1
        }
        return {
          automationEnabled,
          pendingCount: countPayouts(payouts, 'PENDING'),
          processingCount: countPayouts(payouts, 'PROCESSING'),
          submittedCount: countPayouts(payouts, 'SUBMITTED'),
          confirmedTodayCount,
          reviewCount,
          blockCount,
          executionDay,
          executionDayCommittedLuna: sumCommitted(payouts, executionDay),
          lastCycleAt: lastCycle?.cycleAt ?? null,
          lastCycleId: lastCycle?.cycleId ?? null,
          lastCycleResult: lastCycle?.result ?? null,
          lastCycleErrors: lastCycle?.errors ?? [],
        }
      })
    },
    recordCycleResult(input) {
      return mutex.run(() => {
        if (lastCycle && lastCycle.cycleAt > input.cycleAt) return
        lastCycle = {
          cycleAt: input.cycleAt,
          cycleId: input.cycleId,
          result: input.result,
          errors: [...input.errors],
        }
      })
    },
    acquireAutomated(input) {
      return mutex.run(() => {
        if (!automationEnabled) return { payout: null, reason: 'AUTOMATION_DISABLED' as const }
        if (input.availableForRewardsLuna < 0n) return { payout: null, reason: 'TREASURY_LOW' as const }
        if (input.maxDailyRewardLuna <= 0n) throw new PayoutError('PAYOUT_DAILY_CAP_INVALID')
        if (input.feeLuna < 0n) throw new PayoutError('PAYOUT_AMOUNT_INVALID')
        const next = nextAutomatedAcquirable(payouts, claims, assessments)
        if (!next) return { payout: null, reason: 'NO_WORK' as const }
        const executionDayKey = utcDayKey(clock.now())
        const committed = sumCommitted(payouts, executionDayKey)
        if (committed + next.amountLuna > input.maxDailyRewardLuna) {
          return { payout: null, reason: 'DAILY_CAP_REACHED' as const }
        }
        const outstanding = sumOutstanding(payouts)
        if (outstanding + next.amountLuna + input.feeLuna > input.availableForRewardsLuna) {
          return { payout: null, reason: 'TREASURY_LOW' as const }
        }
        const now = clock.now().toISOString()
        const acquired: RewardPayout = {
          ...next,
          status: 'PROCESSING',
          executionDayKey,
          attemptCount: next.attemptCount + 1,
          processingStartedAt: now,
          failureCode: null,
          failureMessageSafe: null,
          updatedAt: now,
        }
        payouts.set(acquired.payoutId, acquired)
        return { payout: acquired, reason: null }
      })
    },
  }
  return store
}

export type MemoryClaimRecord = {
  readonly claimId: string
  readonly runId: string
  readonly wallet: string
  readonly dayKey: string
  readonly status: string
  readonly publicKey: string | null
  readonly signature: string | null
  readonly finalizedAt: string | null
}

function nextAcquirable(payouts: Map<string, RewardPayout>): RewardPayout | undefined {
  return [...payouts.values()]
    .filter(payout => (payout.status === 'PENDING' || payout.status === 'FAILED_RETRYABLE') && payout.txHash === null)
    .sort(comparePayoutOrder)[0]
}

function nextAutomatedAcquirable(
  payouts: Map<string, RewardPayout>,
  claims: Map<string, MemoryClaimRecord>,
  assessments: Map<string, 'PASS' | 'REVIEW' | 'BLOCK'>,
): RewardPayout | undefined {
  return [...payouts.values()]
    .filter(payout => {
      if ((payout.status !== 'PENDING' && payout.status !== 'FAILED_RETRYABLE') || payout.txHash) return false
      const claim = claims.get(payout.claimId)
      return claim?.status === 'RESERVED' && assessments.get(payout.runId) === 'PASS'
    })
    .sort(comparePayoutOrder)[0]
}

function countPayouts(payouts: Map<string, RewardPayout>, status: PayoutStatus): number {
  let count = 0
  for (const payout of payouts.values()) {
    if (payout.status === status) count += 1
  }
  return count
}

function sumCommitted(payouts: Map<string, RewardPayout>, executionDayKey: string): bigint {
  let total = 0n
  for (const payout of payouts.values()) {
    if (payout.executionDayKey !== executionDayKey) continue
    if (payout.status === 'PROCESSING' || payout.status === 'SUBMITTED' || payout.status === 'CONFIRMED') {
      total += payout.amountLuna
    } else if (payout.status === 'FAILED_FINAL' && payout.txHash) {
      total += payout.amountLuna
    }
  }
  return total
}

function sumOutstanding(payouts: Map<string, RewardPayout>): bigint {
  let total = 0n
  for (const payout of payouts.values()) {
    if (payout.status === 'PROCESSING' && !payout.txHash) total += payout.amountLuna
  }
  return total
}

function comparePayoutOrder(left: RewardPayout, right: RewardPayout): number {
  const time = left.createdAt.localeCompare(right.createdAt)
  return time !== 0 ? time : left.payoutId.localeCompare(right.payoutId)
}

function asAcquireReason(value: unknown): AutomatedAcquireReason | null {
  if (value == null) return null
  if (value === 'AUTOMATION_DISABLED' || value === 'TREASURY_LOW' || value === 'DAILY_CAP_REACHED' || value === 'NO_WORK') {
    return value
  }
  throw new PayoutError('PAYOUT_UNAVAILABLE')
}

class AsyncMutex {
  private tail: Promise<void> = Promise.resolve()

  run<T>(fn: () => T | Promise<T>): Promise<T> {
    const current = this.tail.then(fn, fn)
    this.tail = current.then(() => undefined, () => undefined)
    return current
  }
}

function requirePayout(payouts: Map<string, RewardPayout>, payoutId: string): RewardPayout {
  const payout = payouts.get(payoutId)
  if (!payout) throw new PayoutError('PAYOUT_NOT_FOUND')
  return payout
}

function asPayout(value: Record<string, unknown>): RewardPayout {
  const status = asString(value.status)
  const network = asString(value.network)
  if (!PAYOUT_STATUSES.includes(status as PayoutStatus)) throw new PayoutError('PAYOUT_STATUS_INVALID')
  if (!PAYOUT_NETWORKS.includes(network as PayoutNetwork)) throw new PayoutError('PAYOUT_NETWORK_INVALID')
  return {
    payoutId: asString(value.payout_id),
    claimId: asString(value.claim_id),
    runId: asString(value.run_id),
    wallet: asString(value.wallet),
    dayKey: asString(value.day_key).slice(0, 10),
    executionDayKey: value.execution_day_key == null ? null : asString(value.execution_day_key).slice(0, 10),
    amountLuna: asBigInt(value.amount_luna),
    network: network as PayoutNetwork,
    status: status as PayoutStatus,
    attemptCount: asNumber(value.attempt_count),
    txHash: value.tx_hash == null ? null : asString(value.tx_hash),
    failureCode: value.failure_code == null ? null : asString(value.failure_code),
    failureMessageSafe: value.failure_message_safe == null ? null : asString(value.failure_message_safe),
    createdAt: asIso(value.created_at),
    processingStartedAt: value.processing_started_at == null ? null : asIso(value.processing_started_at),
    submittedAt: value.submitted_at == null ? null : asIso(value.submitted_at),
    confirmedAt: value.confirmed_at == null ? null : asIso(value.confirmed_at),
    updatedAt: asIso(value.updated_at),
  }
}

export function toPublicPayout(payout: RewardPayout): PublicRewardPayout {
  return {
    payoutId: payout.payoutId,
    claimId: payout.claimId,
    status: payout.status,
    amountLuna: payout.amountLuna.toString(),
    network: payout.network,
    txHashSafe: payout.txHash,
    submittedAt: payout.submittedAt,
    confirmedAt: payout.confirmedAt,
  }
}

function asPublicPayout(value: Record<string, unknown>): PublicRewardPayout {
  const status = asString(value.status)
  const network = asString(value.network)
  if (!PAYOUT_STATUSES.includes(status as PayoutStatus)) throw new PayoutError('PAYOUT_STATUS_INVALID')
  if (!PAYOUT_NETWORKS.includes(network as PayoutNetwork)) throw new PayoutError('PAYOUT_NETWORK_INVALID')
  const txHash = value.tx_hash_safe == null && value.tx_hash == null
    ? null
    : asString(value.tx_hash_safe ?? value.tx_hash)
  return {
    payoutId: asString(value.payout_id),
    claimId: asString(value.claim_id),
    status: status as PayoutStatus,
    amountLuna: asBigInt(value.amount_luna).toString(),
    network: network as PayoutNetwork,
    txHashSafe: txHash,
    submittedAt: value.submitted_at == null ? null : asIso(value.submitted_at),
    confirmedAt: value.confirmed_at == null ? null : asIso(value.confirmed_at),
  }
}

function asUnpaidClaim(value: Record<string, unknown>): UnpaidReservedClaim {
  return {
    claimId: asString(value.claim_id),
    runId: asString(value.run_id),
    wallet: asString(value.wallet),
    dayKey: asString(value.day_key).slice(0, 10),
  }
}

function asOperationsSnapshot(value: Record<string, unknown>): PayoutOperationsSnapshot {
  const result = asCycleResult(value.last_cycle_result)
  const errors = value.last_cycle_errors
  if (!Array.isArray(errors) || errors.some(error => typeof error !== 'string' || !/^[A-Z0-9_]+$/.test(error))) {
    throw new PayoutError('PAYOUT_UNAVAILABLE')
  }
  return {
    automationEnabled: value.automation_enabled === true,
    pendingCount: asNumber(value.pending_count),
    processingCount: asNumber(value.processing_count),
    submittedCount: asNumber(value.submitted_count),
    confirmedTodayCount: asNumber(value.confirmed_today_count),
    reviewCount: asNumber(value.review_count),
    blockCount: asNumber(value.block_count),
    executionDay: asString(value.execution_day).slice(0, 10),
    executionDayCommittedLuna: asNonNegativeBigInt(value.execution_day_committed_luna),
    lastCycleAt: value.last_cycle_at == null ? null : asIso(value.last_cycle_at),
    lastCycleId: value.last_cycle_id == null ? null : asString(value.last_cycle_id),
    lastCycleResult: result,
    lastCycleErrors: errors,
  }
}

function asCycleResult(value: unknown): PayoutCycleResult | null {
  if (value === null || value === undefined) return null
  if (value === 'COMPLETED' || value === 'DISABLED' || value === 'FAILED') return value
  throw new PayoutError('PAYOUT_UNAVAILABLE')
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new PayoutError('PAYOUT_UNAVAILABLE')
  return value as Record<string, unknown>
}

function asString(value: unknown): string {
  if (typeof value === 'string' && value.length > 0) return value
  throw new PayoutError('PAYOUT_UNAVAILABLE')
}

function asNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return value
  if (typeof value === 'string' && /^[0-9]+$/.test(value)) return Number(value)
  throw new PayoutError('PAYOUT_UNAVAILABLE')
}

function asBigInt(value: unknown): bigint {
  if (typeof value === 'bigint' && value > 0n) return value
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return BigInt(value)
  if (typeof value === 'string' && /^[0-9]+$/.test(value)) return BigInt(value)
  throw new PayoutError('PAYOUT_AMOUNT_INVALID')
}

function asNonNegativeBigInt(value: unknown): bigint {
  if (typeof value === 'bigint' && value >= 0n) return value
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return BigInt(value)
  if (typeof value === 'string' && /^[0-9]+$/.test(value)) return BigInt(value)
  throw new PayoutError('PAYOUT_AMOUNT_INVALID')
}

function asIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString()
  const text = asString(value)
  const parsed = new Date(text)
  if (Number.isNaN(parsed.getTime())) throw new PayoutError('PAYOUT_UNAVAILABLE')
  return parsed.toISOString()
}
