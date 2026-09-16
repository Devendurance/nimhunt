export const PAYOUT_NETWORKS = ['testnet', 'mainnet'] as const
export type PayoutNetwork = (typeof PAYOUT_NETWORKS)[number]

export const PAYOUT_STATUSES = [
  'PENDING',
  'PROCESSING',
  'SUBMITTED',
  'CONFIRMED',
  'FAILED_RETRYABLE',
  'FAILED_FINAL',
] as const
export type PayoutStatus = (typeof PAYOUT_STATUSES)[number]

export const LUNA_PER_NIM = 100_000n
export const PAYOUT_DATA_PREFIX = 'NIMHUNT_PAYOUT:'
export const NIMIQ_TESTNET_NETWORK_ID = 5
export const NIMIQ_MAINNET_NETWORK_ID = 24

export type RewardPayout = {
  readonly payoutId: string
  readonly claimId: string
  readonly runId: string
  readonly wallet: string
  readonly dayKey: string
  readonly amountLuna: bigint
  readonly network: PayoutNetwork
  readonly status: PayoutStatus
  readonly attemptCount: number
  readonly txHash: string | null
  readonly failureCode: string | null
  readonly failureMessageSafe: string | null
  readonly createdAt: string
  readonly processingStartedAt: string | null
  readonly submittedAt: string | null
  readonly confirmedAt: string | null
  readonly updatedAt: string
}

export type PublicRewardPayout = {
  readonly payoutId: string
  readonly claimId: string
  readonly status: PayoutStatus
  readonly amountLuna: string
  readonly network: PayoutNetwork
  readonly txHashSafe: string | null
  readonly submittedAt: string | null
  readonly confirmedAt: string | null
}

export type UnpaidReservedClaim = {
  readonly claimId: string
  readonly runId: string
  readonly wallet: string
  readonly dayKey: string
}

export type SignedPayoutIntent = {
  readonly payoutId: string
  readonly sender: string
  readonly recipient: string
  readonly amountLuna: bigint
  readonly feeLuna: bigint
  readonly network: PayoutNetwork
  readonly networkId: number
  readonly validityStartHeight: number
  readonly extraData: Uint8Array
  readonly txHash: string
  readonly serializedHex: string
}

export type TreasuryTransactionStatus =
  | 'pending'
  | 'included'
  | 'confirmed'
  | 'invalidated'
  | 'expired'
  | 'unknown'

export type TreasuryTransaction = {
  readonly txHash: string
  readonly sender: string
  readonly recipient: string
  readonly amountLuna: bigint
  readonly network: PayoutNetwork
  readonly extraData: string | null
  readonly status: TreasuryTransactionStatus
  readonly confirmations: number | null
}

export type TreasurySubmitInput = {
  readonly payoutId: string
  readonly recipient: string
  readonly amountLuna: bigint
  readonly network: PayoutNetwork
}

export type TreasuryAdapter = {
  readonly network: PayoutNetwork
  address(): string
  getBalance(): Promise<bigint>
  signTransfer(input: TreasurySubmitInput): Promise<SignedPayoutIntent>
  submitSigned(intent: SignedPayoutIntent): Promise<{ readonly txHash: string }>
  getTransaction(txHash: string): Promise<TreasuryTransaction | null>
  findPayoutTransfer(payoutId: string): Promise<TreasuryTransaction | null>
}

export type PayoutStore = {
  create(input: {
    readonly claimId: string
    readonly payoutId: string
    readonly amountLuna: bigint
    readonly network: PayoutNetwork
  }): Promise<{ readonly payout: RewardPayout; readonly existing: boolean }>
  acquire(): Promise<RewardPayout | null>
  markSubmitted(payoutId: string, txHash: string): Promise<RewardPayout>
  markConfirmed(payoutId: string, txHash: string): Promise<RewardPayout>
  markFailed(input: {
    readonly payoutId: string
    readonly status: 'FAILED_RETRYABLE' | 'FAILED_FINAL'
    readonly failureCode: string
    readonly failureMessageSafe: string
  }): Promise<RewardPayout>
  get(payoutId: string): Promise<RewardPayout>
  getByClaim(claimId: string): Promise<RewardPayout | null>
  getPublicForSession(claimId: string, sessionHash: string): Promise<{
    readonly claimId: string
    readonly payout: PublicRewardPayout | null
  }>
  listUnpaidReservedClaims(limit: number): Promise<readonly UnpaidReservedClaim[]>
  listByStatus(status: PayoutStatus, limit: number): Promise<readonly RewardPayout[]>
}
