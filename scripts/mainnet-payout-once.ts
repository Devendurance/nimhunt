import { loadEnv } from 'vite'
import { createSupabaseAdminClient, readServerSupabaseConfig } from '../server/ledger/config.ts'
import {
  AUTHORIZED_MAINNET_FEE_LUNA,
  AUTHORIZED_MAINNET_PAYOUT,
  runAuthorizedMainnetPayoutOnce,
} from '../server/payouts/authorizedMainnetPayout.ts'
import {
  formatNimFromLuna,
  readPayoutExecutionConfig,
  readTreasurySecret,
} from '../server/payouts/config.ts'
import { createSupabasePayoutRpcClient } from '../server/payouts/db.ts'
import { PayoutError } from '../server/payouts/errors.ts'
import { normalizeNimiqAddress } from '../server/payouts/intent.ts'
import { createNimiqTreasury } from '../server/payouts/nimiqTreasury.ts'
import { createPayoutService } from '../server/payouts/service.ts'
import { createPayoutStore } from '../server/payouts/store.ts'
import type { RewardPayout } from '../server/payouts/types.ts'

const env = {
  ...loadEnv('development', process.cwd(), ''),
  ...process.env,
}

try {
  const config = readPayoutExecutionConfig(env)
  const supabase = readServerSupabaseConfig(env)
  if (!supabase) throw new PayoutError('PAYOUT_UNAVAILABLE')
  const secret = readTreasurySecret(env)
  if (!secret || secret.kind !== 'mnemonic') throw new PayoutError('PAYOUT_TREASURY_UNAVAILABLE')
  if (env.NIMHUNT_TREASURY_PRIVATE_KEY?.trim()) throw new PayoutError('PAYOUT_TREASURY_UNAVAILABLE')

  const admin = createSupabaseAdminClient(supabase)
  const store = createPayoutStore(createSupabasePayoutRpcClient(admin))
  const payout = await store.get(AUTHORIZED_MAINNET_PAYOUT.payoutId)
  const claim = await readClaim(admin, payout.claimId)
  const ledger = await readLedger(admin, payout.dayKey, claim.wallet)
  const treasury = createNimiqTreasury({ network: 'mainnet', secret })
  const treasuryAddress = treasury.address()
  const balance = await treasury.getBalance()

  console.log([
    'AUTHORIZED MAINNET PAYOUT LIVE CHECK',
    `payout_id=${payout.payoutId}`,
    `status=${payout.status}`,
    `attempt_count=${payout.attemptCount}`,
    `tx_hash=${payout.txHash ?? 'none'}`,
    `claim_status=${claim.status}`,
    `recipient=${payout.wallet}`,
    `claim_wallet=${claim.wallet}`,
    `amount_luna=${payout.amountLuna.toString()}`,
    `network=${payout.network}`,
    `treasury=${treasuryAddress}`,
    `treasuryBalanceLuna=${balance.toString()}`,
    `treasuryBalanceNim=${formatNimFromLuna(balance)}`,
    `mainnetEnabled=${config.mainnetEnabled ? 'yes' : 'no'}`,
    `rewards_reserved=${ledger.rewardsReserved}`,
    `reserved_slots=${ledger.reservedSlots}`,
  ].join('\n'))

  const result = await runAuthorizedMainnetPayoutOnce({
    store,
    treasury,
    config,
    claimStatus: claim.status,
    claimWallet: claim.wallet,
    treasuryBalanceLuna: balance,
    waitForConfirmation: current => waitForConfirmation(store, treasury, current),
  })

  if (result.action === 'stopped') {
    console.log([
      'STOPPED WITHOUT SENDING',
      `failures=${result.gate.failures.join(',') || 'none'}`,
      'MAINNET TEST PAYOUT=FAIL',
    ].join('\n'))
    process.exit(2)
  }

  const after = await store.get(AUTHORIZED_MAINNET_PAYOUT.payoutId)
  const afterClaim = await readClaim(admin, after.claimId)
  const afterLedger = await readLedger(admin, after.dayKey, afterClaim.wallet)
  const chain = after.txHash ? await treasury.getTransaction(after.txHash) : null
  const rerun = await runAuthorizedMainnetPayoutOnce({
    store,
    treasury,
    config,
    claimStatus: afterClaim.status,
    claimWallet: afterClaim.wallet,
    treasuryBalanceLuna: balance,
  })

  console.log([
    'AUTHORIZED MAINNET PAYOUT RESULT',
    `action=${result.action}`,
    `sent=${result.sent ? 'yes' : 'no'}`,
    `payout_id=${after.payoutId}`,
    `tx_hash=${after.txHash ?? 'none'}`,
    `final_status=${after.status}`,
    `attempt_count=${after.attemptCount}`,
    `confirmed_sender=${chain?.sender ?? 'UNAVAILABLE'}`,
    `confirmed_recipient=${chain?.recipient ?? after.wallet}`,
    `confirmed_amount_luna=${chain?.amountLuna.toString() ?? after.amountLuna.toString()}`,
    `confirmed_amount_nim=${formatNimFromLuna(chain?.amountLuna ?? after.amountLuna)}`,
    `chain_status=${chain?.status ?? 'UNAVAILABLE'}`,
    `claim_status=${afterClaim.status}`,
    `rewards_reserved=${afterLedger.rewardsReserved}`,
    `reserved_slots=${afterLedger.reservedSlots}`,
    `rerun_action=${rerun.action}`,
    `rerun_sent=${rerun.sent ? 'yes' : 'no'}`,
    `rerun_tx_hash=${rerun.payout.txHash ?? 'none'}`,
    `expected_treasury=${normalizeNimiqAddress(AUTHORIZED_MAINNET_PAYOUT.treasury)}`,
    `expected_recipient=${normalizeNimiqAddress(AUTHORIZED_MAINNET_PAYOUT.recipient)}`,
    `fee_luna=${AUTHORIZED_MAINNET_FEE_LUNA.toString()}`,
  ].join('\n'))
} catch (error) {
  const code = error instanceof PayoutError ? error.code : 'PAYOUT_UNAVAILABLE'
  console.error(code)
  process.exit(1)
}

