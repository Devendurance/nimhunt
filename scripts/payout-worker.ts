import { loadEnv } from 'vite'
import { createSupabaseAdminClient, readServerSupabaseConfig } from '../server/ledger/config.ts'
import {
  formatNimFromLuna,
  readPayoutExecutionConfig,
  readTreasurySecret,
  requirePayoutAmountLuna,
  requirePayoutNetwork,
} from '../server/payouts/config.ts'
import { createSupabasePayoutRpcClient } from '../server/payouts/db.ts'
import { PayoutError } from '../server/payouts/errors.ts'
import { createNimiqTreasury } from '../server/payouts/nimiqTreasury.ts'
import { createPayoutStore } from '../server/payouts/store.ts'
import { preparePayoutsWithoutBroadcast, runPayoutWorker } from '../server/payouts/worker.ts'

const env = {
  ...loadEnv('development', process.cwd(), ''),
  ...process.env,
}

try {
  const config = readPayoutExecutionConfig(env)
  const supabase = readServerSupabaseConfig(env)
  if (!supabase) throw new PayoutError('PAYOUT_UNAVAILABLE')
  const amount = requirePayoutAmountLuna(config)
  const network = requirePayoutNetwork(config)
  const admin = createSupabaseAdminClient(supabase)
  const store = createPayoutStore(createSupabasePayoutRpcClient(admin))

  if (network === 'mainnet') {
    const claim = await selectReservedClaim(admin, env.NIMHUNT_PAYOUT_CLAIM_ID)
    const existing = await store.getByClaim(claim.claimId)
    if (existing && (existing.status !== 'PENDING' || existing.txHash)) {
      throw new PayoutError('PAYOUT_STATUS_INVALID')
    }

    const created = await preparePayoutsWithoutBroadcast({
      store,
      config,
      claimId: claim.claimId,
    })
    const retried = await preparePayoutsWithoutBroadcast({
      store,
      config,
      claimId: claim.claimId,
    })
    const payout = created[0]
    if (!payout || retried[0]?.payoutId !== payout.payoutId) {
      throw new PayoutError('PAYOUT_UNAVAILABLE')
    }
    if (
      payout.status !== 'PENDING'
      || payout.network !== 'mainnet'
      || payout.amountLuna !== amount
      || payout.wallet !== claim.wallet
      || payout.txHash
      || payout.attemptCount !== 0
    ) {
      throw new PayoutError('PAYOUT_STATUS_INVALID')
    }

    const secret = readTreasurySecret(env)
    let treasuryAddress = 'UNAVAILABLE'
    let balance: bigint | null = null
    if (secret) {
      const treasury = createNimiqTreasury({ network, secret })
      treasuryAddress = treasury.address()
      balance = await treasury.getBalance()
    }

    const feeLuna = 0n
    const remaining = balance == null ? null : balance - amount - feeLuna
    console.log([
      'MAINNET PAYOUT CHECKPOINT',
      `payout_id=${payout.payoutId}`,
      `claim_id=${shortenId(claim.claimId)}`,
      `treasury=${treasuryAddress}`,
      `treasuryBalanceNim=${balance == null ? 'UNAVAILABLE' : formatNimFromLuna(balance)}`,
      `treasuryBalanceLuna=${balance == null ? 'UNAVAILABLE' : balance.toString()}`,
      `recipient=${claim.wallet}`,
      'configuredAmount=0.1 NIM',
      'amount_luna=10000',
      'network=mainnet',
      `payoutStatus=${payout.status}`,
      `estimatedFeeLuna=${feeLuna.toString()}`,
      `expectedTreasuryBalanceAfterLuna=${remaining == null ? 'UNAVAILABLE' : remaining.toString()}`,
      `expectedTreasuryBalanceAfterNim=${remaining == null ? 'UNAVAILABLE' : formatNimFromLuna(remaining)}`,
      `recipientMatchesReservedClaim=${payout.wallet === claim.wallet ? 'yes' : 'no'}`,
      `priorTxHash=${payout.txHash ?? 'none'}`,
      `submittedAt=${payout.submittedAt ?? 'never'}`,
      `mainnetGuardsEnabled=${config.mainnetEnabled ? 'yes' : 'no'}`,
      `claimFinalized=${claim.finalized ? 'yes' : 'no'}`,
      'operationAfterApproval=acquire_reward_payout PENDING->PROCESSING, sign one basic mainnet NIM transfer treasury->recipient 10000 Luna extraData NIMHUNT_PAYOUT:<payout_id>, broadcast once, persist tx_hash PROCESSING->SUBMITTED, reconcile to CONFIRMED',
      'MAINNET_NIM_PAYOUT=NOT_AUTHORIZED',
      'Refusing to sign or broadcast. Waiting for explicit: GO MAINNET PAYOUT',
    ].join('\n'))
    process.exit(2)
  }

  const secret = readTreasurySecret(env)
  if (!secret) throw new PayoutError('PAYOUT_TREASURY_UNAVAILABLE')
  const treasury = createNimiqTreasury({ network: config.network, secret })
  const address = treasury.address()
  const balance = await treasury.getBalance()
  console.log([
    `network=${network}`,
    `mainnetEnabled=${config.mainnetEnabled}`,
    `treasury=${address}`,
    `balanceLuna=${balance.toString()}`,
    `balanceNim=${formatNimFromLuna(balance)}`,
    `rewardLuna=${amount.toString()}`,
    `rewardNim=${formatNimFromLuna(amount)}`,
  ].join('\n'))
  const report = await runPayoutWorker({
    store,
    treasury,
    config,
  })
  console.log(JSON.stringify(report))
} catch (error) {
  const code = error instanceof PayoutError ? error.code : 'PAYOUT_UNAVAILABLE'
  console.error(code)
  process.exit(1)
}

function shortenId(value: string): string {
  return `${value.slice(0, 8)}…`
}

async function selectReservedClaim(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  requestedId: string | undefined,
): Promise<{
  readonly claimId: string
  readonly wallet: string
  readonly finalized: boolean
}> {
  const { data, error } = await admin
    .from('reward_claims')
    .select('claim_id,wallet,status,public_key,signature,finalized_at,day_key')
    .eq('status', 'RESERVED')
  if (error) throw new PayoutError('PAYOUT_UNAVAILABLE')
  const rows = (data ?? []).map(row => ({
    claimId: String(row.claim_id),
    wallet: String(row.wallet),
    dayKey: String(row.day_key).slice(0, 10),
    finalized: Boolean(row.public_key) && Boolean(row.signature) && Boolean(row.finalized_at),
  }))
  const selected = requestedId
    ? rows.find(row => row.claimId === requestedId)
    : rows.length === 1
      ? rows[0]
      : undefined
  if (!selected || !selected.finalized || !selected.wallet.startsWith('NQ')) {
    throw new PayoutError('CLAIM_NOT_ELIGIBLE')
  }
  return selected
}
