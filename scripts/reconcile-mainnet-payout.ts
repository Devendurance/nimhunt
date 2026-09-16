import { loadEnv } from 'vite'
import { createSupabaseAdminClient, readServerSupabaseConfig } from '../server/ledger/config.ts'
import { AUTHORIZED_MAINNET_PAYOUT } from '../server/payouts/authorizedMainnetPayout.ts'
import { formatNimFromLuna, readTreasurySecret } from '../server/payouts/config.ts'
import { createSupabasePayoutRpcClient } from '../server/payouts/db.ts'
import { PayoutError } from '../server/payouts/errors.ts'
import { normalizeNimiqAddress } from '../server/payouts/intent.ts'
import { createNimiqTreasury } from '../server/payouts/nimiqTreasury.ts'
import { createPayoutService } from '../server/payouts/service.ts'
import { createPayoutStore } from '../server/payouts/store.ts'

const env = {
  ...loadEnv('development', process.cwd(), ''),
  ...process.env,
}

try {
  const supabase = readServerSupabaseConfig(env)
  if (!supabase) throw new PayoutError('PAYOUT_UNAVAILABLE')
  const secret = readTreasurySecret(env)
  if (!secret || secret.kind !== 'mnemonic') throw new PayoutError('PAYOUT_TREASURY_UNAVAILABLE')

  const admin = createSupabaseAdminClient(supabase)
  const store = createPayoutStore(createSupabasePayoutRpcClient(admin))
  const before = await store.get(AUTHORIZED_MAINNET_PAYOUT.payoutId)
  console.log([
    'LIVE PAYOUT ROW',
    `payout_id=${before.payoutId}`,
    `status=${before.status}`,
    `attempt_count=${before.attemptCount}`,
    `tx_hash=${before.txHash ?? 'none'}`,
    `amount_luna=${before.amountLuna.toString()}`,
    `recipient=${before.wallet}`,
    `network=${before.network}`,
  ].join('\n'))

  if (!before.txHash) throw new PayoutError('PAYOUT_TX_INVALID')
  if (before.status !== 'SUBMITTED' && before.status !== 'CONFIRMED') {
    throw new PayoutError('PAYOUT_STATUS_INVALID')
  }

  const treasury = createNimiqTreasury({ network: 'mainnet', secret })
  const service = createPayoutService({
    store,
    treasury,
    config: {
      network: 'mainnet',
      mainnetEnabled: true,
      amountLuna: AUTHORIZED_MAINNET_PAYOUT.amountLuna,
    },
  })

  const first = before.status === 'CONFIRMED' ? before : await service.reconcile(before) ?? before
  const chain = await treasury.getTransaction(before.txHash)
  const second = first.status === 'CONFIRMED' ? first : await service.reconcile(first) ?? first
  const after = await store.get(AUTHORIZED_MAINNET_PAYOUT.payoutId)
  const claim = await admin.from('reward_claims').select('claim_id,wallet,status').eq('claim_id', after.claimId).maybeSingle()
  const walletState = await admin
    .from('daily_wallet_state')
    .select('rewards_reserved')
    .eq('day_key', after.dayKey)
    .eq('wallet', after.wallet)
    .maybeSingle()
  const pool = await admin.from('daily_reward_pools').select('reserved_slots').eq('day_key', after.dayKey).maybeSingle()

  console.log([
    'RECONCILE ONLY',
    `signed=no`,
    `broadcast=no`,
    `acquire=no`,
    `first_status=${first.status}`,
    `second_status=${second.status}`,
    `final_status=${after.status}`,
    `final_tx_hash=${after.txHash ?? 'none'}`,
    `same_tx_hash=${after.txHash === before.txHash ? 'yes' : 'no'}`,
    `chain_status=${chain?.status ?? 'UNAVAILABLE'}`,
    `chain_sender=${chain?.sender ?? 'UNAVAILABLE'}`,
    `chain_recipient=${chain?.recipient ?? 'UNAVAILABLE'}`,
    `chain_amount_luna=${chain?.amountLuna.toString() ?? 'UNAVAILABLE'}`,
    `chain_amount_nim=${chain ? formatNimFromLuna(chain.amountLuna) : 'UNAVAILABLE'}`,
    `chain_network=${chain?.network ?? 'UNAVAILABLE'}`,
    `sender_matches_treasury=${chain && normalizeNimiqAddress(chain.sender) === normalizeNimiqAddress(AUTHORIZED_MAINNET_PAYOUT.treasury) ? 'yes' : 'no'}`,
    `recipient_matches=${chain && normalizeNimiqAddress(chain.recipient) === normalizeNimiqAddress(AUTHORIZED_MAINNET_PAYOUT.recipient) ? 'yes' : 'no'}`,
    `amount_matches=${chain?.amountLuna === 10_000n ? 'yes' : 'no'}`,
    `claim_status=${claim.data ? String(claim.data.status) : 'UNAVAILABLE'}`,
    `rewards_reserved=${walletState.data == null ? 'UNAVAILABLE' : String(walletState.data.rewards_reserved)}`,
    `reserved_slots=${pool.data == null ? 'UNAVAILABLE' : String(pool.data.reserved_slots)}`,
    `attempt_count=${after.attemptCount}`,
  ].join('\n'))
} catch (error) {
  const code = error instanceof PayoutError ? error.code : 'PAYOUT_UNAVAILABLE'
  console.error(code)
  process.exit(1)
}
