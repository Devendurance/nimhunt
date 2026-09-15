import { loadEnv } from 'vite'
import { createSupabaseAdminClient, readServerSupabaseConfig } from '../server/ledger/config.ts'
import {
  DevResetError,
  createSupabaseDevResetStore,
  parseDevResetWalletArg,
  redactWallet,
  resetDevExpeditionAttempts,
} from '../server/ledger/devResetExpeditions.ts'

const env = {
  ...loadEnv('development', process.cwd(), ''),
  ...process.env,
}

try {
  const wallet = parseDevResetWalletArg(process.argv.slice(2))
  const config = readServerSupabaseConfig(env)
  if (!config) throw new DevResetError('PROOF_UNAVAILABLE')
  const result = await resetDevExpeditionAttempts({
    env,
    wallet,
    store: createSupabaseDevResetStore(createSupabaseAdminClient(config)),
  })
  console.log([
    `utcDay=${result.dayKey}`,
    `wallet=${redactWallet(result.wallet)}`,
    `beforeStarted=${result.beforeStarted}`,
    `afterStarted=${result.afterStarted}`,
    `beforeRemaining=${result.beforeRemaining}`,
    `afterRemaining=${result.afterRemaining}`,
    `rowsChanged=${result.rowsChanged}`,
    `rewardsReserved=${result.rewardsReserved}`,
    `runs=${result.after.runCount}`,
    `checkpointBatches=${result.after.batchCount}`,
    `vaultSeals=${result.after.sealCount}`,
    `poolReservedSlots=${result.after.poolReservedSlots ?? 'none'}`,
    `otherWalletsOnDay=${result.after.otherWalletsOnDay}`,
  ].join('\n'))
} catch (error) {
  const code = error instanceof DevResetError ? error.code : 'PROOF_UNAVAILABLE'
  const detail = error instanceof DevResetError ? error.message : 'DEV_RESET_FAILED'
  console.error(`DEV_RESET_FAILED code=${code} detail=${detail}`)
  process.exitCode = 1
}
