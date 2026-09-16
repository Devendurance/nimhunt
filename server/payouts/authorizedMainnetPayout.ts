import { requirePayoutAmountLuna, requirePayoutNetwork, type PayoutExecutionConfig } from './config.ts'
import { PayoutError } from './errors.ts'
import { normalizeNimiqAddress } from './intent.ts'
import { createPayoutService } from './service.ts'
import type { PayoutStore, RewardPayout, TreasuryAdapter } from './types.ts'

export const AUTHORIZED_MAINNET_PAYOUT = {
  payoutId: 'd19bf406-2b81-4c5a-b271-da8eb7587cbd',
  recipient: 'NQ21 8BQV KD0Y JBPY 7HXB JPY5 XBVG QSS8 6GEB',
  treasury: 'NQ24 QF30 SB2B 1BPT 8GN2 NF3Y YU0M QLL3 EERH',
  amountLuna: 10_000n,
  network: 'mainnet' as const,
}

export const AUTHORIZED_MAINNET_FEE_LUNA = 0n

export type AuthorizedMainnetGate = {
  readonly ok: boolean
  readonly failures: readonly string[]
}

export function evaluateAuthorizedMainnetBroadcastGate(input: {
  readonly payout: RewardPayout
  readonly claimStatus: string
  readonly claimWallet: string
  readonly treasuryAddress: string
  readonly treasuryBalanceLuna: bigint | null
  readonly mainnetEnabled: boolean
  readonly eligiblePayoutIds: readonly string[]
}): AuthorizedMainnetGate {
  const failures: string[] = []
  const expectedRecipient = normalizeNimiqAddress(AUTHORIZED_MAINNET_PAYOUT.recipient)
  const expectedTreasury = normalizeNimiqAddress(AUTHORIZED_MAINNET_PAYOUT.treasury)
  if (input.payout.payoutId !== AUTHORIZED_MAINNET_PAYOUT.payoutId) failures.push('payout_id')
  if (input.payout.status !== 'PENDING') failures.push('status')
  if (input.payout.attemptCount !== 0) failures.push('attempt_count')
  if (input.payout.txHash) failures.push('tx_hash')
  if (input.claimStatus !== 'RESERVED') failures.push('claim_status')
  if (normalizeNimiqAddress(input.payout.wallet) !== expectedRecipient) failures.push('payout_wallet')
  if (normalizeNimiqAddress(input.claimWallet) !== expectedRecipient) failures.push('claim_wallet')
  if (input.payout.amountLuna !== AUTHORIZED_MAINNET_PAYOUT.amountLuna) failures.push('amount_luna')
  if (input.payout.network !== AUTHORIZED_MAINNET_PAYOUT.network) failures.push('network')
  if (normalizeNimiqAddress(input.treasuryAddress) !== expectedTreasury) failures.push('treasury_address')
  if (!input.mainnetEnabled) failures.push('mainnet_enabled')
  if (input.treasuryBalanceLuna == null) failures.push('treasury_balance')
  else if (input.treasuryBalanceLuna < AUTHORIZED_MAINNET_PAYOUT.amountLuna + AUTHORIZED_MAINNET_FEE_LUNA) {
    failures.push('treasury_balance_insufficient')
  }
  if (
    input.eligiblePayoutIds.length !== 1
    || input.eligiblePayoutIds[0] !== AUTHORIZED_MAINNET_PAYOUT.payoutId
  ) {
    failures.push('eligible_payouts')
  }
  return { ok: failures.length === 0, failures }
}

export async function runAuthorizedMainnetPayoutOnce(options: {
  readonly store: PayoutStore
  readonly treasury: TreasuryAdapter
  readonly config: PayoutExecutionConfig
  readonly claimStatus: string
  readonly claimWallet: string
  readonly treasuryBalanceLuna: bigint
  readonly waitForConfirmation?: (payout: RewardPayout) => Promise<RewardPayout>
}): Promise<{
  readonly action: 'broadcast' | 'reconcile-only' | 'recover-only' | 'stopped'
  readonly sent: boolean
  readonly gate: AuthorizedMainnetGate
  readonly payout: RewardPayout
}> {
  const network = requirePayoutNetwork(options.config)
  requirePayoutAmountLuna(options.config)
  if (network !== 'mainnet' || options.config.amountLuna !== AUTHORIZED_MAINNET_PAYOUT.amountLuna) {
    throw new PayoutError('PAYOUT_NETWORK_INVALID')
  }
  if (options.treasury.network !== 'mainnet') throw new PayoutError('PAYOUT_NETWORK_INVALID')
  if (normalizeNimiqAddress(options.treasury.address()) !== normalizeNimiqAddress(AUTHORIZED_MAINNET_PAYOUT.treasury)) {
    throw new PayoutError('WALLET_MISMATCH')
  }

  const payout = await options.store.get(AUTHORIZED_MAINNET_PAYOUT.payoutId)
  const service = createPayoutService({
    store: options.store,
    treasury: options.treasury,
    config: options.config,
  })

  if (payout.status === 'CONFIRMED') {
    return {
      action: 'reconcile-only',
      sent: false,
      gate: { ok: false, failures: ['already_submitted'] },
      payout,
    }
  }
  if (payout.status === 'SUBMITTED') {
    const reconciled = await service.reconcile(payout) ?? payout
    return {
      action: 'reconcile-only',
      sent: false,
      gate: { ok: false, failures: ['already_submitted'] },
      payout: reconciled,
    }
  }
  if (payout.status === 'PROCESSING' && payout.txHash) {
    const submitted = await options.store.markSubmitted(payout.payoutId, payout.txHash)
    const reconciled = await service.reconcile(submitted) ?? submitted
    return {
      action: 'reconcile-only',
      sent: false,
      gate: { ok: false, failures: ['already_submitted'] },
      payout: reconciled,
    }
  }
  if (payout.status === 'PROCESSING' && !payout.txHash) {
    const recovered = await service.recoverAmbiguous(payout)
    return {
      action: 'recover-only',
      sent: false,
      gate: { ok: false, failures: ['ambiguous_processing'] },
      payout: recovered,
    }
  }

  const eligible = [
    ...(await options.store.listByStatus('PENDING', 69)),
    ...(await options.store.listByStatus('FAILED_RETRYABLE', 69)),
  ]
  const gate = evaluateAuthorizedMainnetBroadcastGate({
    payout,
    claimStatus: options.claimStatus,
    claimWallet: options.claimWallet,
    treasuryAddress: options.treasury.address(),
    treasuryBalanceLuna: options.treasuryBalanceLuna,
    mainnetEnabled: options.config.mainnetEnabled,
    eligiblePayoutIds: eligible.map(row => row.payoutId),
  })
  if (!gate.ok) {
    return { action: 'stopped', sent: false, gate, payout }
  }

  const executed = await service.executeNext()
  if (!executed || executed.payoutId !== AUTHORIZED_MAINNET_PAYOUT.payoutId) {
    throw new PayoutError('PAYOUT_STATUS_INVALID')
  }
  const confirmed = options.waitForConfirmation
    ? await options.waitForConfirmation(executed)
    : await service.reconcile(executed) ?? executed
  return { action: 'broadcast', sent: executed.status === 'SUBMITTED' || executed.status === 'CONFIRMED', gate, payout: confirmed }
}
