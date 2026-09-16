import { loadEnv } from 'vite'
import { PayoutError } from '../server/payouts/errors.ts'
import { createNimiqTreasury } from '../server/payouts/nimiqTreasury.ts'
import {
  buildTreasuryPreflightReport,
  deriveTreasuryPreflightAddress,
  formatTreasuryPreflightReport,
  readTreasuryPreflightConfig,
} from '../server/payouts/preflightTreasury.ts'

const env = {
  ...loadEnv('development', process.cwd(), ''),
  ...process.env,
}

try {
  const config = readTreasuryPreflightConfig(env)
  const address = deriveTreasuryPreflightAddress(config.secret)
  const treasury = createNimiqTreasury({
    network: config.network,
    secret: config.secret,
  })
  if (treasury.address() !== address) throw new PayoutError('WALLET_MISMATCH')
  let balanceLuna: bigint | null = null
  try {
    balanceLuna = await treasury.getBalance()
  } catch {
    balanceLuna = null
  }
  console.log(formatTreasuryPreflightReport(buildTreasuryPreflightReport({
    address,
    amountLuna: config.amountLuna,
    balanceLuna,
  })))
} catch (error) {
  const code = error instanceof PayoutError ? error.code : 'PAYOUT_TREASURY_UNAVAILABLE'
  console.error(code)
  process.exit(1)
}
