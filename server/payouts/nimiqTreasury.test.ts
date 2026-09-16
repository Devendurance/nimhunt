import { KeyPair, Transaction, TransactionBuilder } from '@nimiq/core'
import { describe, expect, it } from 'vitest'
import { networkIdFor, payoutExtraData } from './intent.ts'
import { createNimiqTreasury, keyPairFromSecret } from './nimiqTreasury.ts'
import { NIMIQ_MAINNET_NETWORK_ID, NIMIQ_TESTNET_NETWORK_ID } from './types.ts'

describe('nimiq treasury adapter isolation', () => {
  it('signs the exact recipient, luna amount, network, and payout id without broadcasting', async () => {
    const secret = KeyPair.generate()
    const recipient = KeyPair.generate().toAddress().toUserFriendlyAddress()
    const treasury = createNimiqTreasury({
      network: 'testnet',
      secret: { kind: 'hex', value: secret.privateKey.toHex() },
      connect: false,
    })
    const payoutId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    const intent = await treasury.signTransfer({
      payoutId,
      recipient,
      amountLuna: 100_000n,
      network: 'testnet',
    })
    expect(intent.sender).toBe(secret.toAddress().toUserFriendlyAddress())
    expect(intent.recipient).toBe(recipient)
    expect(intent.amountLuna).toBe(100_000n)
    expect(intent.network).toBe('testnet')
    expect(intent.networkId).toBe(NIMIQ_TESTNET_NETWORK_ID)
    expect(intent.networkId).not.toBe(NIMIQ_MAINNET_NETWORK_ID)
    expect(Buffer.from(intent.extraData).toString()).toBe(`NIMHUNT_PAYOUT:${payoutId}`)

    const parsed = Transaction.fromAny(intent.serializedHex)
    expect(parsed.recipient.toUserFriendlyAddress()).toBe(recipient)
    expect(parsed.value).toBe(100_000n)
    expect(parsed.networkId).toBe(networkIdFor('testnet'))
    expect(Buffer.from(parsed.data)).toEqual(Buffer.from(payoutExtraData(payoutId)))
  })

  it('loads a hex secret without exposing it on the adapter', () => {
    const secret = KeyPair.generate()
    const keyPair = keyPairFromSecret({ kind: 'hex', value: secret.privateKey.toHex() })
    expect(keyPair.toAddress().toUserFriendlyAddress()).toBe(secret.toAddress().toUserFriendlyAddress())
    const adapter = createNimiqTreasury({
      network: 'testnet',
      secret: { kind: 'hex', value: secret.privateKey.toHex() },
      connect: false,
    })
    expect(JSON.stringify(adapter)).not.toContain(secret.privateKey.toHex())
  })

  it('signs a basic mainnet transfer without payout extra data and without broadcasting', async () => {
    const secret = KeyPair.generate()
    const recipient = KeyPair.generate().toAddress().toUserFriendlyAddress()
    const treasury = createNimiqTreasury({
      network: 'mainnet',
      secret: { kind: 'hex', value: secret.privateKey.toHex() },
      connect: false,
    })
    const intent = await treasury.signBasicTransfer({
      recipient,
      amountLuna: 10_000_000n,
    })
    expect(intent.sender).toBe(secret.toAddress().toUserFriendlyAddress())
    expect(intent.recipient).toBe(recipient)
    expect(intent.amountLuna).toBe(10_000_000n)
    expect(intent.feeLuna).toBe(0n)
    expect(intent.network).toBe('mainnet')
    expect(intent.networkId).toBe(NIMIQ_MAINNET_NETWORK_ID)

    const parsed = Transaction.fromAny(intent.serializedHex)
    expect(parsed.recipient.toUserFriendlyAddress()).toBe(recipient)
    expect(parsed.value).toBe(10_000_000n)
    expect(parsed.fee).toBe(0n)
    expect(parsed.networkId).toBe(NIMIQ_MAINNET_NETWORK_ID)
    expect(parsed.data.length).toBe(0)
    expect(JSON.stringify(intent, (_key, value) => typeof value === 'bigint' ? value.toString() : value)).not.toContain(secret.privateKey.toHex())
  })

  it('builds a basic-with-data transaction for the configured network id', () => {
    const sender = KeyPair.generate()
    const recipient = KeyPair.generate().toAddress()
    const tx = TransactionBuilder.newBasicWithData(
      sender.toAddress(),
      recipient,
      payoutExtraData('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'),
      42n,
      0n,
      1,
      NIMIQ_TESTNET_NETWORK_ID,
    )
    tx.sign(sender, undefined)
    expect(tx.value).toBe(42n)
    expect(tx.networkId).toBe(5)
  })
})
