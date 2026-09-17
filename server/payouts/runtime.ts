import { createSupabaseAdminClient, readServerSupabaseConfig } from '../ledger/config.ts'
import { PayoutError } from './errors.ts'
import { createSupabasePayoutRpcClient } from './db.ts'
import {
  readPayoutExecutionConfig,
  readTreasurySecret,
  type PayoutExecutionConfig,
  type TreasurySecret,
} from './config.ts'
import { createNimiqTreasury } from './nimiqTreasury.ts'
import { createPayoutStore } from './store.ts'
import { readPayoutSchedulerConfig, type PayoutSchedulerConfig } from './scheduler.ts'
import type { PayoutNetwork, PayoutStore, TreasuryAdapter } from './types.ts'

export type PayoutRuntime = {
  readonly store: PayoutStore
  readonly treasury: TreasuryAdapter
  readonly config: PayoutExecutionConfig
  readonly scheduler: PayoutSchedulerConfig
  readonly secret: TreasurySecret | null
}

export function createDefaultPayoutRuntime(
  env: Record<string, string | undefined> = process.env,
): PayoutRuntime | null {
  const config = readPayoutExecutionConfig(env)
  const scheduler = readPayoutSchedulerConfig(env)
  const supabase = readServerSupabaseConfig(env)
  if (!supabase) return null

  const store = createPayoutStore(createSupabasePayoutRpcClient(createSupabaseAdminClient(supabase)))
  const secret = readTreasurySecret(env)
  const treasury = secret
    ? createNimiqTreasury({ network: config.network, secret })
    : createUnavailableTreasury(config.network)
  return { store, treasury, config, scheduler, secret }
}

function createUnavailableTreasury(network: PayoutNetwork): TreasuryAdapter {
  const unavailable = async (): Promise<never> => {
    throw new PayoutError('PAYOUT_TREASURY_UNAVAILABLE')
  }
  return {
    network,
    address: () => '',
    getBalance: unavailable,
    signTransfer: unavailable,
    submitSigned: unavailable,
    getTransaction: unavailable,
    findPayoutTransfer: unavailable,
  }
}
