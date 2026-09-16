import { loadEnv } from 'vite'
import { PayoutError } from '../server/payouts/errors.ts'
import { createNimiqTreasury } from '../server/payouts/nimiqTreasury.ts'
import {
  formatSweepReport,
  parseSweepArgs,
  readSweepConfig,
  runTreasurySweep,
} from '../server/payouts/sweepTreasury.ts'

const env = {
  ...loadEnv('development', process.cwd(), ''),
  ...process.env,
}

try {
  const command = parseSweepArgs(process.argv.slice(2))
  const config = readSweepConfig(env)
  const treasury = createNimiqTreasury({
    network: config.network,
    secret: config.secret,
  })
  const report = await runTreasurySweep({
    command,
    transport: treasury,
  })
  console.log(formatSweepReport(report))
  if (report.mode === 'preview') process.exit(0)
  if (report.mode === 'confirmed' && report.leaveMatch) process.exit(0)
  process.exit(2)
} catch (error) {
  const code = error instanceof PayoutError ? error.code : 'PAYOUT_TREASURY_UNAVAILABLE'
  console.error(code)
  process.exit(1)
}
