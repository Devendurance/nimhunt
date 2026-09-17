import {
  Address,
  Client,
  ClientConfiguration,
  KeyPair,
  MnemonicUtils,
  PrivateKey,
  TransactionBuilder,
  type PlainTransactionDetails,
} from '@nimiq/core'
import { PayoutError } from './errors.js'
import type { TreasurySecret } from './config.js'
import {
  decodePayoutExtraData,
  networkIdFor,
  normalizeNimiqAddress,
  parseTxHash,
  payoutExtraData,
  requireNimiqAddress,
} from './intent.js'
import type {
  PayoutNetwork,
  TreasuryAdapter,
  TreasuryTransaction,
  TreasuryTransactionStatus,
} from './types.js'

export type NimiqTreasuryOptions = {
  readonly network: PayoutNetwork
  readonly secret: TreasurySecret
  readonly connect?: boolean
}

export type SignedBasicTransfer = {
  readonly sender: string
  readonly recipient: string
  readonly amountLuna: bigint
  readonly feeLuna: bigint
  readonly network: PayoutNetwork
  readonly networkId: number
  readonly validityStartHeight: number
  readonly txHash: string
  readonly serializedHex: string
}

export type NimiqTreasury = TreasuryAdapter & {
  signBasicTransfer(input: {
    readonly recipient: string
    readonly amountLuna: bigint
  }): Promise<SignedBasicTransfer>
  submitBasic(intent: SignedBasicTransfer): Promise<{ readonly txHash: string }>
}

export function createNimiqTreasury(options: NimiqTreasuryOptions): NimiqTreasury {
  const keyPair = keyPairFromSecret(options.secret)
  const address = keyPair.toAddress().toUserFriendlyAddress()
  const networkId = networkIdFor(options.network)
  let clientPromise: Promise<Client> | null = null

  async function client(): Promise<Client> {
    if (!clientPromise) clientPromise = connectClient(options.network)
    return clientPromise
  }

  return {
    network: options.network,
    address: () => address,
    async getBalance() {
      const connected = await client()
      const account = await connected.getAccount(address)
      return BigInt(account.balance)
    },
    async signTransfer(input) {
      assertSameNetwork(input.network, options.network)
      const connected = options.connect === false ? null : await client()
      const liveNetworkId = connected ? await connected.getNetworkId() : networkId
      if (liveNetworkId !== networkId) throw new PayoutError('PAYOUT_NETWORK_INVALID')
      const height = connected ? await connected.getHeadHeight() : 1
      const extraData = payoutExtraData(input.payoutId)
      const tx = TransactionBuilder.newBasicWithData(
        keyPair.toAddress(),
        requireNimiqAddress(input.recipient),
        extraData,
        input.amountLuna,
        0n,
        height,
        networkId,
      )
      tx.sign(keyPair, undefined)
      return {
        payoutId: input.payoutId,
        sender: address,
        recipient: normalizeNimiqAddress(input.recipient),
        amountLuna: input.amountLuna,
        feeLuna: tx.fee,
        network: options.network,
        networkId,
        validityStartHeight: tx.validityStartHeight,
        extraData,
        txHash: parseTxHash(tx.hash()),
        serializedHex: tx.toHex(),
      }
    },
    async submitSigned(intent) {
      assertSameNetwork(intent.network, options.network)
      if (intent.sender !== address) throw new PayoutError('WALLET_MISMATCH')
      if (intent.networkId !== networkId) throw new PayoutError('PAYOUT_NETWORK_INVALID')
      const connected = await client()
      const details = await connected.sendTransaction(intent.serializedHex)
      return { txHash: parseTxHash(details.transactionHash) }
    },
    async getTransaction(txHash) {
      const connected = await client()
      try {
        return toTreasuryTransaction(await connected.getTransaction(parseTxHash(txHash)), options.network)
      } catch {
        return null
      }
    },
    async findPayoutTransfer(payoutId) {
      const connected = await client()
      const history = await connected.getTransactionsByAddress(address, 0, undefined, undefined, 50)
      for (const details of history) {
        const mapped = toTreasuryTransaction(details, options.network)
        if (mapped.extraData === payoutId) return mapped
      }
      return null
    },
    async signBasicTransfer(input) {
      if (input.amountLuna <= 0n) throw new PayoutError('PAYOUT_AMOUNT_INVALID')
      const connected = options.connect === false ? null : await client()
      const liveNetworkId = connected ? await connected.getNetworkId() : networkId
      if (liveNetworkId !== networkId) throw new PayoutError('PAYOUT_NETWORK_INVALID')
      const height = connected ? await connected.getHeadHeight() : 1
      const tx = TransactionBuilder.newBasic(
        keyPair.toAddress(),
        requireNimiqAddress(input.recipient),
        input.amountLuna,
        0n,
        height,
        networkId,
      )
      tx.sign(keyPair, undefined)
      return {
        sender: address,
        recipient: normalizeNimiqAddress(input.recipient),
        amountLuna: input.amountLuna,
        feeLuna: tx.fee,
        network: options.network,
        networkId,
        validityStartHeight: tx.validityStartHeight,
        txHash: parseTxHash(tx.hash()),
        serializedHex: tx.toHex(),
      }
    },
    async submitBasic(intent) {
      assertSameNetwork(intent.network, options.network)
      if (intent.sender !== address) throw new PayoutError('WALLET_MISMATCH')
      if (intent.networkId !== networkId) throw new PayoutError('PAYOUT_NETWORK_INVALID')
      const connected = await client()
      const details = await connected.sendTransaction(intent.serializedHex)
      return { txHash: parseTxHash(details.transactionHash) }
    },
  }
}

