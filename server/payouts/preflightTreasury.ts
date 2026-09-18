import { MnemonicUtils } from '@nimiq/core'
import {
  formatNimFromLuna,
  readPayoutExecutionConfig,
  requirePayoutAmountLuna,
  requirePayoutNetwork,
  type TreasurySecret,
} from './config.js'
import { PayoutError } from './errors.js'
import { keyPairFromSecret } from './nimiqTreasury.js'
import { normalizeNimiqAddress } from './intent.js'

export const TREASURY_PREFLIGHT_AMOUNT_LUNA = 10_000n
export const TREASURY_PREFLIGHT_FEE_LUNA = 0n

export type TreasuryPreflightConfig = {
  readonly network: 'mainnet'
  readonly mainnetEnabled: true
  readonly amountLuna: bigint
  readonly secret: Extract<TreasurySecret, { kind: 'mnemonic' }>
}

export type TreasuryPreflightReport = {
  readonly address: string
  readonly network: 'mainnet'
  readonly amountLuna: bigint
  readonly amountNim: string
  readonly mainnetEnabled: true
  readonly balanceLuna: bigint | null
  readonly balanceNim: string | null
  readonly feeLuna: bigint
  readonly sufficient: boolean | null
  readonly signed: false
  readonly broadcast: false
}

export function readTreasuryPreflightConfig(
  env: Record<string, string | undefined> = process.env,
): TreasuryPreflightConfig {
  const config = readPayoutExecutionConfig(env)
  if (config.network !== 'mainnet') throw new PayoutError('PAYOUT_NETWORK_INVALID')
  requirePayoutNetwork(config)
  const amountLuna = requirePayoutAmountLuna(config)
  if (amountLuna !== TREASURY_PREFLIGHT_AMOUNT_LUNA) throw new PayoutError('PAYOUT_AMOUNT_INVALID')
  return {
    network: 'mainnet',
    mainnetEnabled: true,
    amountLuna,
    secret: requireTreasuryMnemonic(env),
  }
}

export function deriveTreasuryPreflightAddress(secret: TreasurySecret): string {
  return normalizeNimiqAddress(keyPairFromSecret(secret).toAddress().toUserFriendlyAddress())
}

export function buildTreasuryPreflightReport(input: {
  readonly address: string
  readonly amountLuna: bigint
  readonly balanceLuna: bigint | null
}): TreasuryPreflightReport {
  const address = normalizeNimiqAddress(input.address)
  const sufficient = input.balanceLuna == null
    ? null
    : input.balanceLuna >= input.amountLuna + TREASURY_PREFLIGHT_FEE_LUNA
  return {
    address,
    network: 'mainnet',
    amountLuna: input.amountLuna,
    amountNim: formatNimFromLuna(input.amountLuna),
    mainnetEnabled: true,
    balanceLuna: input.balanceLuna,
    balanceNim: input.balanceLuna == null ? null : formatNimFromLuna(input.balanceLuna),
    feeLuna: TREASURY_PREFLIGHT_FEE_LUNA,
    sufficient,
    signed: false,
    broadcast: false,
  }
}

export function formatTreasuryPreflightReport(report: TreasuryPreflightReport): string {
  return [
    'TREASURY PREFLIGHT',
    `treasuryAddress=${report.address}`,
    `network=${report.network}`,
    `amountLuna=${report.amountLuna.toString()}`,
    `amountNim=${report.amountNim}`,
    `mainnetEnabled=${report.mainnetEnabled ? 'yes' : 'no'}`,
    `treasuryBalanceLuna=${report.balanceLuna == null ? 'UNAVAILABLE' : report.balanceLuna.toString()}`,
    `treasuryBalanceNim=${report.balanceNim ?? 'UNAVAILABLE'}`,
    `estimatedFeeLuna=${report.feeLuna.toString()}`,
    `sufficientForAmountPlusFee=${report.sufficient == null ? 'UNAVAILABLE' : report.sufficient ? 'yes' : 'no'}`,
    'signed=no',
    'broadcast=no',
  ].join('\n')
}

function requireTreasuryMnemonic(
  env: Record<string, string | undefined>,
): Extract<TreasurySecret, { kind: 'mnemonic' }> {
  if (env.NIMHUNT_TREASURY_PRIVATE_KEY?.trim()) throw new PayoutError('PAYOUT_TREASURY_UNAVAILABLE')
  const mnemonic = env.NIMHUNT_TREASURY_MNEMONIC?.trim()
  if (!mnemonic || mnemonic.split(/\s+/).length < 24) throw new PayoutError('PAYOUT_TREASURY_UNAVAILABLE')
  const secret = { kind: 'mnemonic' as const, value: mnemonic }
  try {
    MnemonicUtils.getMnemonicType(mnemonic)
    keyPairFromSecret(secret)
  } catch (error) {
    if (error instanceof PayoutError) throw error
    throw new PayoutError('PAYOUT_TREASURY_UNAVAILABLE')
  }
  return secret
}
