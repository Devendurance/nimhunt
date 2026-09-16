import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { formatNimFromLuna } from './config.ts'
import { PayoutError } from './errors.ts'
import { generateTreasuryMnemonic } from './generateTreasury.ts'
import { createNimiqTreasury } from './nimiqTreasury.ts'
import {
  TREASURY_PREFLIGHT_AMOUNT_LUNA,
  buildTreasuryPreflightReport,
  deriveTreasuryPreflightAddress,
  formatTreasuryPreflightReport,
  readTreasuryPreflightConfig,
} from './preflightTreasury.ts'

const validEnv = {
  NIMHUNT_PAYOUT_NETWORK: 'mainnet',
  NIMHUNT_ENABLE_MAINNET_PAYOUT: 'true',
  NIMHUNT_REWARD_AMOUNT_LUNA: '10000',
}

describe('treasury preflight', () => {
  it('derives the expected public address and never prints secret material', () => {
    const generated = generateTreasuryMnemonic()
    const config = readTreasuryPreflightConfig({
      ...validEnv,
      NIMHUNT_TREASURY_MNEMONIC: generated.mnemonic,
    })
    const address = deriveTreasuryPreflightAddress(config.secret)
    expect(address).toBe(generated.address)
    expect(createNimiqTreasury({
      network: 'mainnet',
      secret: config.secret,
      connect: false,
    }).address()).toBe(generated.address)

    const report = buildTreasuryPreflightReport({
      address,
      amountLuna: TREASURY_PREFLIGHT_AMOUNT_LUNA,
      balanceLuna: 20_000n,
    })
    const output = formatTreasuryPreflightReport(report)
    expect(output).toContain(`treasuryAddress=${generated.address}`)
    expect(output).toContain('network=mainnet')
    expect(output).toContain('amountLuna=10000')
    expect(output).toContain('amountNim=0.10000')
    expect(output).toContain('mainnetEnabled=yes')
    expect(output).toContain('sufficientForAmountPlusFee=yes')
    expect(output).toContain('signed=no')
    expect(output).toContain('broadcast=no')
    expect(output).not.toContain(generated.mnemonic)
    expect(JSON.stringify(report, (_key, value) => typeof value === 'bigint' ? value.toString() : value)).not.toContain(generated.mnemonic)
    expect(output).not.toMatch(/private key|mnemonic/i)
    expect(formatNimFromLuna(10_000n)).toBe('0.10000')
  })

  it('fails closed for missing, malformed, or browser-prefixed secrets', () => {
    expect(() => readTreasuryPreflightConfig(validEnv)).toThrow(PayoutError)
    expect(() => readTreasuryPreflightConfig(validEnv)).toThrowError(/PAYOUT_TREASURY_UNAVAILABLE/)
    expect(() => readTreasuryPreflightConfig({
      ...validEnv,
      NIMHUNT_TREASURY_MNEMONIC: 'not a valid mnemonic',
    })).toThrowError(/PAYOUT_TREASURY_UNAVAILABLE/)
    expect(() => readTreasuryPreflightConfig({
      ...validEnv,
      NIMHUNT_TREASURY_PRIVATE_KEY: 'ab'.repeat(32),
    })).toThrowError(/PAYOUT_TREASURY_UNAVAILABLE/)
    expect(() => readTreasuryPreflightConfig({
      ...validEnv,
      VITE_NIMHUNT_TREASURY_MNEMONIC: 'abandon '.repeat(23) + 'about',
    })).toThrowError(/PAYOUT_TREASURY_UNAVAILABLE/)
  })

  it('fails closed for missing network, disabled mainnet, and invalid amounts', () => {
    const generated = generateTreasuryMnemonic()
    const mnemonicEnv = { NIMHUNT_TREASURY_MNEMONIC: generated.mnemonic }
    expect(() => readTreasuryPreflightConfig(mnemonicEnv)).toThrowError(/PAYOUT_NETWORK_INVALID/)
    expect(() => readTreasuryPreflightConfig({
      ...mnemonicEnv,
      NIMHUNT_PAYOUT_NETWORK: 'sepolia',
      NIMHUNT_ENABLE_MAINNET_PAYOUT: 'true',
      NIMHUNT_REWARD_AMOUNT_LUNA: '10000',
    })).toThrowError(/PAYOUT_NETWORK_INVALID/)
    expect(() => readTreasuryPreflightConfig({
      ...mnemonicEnv,
      NIMHUNT_PAYOUT_NETWORK: 'testnet',
      NIMHUNT_ENABLE_MAINNET_PAYOUT: 'true',
      NIMHUNT_REWARD_AMOUNT_LUNA: '10000',
    })).toThrowError(/PAYOUT_NETWORK_INVALID/)
    expect(() => readTreasuryPreflightConfig({
      ...mnemonicEnv,
      NIMHUNT_PAYOUT_NETWORK: 'mainnet',
      NIMHUNT_ENABLE_MAINNET_PAYOUT: 'false',
      NIMHUNT_REWARD_AMOUNT_LUNA: '10000',
    })).toThrowError(/PAYOUT_MAINNET_DISABLED/)
    expect(() => readTreasuryPreflightConfig({
      ...mnemonicEnv,
      NIMHUNT_PAYOUT_NETWORK: 'mainnet',
      NIMHUNT_ENABLE_MAINNET_PAYOUT: 'true',
    })).toThrowError(/PAYOUT_AMOUNT_UNCONFIGURED/)
    expect(() => readTreasuryPreflightConfig({
      ...mnemonicEnv,
      NIMHUNT_PAYOUT_NETWORK: 'mainnet',
      NIMHUNT_ENABLE_MAINNET_PAYOUT: 'true',
      NIMHUNT_REWARD_AMOUNT_LUNA: '1.5',
    })).toThrowError(/PAYOUT_AMOUNT_INVALID/)
    expect(() => readTreasuryPreflightConfig({
      ...mnemonicEnv,
      NIMHUNT_PAYOUT_NETWORK: 'mainnet',
      NIMHUNT_ENABLE_MAINNET_PAYOUT: 'true',
      NIMHUNT_REWARD_AMOUNT_LUNA: '10001',
    })).toThrowError(/PAYOUT_AMOUNT_INVALID/)
  })

  it('does not persist secrets and omits them from formatted output when balance is missing', () => {
    const generated = generateTreasuryMnemonic()
    const output = formatTreasuryPreflightReport(buildTreasuryPreflightReport({
      address: generated.address,
      amountLuna: 10_000n,
      balanceLuna: null,
    }))
    expect(output).toContain('treasuryBalanceLuna=UNAVAILABLE')
    expect(output).toContain('sufficientForAmountPlusFee=UNAVAILABLE')
    expect(output).not.toContain(generated.mnemonic)
    const source = readFileSync(new URL('./preflightTreasury.ts', import.meta.url), 'utf8')
    expect(source).not.toMatch(/writeFile|appendFile|createWriteStream/)
    expect(source).not.toMatch(/VITE_/)
  })
})
