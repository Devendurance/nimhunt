import { PayoutError } from './errors.ts'
import {
  LUNA_PER_NIM,
  PAYOUT_NETWORKS,
  type PayoutNetwork,
} from './types.ts'

export type PayoutExecutionConfig = {
  readonly network: PayoutNetwork
  readonly mainnetEnabled: boolean
  readonly amountLuna: bigint | null
}

export type TreasurySecret =
  | { readonly kind: 'hex'; readonly value: string }
  | { readonly kind: 'mnemonic'; readonly value: string }

const VITE_SECRET_KEYS = [
  'VITE_NIMHUNT_TREASURY_PRIVATE_KEY',
  'VITE_NIMHUNT_TREASURY_MNEMONIC',
  'VITE_TREASURY_PRIVATE_KEY',
  'VITE_TREASURY_MNEMONIC',
] as const

export function readPayoutExecutionConfig(
  env: Record<string, string | undefined> = process.env,
): PayoutExecutionConfig {
  assertNoBrowserTreasurySecrets(env)
  const network = parseNetwork(env.NIMHUNT_PAYOUT_NETWORK)
  const mainnetEnabled = env.NIMHUNT_ENABLE_MAINNET_PAYOUT === 'true'
  return {
    network,
    mainnetEnabled,
    amountLuna: parseAmountLuna(env.NIMHUNT_REWARD_AMOUNT_LUNA),
  }
}

export function requirePayoutNetwork(
  config: PayoutExecutionConfig,
  requested: PayoutNetwork = config.network,
): PayoutNetwork {
  if (requested !== config.network) throw new PayoutError('PAYOUT_NETWORK_INVALID')
  if (requested === 'mainnet' && !config.mainnetEnabled) throw new PayoutError('PAYOUT_MAINNET_DISABLED')
  return requested
}

export function requirePayoutAmountLuna(config: PayoutExecutionConfig): bigint {
  if (config.amountLuna === null) throw new PayoutError('PAYOUT_AMOUNT_UNCONFIGURED')
  if (config.amountLuna <= 0n) throw new PayoutError('PAYOUT_AMOUNT_INVALID')
  return config.amountLuna
}

export function readTreasurySecret(
  env: Record<string, string | undefined> = process.env,
): TreasurySecret | null {
  assertNoBrowserTreasurySecrets(env)
  const hex = env.NIMHUNT_TREASURY_PRIVATE_KEY?.trim()
  if (hex) return { kind: 'hex', value: hex }
  const mnemonic = env.NIMHUNT_TREASURY_MNEMONIC?.trim()
  if (mnemonic) return { kind: 'mnemonic', value: mnemonic }
  return null
}

export function formatNimFromLuna(luna: bigint): string {
  const negative = luna < 0n
  const absolute = negative ? -luna : luna
  const whole = absolute / LUNA_PER_NIM
  const fraction = (absolute % LUNA_PER_NIM).toString().padStart(5, '0')
  return `${negative ? '-' : ''}${whole.toString()}.${fraction}`
}

export function assertNoBrowserTreasurySecrets(env: Record<string, string | undefined>): void {
  for (const key of VITE_SECRET_KEYS) {
    if (env[key]?.trim()) throw new PayoutError('PAYOUT_TREASURY_UNAVAILABLE')
  }
}

function parseNetwork(value: string | undefined): PayoutNetwork {
  const network = value?.trim()
  if (!network || !PAYOUT_NETWORKS.includes(network as PayoutNetwork)) {
    throw new PayoutError('PAYOUT_NETWORK_INVALID')
  }
  return network as PayoutNetwork
}

function parseAmountLuna(value: string | undefined): bigint | null {
  const raw = value?.trim()
  if (!raw) return null
  if (!/^[0-9]+$/.test(raw)) throw new PayoutError('PAYOUT_AMOUNT_INVALID')
  const amount = BigInt(raw)
  if (amount <= 0n) throw new PayoutError('PAYOUT_AMOUNT_INVALID')
  return amount
}
