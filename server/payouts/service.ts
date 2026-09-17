import { randomUUID } from 'node:crypto'
import { requirePayoutAmountLuna, requirePayoutNetwork, type PayoutExecutionConfig } from './config.ts'
import { isPayoutError, PayoutError } from './errors.ts'
import { normalizeNimiqAddress } from './intent.ts'
import type {
  PayoutNetwork,
  PayoutStore,
  PublicRewardPayout,
  RewardPayout,
  TreasuryAdapter,
} from './types.ts'

export type PayoutService = {
  ensureForReservedClaim(claimId: string): Promise<RewardPayout>
  executeNext(): Promise<RewardPayout | null>
  executeAcquired(payout: RewardPayout): Promise<RewardPayout>
  reconcile(payout?: RewardPayout): Promise<RewardPayout | null>
  recoverAmbiguous(payout: RewardPayout): Promise<RewardPayout>
  getPublicStatus(claimId: string, sessionHash: string): Promise<{
    readonly claimId: string
    readonly payout: PublicRewardPayout | null
  }>
}

export function createPayoutService(options: {
  readonly store: PayoutStore
  readonly treasury: TreasuryAdapter
  readonly config: PayoutExecutionConfig
  readonly hooks?: {
    readonly onSigned?: () => void
    readonly onBroadcast?: () => void
  }
}): PayoutService {
  const network = requirePayoutNetwork(options.config)
  if (options.treasury.network !== network) throw new PayoutError('PAYOUT_NETWORK_INVALID')

  return {
    async ensureForReservedClaim(claimId) {
      const amountLuna = requirePayoutAmountLuna(options.config)
      const created = await options.store.create({
        claimId,
        payoutId: randomUUID(),
        amountLuna,
        network,
      })
      if (created.payout.network !== network) throw new PayoutError('PAYOUT_NETWORK_INVALID')
      return created.payout
    },

    async executeNext() {
      const acquired = await options.store.acquire()
      if (!acquired) return null
      return executeAcquired(acquired, options.store, options.treasury, network, options.hooks)
    },

    async executeAcquired(payout) {
      return executeAcquired(payout, options.store, options.treasury, network, options.hooks)
    },

    async reconcile(payout) {
      const current = payout ?? (await options.store.listByStatus('SUBMITTED', 1))[0] ?? null
      if (!current) return null
      return reconcileSubmitted(current, options.store, options.treasury)
    },

    async recoverAmbiguous(payout) {
      if (payout.status !== 'PROCESSING' || payout.txHash) {
        throw new PayoutError('PAYOUT_STATUS_INVALID')
      }
      const matched = await options.treasury.findPayoutTransfer(payout.payoutId)
      if (matched && isExactMatch(payout, matched, options.treasury.address())) {
        return options.store.markSubmitted(payout.payoutId, matched.txHash)
      }
      return options.store.markFailed({
        payoutId: payout.payoutId,
        status: 'FAILED_FINAL',
        failureCode: 'AMBIGUOUS_SUBMISSION',
        failureMessageSafe: 'Payout needs review before any retry.',
      })
    },

    getPublicStatus(claimId, sessionHash) {
      return options.store.getPublicForSession(claimId, sessionHash)
    },
  }
}

