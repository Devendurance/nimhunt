import { loadEnv } from 'vite'
import { createSupabaseAdminClient, readServerSupabaseConfig } from '../server/ledger/config.ts'
import {
  automaticPayoutsAllowed,
  readPayoutExecutionConfig,
  readTreasurySecret,
  requireAutomaticPayoutConfig,
} from '../server/payouts/config.ts'
import { createSupabasePayoutRpcClient } from '../server/payouts/db.ts'
import { PayoutError } from '../server/payouts/errors.ts'
import { createNimiqTreasury } from '../server/payouts/nimiqTreasury.ts'
import { createPayoutStore } from '../server/payouts/store.ts'
import { runPayoutWorker } from '../server/payouts/worker.ts'
import { createFakeTreasury } from '../server/payouts/fakeTreasury.ts'

const env = {
  ...loadEnv('development', process.cwd(), ''),
  ...process.env,
}

try {
  const config = readPayoutExecutionConfig(env)
  const supabase = readServerSupabaseConfig(env)
  if (!supabase) throw new PayoutError('PAYOUT_UNAVAILABLE')
  const admin = createSupabaseAdminClient(supabase)
  const store = createPayoutStore(createSupabasePayoutRpcClient(admin))
  const argv = process.argv.slice(2)
  const dryRun = argv.includes('--dry-run')
  const secret = dryRun ? null : readTreasurySecret(env)
  const max = readMax(argv)
  const execute = !dryRun && automaticPayoutsAllowed(config) && await store.getAutomationEnabled()

  if (execute) {
    requireAutomaticPayoutConfig(config, secret)
    if (!secret) throw new PayoutError('PAYOUT_TREASURY_UNAVAILABLE')
  }

  const treasury = !dryRun && secret
    ? createNimiqTreasury({ network: config.network, secret })
    : createFakeTreasury({ network: config.network, balance: 0n })

  if (!secret && execute) throw new PayoutError('PAYOUT_TREASURY_UNAVAILABLE')

  const report = await runPayoutWorker({
    store,
    treasury,
    config,
    secret,
    max,
    dryRun,
    mockAvailableLuna: dryRun ? 0n : undefined,
    log: event => {
      assertSafeLog(event)
      console.log(JSON.stringify(event))
    },
  })
  assertSafeLog(report)
  console.log(JSON.stringify(report))
  if (dryRun) {
    console.log(JSON.stringify({
      event: 'dry_run',
      note: 'Dry-run used a mocked treasury balance of 0 Luna. No payout was acquired, signed, broadcast, or mutated.',
    }))
  } else if (!execute) {
    console.log(JSON.stringify({
      event: 'kill_switch',
      note: 'NIMHUNT_AUTOMATIC_PAYOUTS_ENABLED and DB payout_automation_control both required for acquire/sign/broadcast. SUBMITTED reconciliation may still run when treasury credentials exist.',
    }))
  }
  process.exit(0)
} catch (error) {
  const code = error instanceof PayoutError ? error.code : 'PAYOUT_UNAVAILABLE'
  console.error(code)
  process.exit(1)
}

function readMax(argv: readonly string[]): number {
  const paired = argv.find(value => value.startsWith('--max='))
  const raw = paired
    ? paired.slice('--max='.length)
    : argv.includes('--max')
      ? argv[argv.indexOf('--max') + 1]
      : '5'
  if (!raw || !/^[0-9]+$/.test(raw)) throw new PayoutError('MALFORMED_REQUEST')
  const max = Number(raw)
  if (!Number.isInteger(max) || max < 1) throw new PayoutError('MALFORMED_REQUEST')
  return Math.min(max, 69)
}

function assertSafeLog(value: unknown): void {
  const text = JSON.stringify(value)
  if (/mnemonic|private key|private_key|capability|raw capabilities|signature/i.test(text)) {
    throw new PayoutError('PAYOUT_UNAVAILABLE')
  }
}
