import { PayoutError } from './errors.ts'
import {
  DAILY_REWARD_SLOTS,
  LUNA_PER_NIM,
  PAYOUT_NETWORKS,
  type PayoutNetwork,
} from './types.ts'

export type PayoutExecutionConfig = {
  readonly network: PayoutNetwork
  readonly mainnetEnabled: boolean
  readonly amountLuna: bigint | null
  readonly automaticPayoutsEnabled?: boolean
  readonly maxDailyRewardLuna?: bigint | null
  readonly treasuryMinReserveLuna?: bigint | null
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
    automaticPayoutsEnabled: env.NIMHUNT_AUTOMATIC_PAYOUTS_ENABLED === 'true',
    amountLuna: parsePositiveLuna(env.NIMHUNT_REWARD_AMOUNT_LUNA),
    maxDailyRewardLuna: parsePositiveLuna(env.NIMHUNT_MAX_DAILY_REWARD_LUNA),
    treasuryMinReserveLuna: parseNonNegativeLuna(env.NIMHUNT_TREASURY_MIN_RESERVE_LUNA),
  }
}

export function automaticPayoutsAllowed(config: PayoutExecutionConfig): boolean {
  return config.automaticPayoutsEnabled === true
    && config.mainnetEnabled
    && config.network === 'mainnet'
}

export function requireAutomaticPayoutConfig(
  config: PayoutExecutionConfig,
  secret?: TreasurySecret | null,
): {
  readonly amountLuna: bigint
  readonly maxDailyRewardLuna: bigint
  readonly treasuryMinReserveLuna: bigint
} {
  const amountLuna = requirePayoutAmountLuna(config)
  requirePayoutNetwork(config, 'mainnet')
  if (config.network !== 'mainnet') throw new PayoutError('PAYOUT_NETWORK_INVALID')
  if (!config.mainnetEnabled) throw new PayoutError('PAYOUT_MAINNET_DISABLED')
  if (!config.automaticPayoutsEnabled) throw new PayoutError('PAYOUT_AUTOMATION_DISABLED')
  if (config.maxDailyRewardLuna === null || config.maxDailyRewardLuna === undefined) {
    throw new PayoutError('PAYOUT_DAILY_CAP_INVALID')
  }
  if (config.maxDailyRewardLuna <= 0n) throw new PayoutError('PAYOUT_DAILY_CAP_INVALID')
  if (amountLuna * BigInt(DAILY_REWARD_SLOTS) > config.maxDailyRewardLuna) {
    throw new PayoutError('PAYOUT_DAILY_CAP_INVALID')
  }
  if (config.treasuryMinReserveLuna === null || config.treasuryMinReserveLuna === undefined) {
    throw new PayoutError('PAYOUT_TREASURY_UNAVAILABLE')
  }
  if (config.treasuryMinReserveLuna < 0n) throw new PayoutError('PAYOUT_AMOUNT_INVALID')
  if (secret === null) throw new PayoutError('PAYOUT_TREASURY_UNAVAILABLE')
  return {
    amountLuna,
    maxDailyRewardLuna: config.maxDailyRewardLuna,
    treasuryMinReserveLuna: config.treasuryMinReserveLuna,
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

function parsePositiveLuna(value: string | undefined): bigint | null {
  const raw = value?.trim()
  if (!raw) return null
  if (!/^[0-9]+$/.test(raw)) throw new PayoutError('PAYOUT_AMOUNT_INVALID')
  const amount = BigInt(raw)
  if (amount <= 0n) throw new PayoutError('PAYOUT_AMOUNT_INVALID')
  return amount
}

function parseNonNegativeLuna(value: string | undefined): bigint | null {
  const raw = value?.trim()
  if (!raw) return null
  if (!/^[0-9]+$/.test(raw)) throw new PayoutError('PAYOUT_AMOUNT_INVALID')
  return BigInt(raw)
}
