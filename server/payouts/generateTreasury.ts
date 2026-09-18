import { Entropy } from '@nimiq/core'
import { normalizeNimiqAddress } from './intent.js'
import { keyPairFromSecret } from './nimiqTreasury.js'

export type GeneratedTreasury = {
  readonly secretType: 'mnemonic'
  readonly mnemonic: string
  readonly address: string
}

export function generateTreasuryMnemonic(): GeneratedTreasury {
  const mnemonic = Entropy.generate().toMnemonic().join(' ')
  const address = normalizeNimiqAddress(
    keyPairFromSecret({ kind: 'mnemonic', value: mnemonic }).toAddress().toUserFriendlyAddress(),
  )
  return {
    secretType: 'mnemonic',
    mnemonic,
    address,
  }
}

export function formatTreasuryGenerateOutput(generated: GeneratedTreasury): string {
  return [
    'NIMHUNT TREASURY GENERATED',
    `NIMHUNT_TREASURY_MNEMONIC="${generated.mnemonic}"`,
    `Treasury address: ${generated.address}`,
    '',
    'Copy the mnemonic into local server-only .env. Never VITE_*, never Git, never browser, never logs.',
    'Do not also set NIMHUNT_TREASURY_PRIVATE_KEY.',
    'After saving, run: npm run treasury:preflight',
    'Do not broadcast any transaction. Next: fund this public address from Nimiq Pay.',
  ].join('\n')
}