export function keyPairFromSecret(secret: TreasurySecret): KeyPair {
  if (secret.kind === 'hex') {
    const hex = secret.value.startsWith('0x') || secret.value.startsWith('0X') ? secret.value.slice(2) : secret.value
    if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new PayoutError('PAYOUT_TREASURY_UNAVAILABLE')
    return KeyPair.derive(PrivateKey.fromHex(hex))
  }
  try {
    return KeyPair.derive(MnemonicUtils.mnemonicToExtendedPrivateKey(secret.value).privateKey)
  } catch {
    throw new PayoutError('PAYOUT_TREASURY_UNAVAILABLE')
  }
}

async function connectClient(network: PayoutNetwork): Promise<Client> {
  const config = new ClientConfiguration()
  config.network(network === 'mainnet' ? 'MainAlbatross' : 'TestAlbatross')
  const client = await Client.create(config.build())
  await client.waitForConsensusEstablished()
  const networkId = await client.getNetworkId()
  if (networkId !== networkIdFor(network)) throw new PayoutError('PAYOUT_NETWORK_INVALID')
  return client
}

function assertSameNetwork(actual: PayoutNetwork, expected: PayoutNetwork): void {
  if (actual !== expected) throw new PayoutError('PAYOUT_NETWORK_INVALID')
}

function toTreasuryTransaction(details: PlainTransactionDetails, network: PayoutNetwork): TreasuryTransaction {
  const extra = details.data && 'raw' in details.data ? decodePayoutExtraData(details.data.raw) : null
  return {
    txHash: parseTxHash(details.transactionHash),
    sender: Address.fromString(details.sender).toUserFriendlyAddress(),
    recipient: Address.fromString(details.recipient).toUserFriendlyAddress(),
    amountLuna: BigInt(details.value),
    network,
    extraData: extra,
    status: toStatus(details.state),
    confirmations: details.confirmations ?? null,
  }
}

function toStatus(state: PlainTransactionDetails['state']): TreasuryTransactionStatus {
  if (state === 'confirmed') return 'confirmed'
  if (state === 'included') return 'included'
  if (state === 'pending' || state === 'new') return 'pending'
  if (state === 'invalidated') return 'invalidated'
  if (state === 'expired') return 'expired'
  return 'unknown'
}