async function executeAcquired(
  payout: RewardPayout,
  store: PayoutStore,
  treasury: TreasuryAdapter,
  network: PayoutNetwork,
  hooks?: {
    readonly onSigned?: () => void
    readonly onBroadcast?: () => void
  },
): Promise<RewardPayout> {
  if (payout.network !== network) {
    return store.markFailed({
      payoutId: payout.payoutId,
      status: 'FAILED_FINAL',
      failureCode: 'PAYOUT_NETWORK_INVALID',
      failureMessageSafe: 'Payout needs review.',
    })
  }
  if (payout.txHash) {
    return store.markFailed({
      payoutId: payout.payoutId,
      status: 'FAILED_FINAL',
      failureCode: 'AMBIGUOUS_SUBMISSION',
      failureMessageSafe: 'Payout needs review before any retry.',
    })
  }

  const matched = await treasury.findPayoutTransfer(payout.payoutId)
  if (matched) {
    if (!isExactMatch(payout, matched, treasury.address())) {
      return store.markFailed({
        payoutId: payout.payoutId,
        status: 'FAILED_FINAL',
        failureCode: 'PAYOUT_TX_MISMATCH',
        failureMessageSafe: 'Payout needs review.',
      })
    }
    return store.markSubmitted(payout.payoutId, matched.txHash)
  }

  let intent
  try {
    intent = await treasury.signTransfer({
      payoutId: payout.payoutId,
      recipient: payout.wallet,
      amountLuna: payout.amountLuna,
      network: payout.network,
    })
    hooks?.onSigned?.()
  } catch (error) {
    return store.markFailed({
      payoutId: payout.payoutId,
      status: 'FAILED_RETRYABLE',
      failureCode: codeOf(error, 'PAYOUT_TREASURY_UNAVAILABLE'),
      failureMessageSafe: 'Payout is being retried safely.',
    })
  }

  if (!isExactIntent(payout, intent, treasury.address())) {
    return store.markFailed({
      payoutId: payout.payoutId,
      status: 'FAILED_FINAL',
      failureCode: 'PAYOUT_TX_MISMATCH',
      failureMessageSafe: 'Payout needs review.',
    })
  }

  let broadcasted = false
  try {
    const submitted = await treasury.submitSigned(intent)
    broadcasted = true
    hooks?.onBroadcast?.()
    return await store.markSubmitted(payout.payoutId, submitted.txHash)
  } catch (error) {
    if (error instanceof Error && error.name === 'PayoutCrashAfterBroadcast') {
      const recovered = await treasury.findPayoutTransfer(payout.payoutId)
      if (recovered && isExactMatch(payout, recovered, treasury.address())) {
        if (!broadcasted) hooks?.onBroadcast?.()
        return store.markSubmitted(payout.payoutId, recovered.txHash)
      }
      return store.markFailed({
        payoutId: payout.payoutId,
        status: 'FAILED_FINAL',
        failureCode: 'AMBIGUOUS_SUBMISSION',
        failureMessageSafe: 'Payout needs review before any retry.',
      })
    }
    const recovered = await treasury.findPayoutTransfer(payout.payoutId)
    if (recovered && isExactMatch(payout, recovered, treasury.address())) {
      if (!broadcasted) hooks?.onBroadcast?.()
      return store.markSubmitted(payout.payoutId, recovered.txHash)
    }
    return store.markFailed({
      payoutId: payout.payoutId,
      status: 'FAILED_RETRYABLE',
      failureCode: codeOf(error, 'PAYOUT_TREASURY_UNAVAILABLE'),
      failureMessageSafe: 'Payout is being retried safely.',
    })
  }
}

async function reconcileSubmitted(
  payout: RewardPayout,
  store: PayoutStore,
  treasury: TreasuryAdapter,
): Promise<RewardPayout> {
  if (payout.status !== 'SUBMITTED' || !payout.txHash) throw new PayoutError('PAYOUT_STATUS_INVALID')
  const transaction = await treasury.getTransaction(payout.txHash)
  if (!transaction) return payout
  if (!isExactMatch(payout, transaction, treasury.address())) {
    return store.markFailed({
      payoutId: payout.payoutId,
      status: 'FAILED_FINAL',
      failureCode: 'PAYOUT_TX_MISMATCH',
      failureMessageSafe: 'Payout needs review.',
    })
  }
  if (transaction.status === 'confirmed') {
    return store.markConfirmed(payout.payoutId, transaction.txHash)
  }
  if (transaction.status === 'invalidated' || transaction.status === 'expired') {
    return store.markFailed({
      payoutId: payout.payoutId,
      status: 'FAILED_FINAL',
      failureCode: 'AMBIGUOUS_SUBMISSION',
      failureMessageSafe: 'Payout needs review before any retry.',
    })
  }
  return payout
}

function isExactIntent(
  payout: RewardPayout,
  intent: {
    readonly sender: string
    readonly recipient: string
    readonly amountLuna: bigint
    readonly network: PayoutNetwork
    readonly payoutId: string
  },
  treasuryAddress: string,
): boolean {
  return intent.payoutId === payout.payoutId
    && intent.sender === treasuryAddress
    && normalizeNimiqAddress(intent.recipient) === normalizeNimiqAddress(payout.wallet)
    && intent.amountLuna === payout.amountLuna
    && intent.network === payout.network
}

function isExactMatch(
  payout: RewardPayout,
  transaction: {
    readonly sender: string
    readonly recipient: string
    readonly amountLuna: bigint
    readonly network: PayoutNetwork
    readonly extraData: string | null
    readonly txHash: string
  },
  treasuryAddress: string,
): boolean {
  return transaction.extraData === payout.payoutId
    && transaction.sender === treasuryAddress
    && normalizeNimiqAddress(transaction.recipient) === normalizeNimiqAddress(payout.wallet)
    && transaction.amountLuna === payout.amountLuna
    && transaction.network === payout.network
}

function codeOf(error: unknown, fallback: 'PAYOUT_TREASURY_UNAVAILABLE'): 'PAYOUT_TREASURY_UNAVAILABLE' | 'PAYOUT_NETWORK_INVALID' | 'PAYOUT_AMOUNT_INVALID' | 'WALLET_MISMATCH' {
  if (isPayoutError(error)
    && (error.code === 'PAYOUT_NETWORK_INVALID' || error.code === 'PAYOUT_AMOUNT_INVALID' || error.code === 'WALLET_MISMATCH' || error.code === 'PAYOUT_TREASURY_UNAVAILABLE')) {
    return error.code
  }
  return fallback
}
