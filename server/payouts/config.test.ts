import { describe, expect, it } from 'vitest'
import {
  formatNimFromLuna,
  readPayoutExecutionConfig,
  readTreasurySecret,
  requirePayoutAmountLuna,
  requirePayoutNetwork,
} from './config.ts'
import { PayoutError } from './errors.ts'

describe('payout execution config', () => {
  it('requires an explicit network and never infers mainnet', () => {
    expect(() => readPayoutExecutionConfig({})).toThrow(PayoutError)
    expect(() => readPayoutExecutionConfig({ NIMHUNT_PAYOUT_NETWORK: 'mainnet' })).not.toThrow()
    expect(readPayoutExecutionConfig({ NIMHUNT_PAYOUT_NETWORK: 'testnet' })).toMatchObject({
      network: 'testnet',
      mainnetEnabled: false,
      amountLuna: null,
    })
  })

  it('fails closed for mainnet without the deliberate enable flag', () => {
    const config = readPayoutExecutionConfig({
      NIMHUNT_PAYOUT_NETWORK: 'mainnet',
      NIMHUNT_ENABLE_MAINNET_PAYOUT: 'false',
    })
    expect(() => requirePayoutNetwork(config)).toThrowError(/PAYOUT_MAINNET_DISABLED/)
    expect(() => requirePayoutNetwork(readPayoutExecutionConfig({
      NIMHUNT_PAYOUT_NETWORK: 'mainnet',
      NIMHUNT_ENABLE_MAINNET_PAYOUT: 'true',
    }))).not.toThrow()
  })

  it('keeps the reward amount unconfigured until an integer luna value is set', () => {
    const config = readPayoutExecutionConfig({ NIMHUNT_PAYOUT_NETWORK: 'testnet' })
    expect(() => requirePayoutAmountLuna(config)).toThrowError(/PAYOUT_AMOUNT_UNCONFIGURED/)
    expect(readPayoutExecutionConfig({
      NIMHUNT_PAYOUT_NETWORK: 'testnet',
      NIMHUNT_REWARD_AMOUNT_LUNA: '100000',
    }).amountLuna).toBe(100000n)
    expect(() => readPayoutExecutionConfig({
      NIMHUNT_PAYOUT_NETWORK: 'testnet',
      NIMHUNT_REWARD_AMOUNT_LUNA: '1.5',
    })).toThrowError(/PAYOUT_AMOUNT_INVALID/)
  })

  it('rejects browser-prefixed treasury secrets and formats NIM without floats', () => {
    expect(() => readTreasurySecret({ VITE_NIMHUNT_TREASURY_PRIVATE_KEY: 'ab'.repeat(32) })).toThrowError(/PAYOUT_TREASURY_UNAVAILABLE/)
    expect(readTreasurySecret({ NIMHUNT_TREASURY_PRIVATE_KEY: 'ab'.repeat(32) })).toEqual({
      kind: 'hex',
      value: 'ab'.repeat(32),
    })
    expect(formatNimFromLuna(100000n)).toBe('1.00000')
    expect(formatNimFromLuna(1n)).toBe('0.00001')
  })
})
