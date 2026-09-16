import { KeyPair } from '@nimiq/core'
import { describe, expect, it } from 'vitest'
import { loadEnv } from 'vite'
import { formatNimFromLuna, readPayoutExecutionConfig, readTreasurySecret } from './config.ts'
import { createNimiqTreasury } from './nimiqTreasury.ts'

const env = { ...loadEnv('test', process.cwd(), ''), ...process.env }
const enabled = env.NIMHUNT_PAYOUT_TESTNET === '1'

describe.skipIf(!enabled)('nimiq testnet payout', () => {
  it('connects a dedicated test treasury and reports funding if a live send is not possible', async () => {
    const config = readPayoutExecutionConfig(env)
    expect(config.network).toBe('testnet')
    expect(config.mainnetEnabled).toBe(false)
    const secret = readTreasurySecret(env)
    expect(secret).not.toBeNull()
    const treasury = createNimiqTreasury({ network: 'testnet', secret: secret! })
    const address = treasury.address()
    const balance = await treasury.getBalance()
    const recipient = KeyPair.generate().toAddress().toUserFriendlyAddress()
    const amount = config.amountLuna
    expect(address.startsWith('NQ')).toBe(true)
    if (!amount || balance < amount) {
      console.info([
        'TESTNET_FAUCET_REQUIRED',
        `treasury=${address}`,
        `balanceLuna=${balance.toString()}`,
        `balanceNim=${formatNimFromLuna(balance)}`,
        `requiredLuna=${amount?.toString() ?? 'UNCONFIGURED'}`,
        'Fund this testnet treasury in Nimiq Pay: long-press Settings 10s, switch to Testnet, then Get free NIM.',
      ].join('\n'))
      expect(amount, 'NIMHUNT_REWARD_AMOUNT_LUNA must be set for a live testnet send').toBeTruthy()
      return
    }
    const payoutId = 'ffffffff-ffff-ffff-ffff-ffffffffffff'
    const intent = await treasury.signTransfer({
      payoutId,
      recipient,
      amountLuna: amount,
      network: 'testnet',
    })
    expect(intent.recipient).toBe(recipient)
    expect(intent.amountLuna).toBe(amount)
    expect(intent.network).toBe('testnet')
    const submitted = await treasury.submitSigned(intent)
    expect(submitted.txHash).toMatch(/^[0-9a-f]{64}$/)
    let status = await treasury.getTransaction(submitted.txHash)
    const deadline = Date.now() + 120_000
    while (Date.now() < deadline && status && status.status !== 'confirmed' && status.status !== 'invalidated' && status.status !== 'expired') {
      await new Promise(resolve => setTimeout(resolve, 4_000))
      status = await treasury.getTransaction(submitted.txHash)
    }
    expect(status?.recipient).toBe(recipient)
    expect(status?.amountLuna).toBe(amount)
    expect(status?.status).toBe('confirmed')
  }, 180_000)
})
