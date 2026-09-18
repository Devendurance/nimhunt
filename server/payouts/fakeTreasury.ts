import { createHash, randomBytes } from 'node:crypto'
import { PayoutError } from './errors.js'
import { networkIdFor, normalizeNimiqAddress, parseTxHash, payoutExtraData } from './intent.js'
import type {
  PayoutNetwork,
  SignedPayoutIntent,
  TreasuryAdapter,
  TreasurySubmitInput,
  TreasuryTransaction,
} from './types.js'

export type FakeTreasuryOptions = {
  readonly network?: PayoutNetwork
  readonly address?: string
  readonly balance?: bigint
  readonly submitMode?: 'broadcast' | 'crash-after-broadcast' | 'reject-before-broadcast'
  readonly confirmationStatus?: TreasuryTransaction['status']
}

export type FakeTreasury = TreasuryAdapter & {
  readonly submitted: SignedPayoutIntent[]
  setBalance(balance: bigint): void
  setSubmitMode(mode: NonNullable<FakeTreasuryOptions['submitMode']>): void
  setTransactionStatus(txHash: string, status: TreasuryTransaction['status']): void
  seedTransaction(transaction: TreasuryTransaction): void
}

export function createFakeTreasury(options: FakeTreasuryOptions = {}): FakeTreasury {
  const network = options.network ?? 'testnet'
  const address = options.address ?? 'NQ07 0000 0000 0000 0000 0000 0000 0000 0000'
  let balance = options.balance ?? 1_000_000n
  let submitMode = options.submitMode ?? 'broadcast'
  const submitted: SignedPayoutIntent[] = []
  const transactions = new Map<string, TreasuryTransaction>()

  const adapter: FakeTreasury = {
    network,
    submitted,
    address: () => address,
    setBalance(next) {
      balance = next
    },
    setSubmitMode(mode) {
      submitMode = mode
    },
    setTransactionStatus(txHash, status) {
      const current = transactions.get(txHash)
      if (!current) return
      transactions.set(txHash, { ...current, status, confirmations: status === 'confirmed' ? 1 : current.confirmations })
    },
    seedTransaction(transaction) {
      transactions.set(transaction.txHash, transaction)
    },
    async getBalance() {
      return balance
    },
    async signTransfer(input) {
      assertIntent(input, network)
      if (input.amountLuna > balance) throw new PayoutError('PAYOUT_TREASURY_UNAVAILABLE')
      const extraData = payoutExtraData(input.payoutId)
      const serializedHex = Buffer.from(JSON.stringify({
        payoutId: input.payoutId,
        sender: address,
        recipient: normalizeNimiqAddress(input.recipient),
        amountLuna: input.amountLuna.toString(),
        network,
      })).toString('hex')
      const txHash = createHash('sha256').update(`${input.payoutId}:${serializedHex}:${randomBytes(8).toString('hex')}`).digest('hex')
      return {
        payoutId: input.payoutId,
        sender: address,
        recipient: normalizeNimiqAddress(input.recipient),
        amountLuna: input.amountLuna,
        feeLuna: 0n,
        network,
        networkId: networkIdFor(network),
        validityStartHeight: 1,
        extraData,
        txHash,
        serializedHex,
      }
    },
    async submitSigned(intent) {
      if (intent.network !== network) throw new PayoutError('PAYOUT_NETWORK_INVALID')
      if (submitMode === 'reject-before-broadcast') throw new PayoutError('PAYOUT_TREASURY_UNAVAILABLE')
      const spend = intent.amountLuna + intent.feeLuna
      if (spend > balance) throw new PayoutError('PAYOUT_TREASURY_UNAVAILABLE')
      balance -= spend
      submitted.push(intent)
      const transaction: TreasuryTransaction = {
        txHash: parseTxHash(intent.txHash),
        sender: intent.sender,
        recipient: intent.recipient,
        amountLuna: intent.amountLuna,
        network: intent.network,
        extraData: intent.payoutId,
        status: options.confirmationStatus ?? 'confirmed',
        confirmations: 1,
      }
      transactions.set(transaction.txHash, transaction)
      if (submitMode === 'crash-after-broadcast') {
        const error = new Error('PAYOUT_CRASH_AFTER_BROADCAST')
        error.name = 'PayoutCrashAfterBroadcast'
        throw error
      }
      return { txHash: transaction.txHash }
    },
    async getTransaction(txHash) {
      return transactions.get(parseTxHash(txHash)) ?? null
    },
    async findPayoutTransfer(payoutId) {
      for (const transaction of transactions.values()) {
        if (transaction.extraData === payoutId) return transaction
      }
      return null
    },
  }
  return adapter
}

function assertIntent(input: TreasurySubmitInput, network: PayoutNetwork): void {
  if (input.network !== network) throw new PayoutError('PAYOUT_NETWORK_INVALID')
  if (input.amountLuna <= 0n) throw new PayoutError('PAYOUT_AMOUNT_INVALID')
  normalizeNimiqAddress(input.recipient)
}
