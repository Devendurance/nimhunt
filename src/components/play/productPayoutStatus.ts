import type { RewardPayoutNetwork, RewardPayoutStatus } from '../../domain/expeditionProof.ts'
import { shortenProofHash } from './productVaultSeal.ts'

export const LUNA_PER_NIM = 100_000n
export const PAYOUT_POLL_MS = 8_000

export type ProductPayoutView = {
  readonly status: RewardPayoutStatus | 'PENDING'
  readonly payoutId: string | null
  readonly claimId: string | null
  readonly amountLuna: string | null
  readonly network: RewardPayoutNetwork | null
  readonly txHashSafe: string | null
  readonly submittedAt: string | null
  readonly confirmedAt: string | null
}

export type ProductPayoutCopy = {
  readonly title: string
  readonly lines: readonly string[]
  readonly amountLabel: string | null
  readonly txHashShort: string | null
  readonly verified: boolean
}

export function formatNimFromLuna(luna: string | bigint): string {
  const value = typeof luna === 'bigint' ? luna : BigInt(luna)
  const whole = value / LUNA_PER_NIM
  const fraction = value % LUNA_PER_NIM
  if (fraction === 0n) return `${whole.toString()} NIM`
  return `${whole.toString()}.${fraction.toString().padStart(5, '0').replace(/0+$/, '')} NIM`
}

export function payoutStatusCopy(view: ProductPayoutView | null): ProductPayoutCopy {
  const status = view?.status ?? 'PENDING'
  const txHashShort = view?.txHashSafe ? shortenProofHash(view.txHashSafe) : null
  if (status === 'CONFIRMED') {
    return {
      title: 'TREASURE DELIVERED',
      lines: ['Your NIM reward was confirmed on-chain.'],
      amountLabel: view?.amountLuna ? formatNimFromLuna(view.amountLuna) : null,
      txHashShort,
      verified: true,
    }
  }
  if (status === 'SUBMITTED') {
    return {
      title: 'PAYOUT SUBMITTED',
      lines: ['Your NIM reward was submitted to the network.'],
      amountLabel: null,
      txHashShort,
      verified: false,
    }
  }
  if (status === 'FAILED_RETRYABLE') {
    return {
      title: 'TREASURE RESERVED',
      lines: ['Your reservation is safe. Payout is being retried safely.'],
      amountLabel: null,
      txHashShort: null,
      verified: false,
    }
  }
  if (status === 'FAILED_FINAL') {
    return {
      title: 'TREASURE RESERVED',
      lines: ['Your reservation is safe. Payout needs review.'],
      amountLabel: null,
      txHashShort: null,
      verified: false,
    }
  }
  return {
    title: 'TREASURE RESERVED',
    lines: ['Your treasure is reserved and waiting for payout.'],
    amountLabel: null,
    txHashShort: null,
    verified: false,
  }
}
