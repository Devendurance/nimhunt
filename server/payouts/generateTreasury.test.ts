import { readFileSync } from 'node:fs'
import { Address, MnemonicUtils } from '@nimiq/core'
import { describe, expect, it } from 'vitest'
import { formatTreasuryGenerateOutput, generateTreasuryMnemonic } from './generateTreasury.ts'
import { createNimiqTreasury, keyPairFromSecret } from './nimiqTreasury.ts'

describe('treasury generator', () => {
  it('produces a valid mnemonic and Nimiq address through the production adapter', () => {
    const generated = generateTreasuryMnemonic()
    expect(generated.secretType).toBe('mnemonic')
    expect(generated.mnemonic.split(/\s+/).length).toBeGreaterThanOrEqual(24)
    expect(() => MnemonicUtils.mnemonicToEntropy(generated.mnemonic)).not.toThrow()
    expect(generated.address.startsWith('NQ')).toBe(true)
    expect(Address.fromString(generated.address).toUserFriendlyAddress()).toBe(generated.address)

    const adapter = keyPairFromSecret({ kind: 'mnemonic', value: generated.mnemonic })
    expect(adapter.toAddress().toUserFriendlyAddress()).toBe(generated.address)
    expect(
      MnemonicUtils.mnemonicToExtendedPrivateKey(generated.mnemonic).toAddress().toUserFriendlyAddress(),
    ).toBe(generated.address)
    expect(createNimiqTreasury({
      network: 'mainnet',
      secret: { kind: 'mnemonic', value: generated.mnemonic },
      connect: false,
    }).address()).toBe(generated.address)
  })

  it('prints the mnemonic only as a terminal env assignment and does not persist it', () => {
    const generated = generateTreasuryMnemonic()
    const output = formatTreasuryGenerateOutput(generated)
    expect(output).toContain(`NIMHUNT_TREASURY_MNEMONIC="${generated.mnemonic}"`)
    expect(output).toContain(`Treasury address: ${generated.address}`)
    expect(output).not.toMatch(/VITE_[A-Z]/)
    expect(output).toContain('npm run treasury:preflight')

    const source = readFileSync(new URL('./generateTreasury.ts', import.meta.url), 'utf8')
    expect(source).not.toMatch(/writeFile|appendFile|createWriteStream|copyFile|mkdir/)
    expect(source).not.toMatch(/VITE_[A-Z]/)
  })
})