async function waitForConfirmation(
  store: ReturnType<typeof createPayoutStore>,
  treasury: ReturnType<typeof createNimiqTreasury>,
  payout: RewardPayout,
): Promise<RewardPayout> {
  const service = createPayoutService({
    store,
    treasury,
    config: {
      network: 'mainnet',
      mainnetEnabled: true,
      amountLuna: AUTHORIZED_MAINNET_PAYOUT.amountLuna,
    },
  })
  let current = payout
  const deadline = Date.now() + 120_000
  while (Date.now() < deadline) {
    const next = await service.reconcile(current)
    current = next ?? await store.get(payout.payoutId)
    if (current.status === 'CONFIRMED' || current.status === 'FAILED_FINAL') return current
    await sleep(4_000)
  }
  return current
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function readClaim(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  claimId: string,
): Promise<{ readonly claimId: string; readonly wallet: string; readonly status: string }> {
  const { data, error } = await admin
    .from('reward_claims')
    .select('claim_id,wallet,status')
    .eq('claim_id', claimId)
    .maybeSingle()
  if (error || !data) throw new PayoutError('CLAIM_NOT_FOUND')
  return {
    claimId: String(data.claim_id),
    wallet: String(data.wallet),
    status: String(data.status),
  }
}

async function readLedger(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  dayKey: string,
  wallet: string,
): Promise<{ readonly rewardsReserved: number | null; readonly reservedSlots: number | null }> {
  const [walletState, pool] = await Promise.all([
    admin.from('daily_wallet_state').select('rewards_reserved').eq('day_key', dayKey).eq('wallet', wallet).maybeSingle(),
    admin.from('daily_reward_pools').select('reserved_slots').eq('day_key', dayKey).maybeSingle(),
  ])
  return {
    rewardsReserved: walletState.data == null ? null : Number(walletState.data.rewards_reserved),
    reservedSlots: pool.data == null ? null : Number(pool.data.reserved_slots),
  }
}
