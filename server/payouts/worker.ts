import { randomUUID } from 'node:crypto'
import { requirePayoutAmountLuna, requirePayoutNetwork, type PayoutExecutionConfig } from './config.ts'
import { PayoutError } from './errors.ts'
import { createPayoutService } from './service.ts'
import type { PayoutStore, RewardPayout, TreasuryAdapter } from './types.ts'

export type PayoutWorkerReport = {
  readonly network: 'testnet' | 'mainnet'
  readonly created: number
  readonly executed: number
  readonly submitted: number
  readonly confirmed: number
  readonly failedRetryable: number
  readonly failedFinal: number
  readonly recovered: number
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
  readonly createLimit?: number
  readonly executeLimit?: number
  readonly reconcileLimit?: number
}): Promise<PayoutWorkerReport> {
  const network = requirePayoutNetwork(options.config)
  requirePayoutAmountLuna(options.config)
  if (network === 'mainnet' || options.config.network === 'mainnet') {
    throw new PayoutError('PAYOUT_MAINNET_DISABLED')
  }
  const service = createPayoutService({
    store: options.store,
    treasury: options.treasury,
    config: options.config,
  })

  const unpaid = await options.store.listUnpaidReservedClaims(options.createLimit ?? 69)
  let created = 0
  for (const claim of unpaid) {
    await service.ensureForReservedClaim(claim.claimId)
    created += 1
  }

  const executeLimit = options.executeLimit ?? 69
  let executed = 0
  let submitted = 0
  let failedRetryable = 0
  let failedFinal = 0
  for (let index = 0; index < executeLimit; index += 1) {
    const result = await service.executeNext()
    if (!result) break
    executed += 1
    countStatus(result)
  }

  const stale = await options.store.listByStatus('PROCESSING', options.reconcileLimit ?? 69)
  let recovered = 0
  for (const payout of stale) {
    if (payout.txHash) continue
    const result = await service.recoverAmbiguous(payout)
    recovered += 1
    countStatus(result)
  }

  const submittedRows = await options.store.listByStatus('SUBMITTED', options.reconcileLimit ?? 69)
  let confirmed = 0
  for (const payout of submittedRows) {
    const result = await service.reconcile(payout)
    if (result) countStatus(result)
  }

  return {
    network,
    created,
    executed,
    submitted,
    confirmed,
    failedRetryable,
    failedFinal,
    recovered,
  }

  function countStatus(payout: RewardPayout): void {
    if (payout.status === 'SUBMITTED') submitted += 1
    if (payout.status === 'FAILED_RETRYABLE') failedRetryable += 1
    if (payout.status === 'FAILED_FINAL') failedFinal += 1
    if (payout.status === 'CONFIRMED') confirmed += 1
  }
}
