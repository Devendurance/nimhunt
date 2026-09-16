import { PayoutError } from '../server/payouts/errors.ts'
import { formatTreasuryGenerateOutput, generateTreasuryMnemonic } from '../server/payouts/generateTreasury.ts'

try {
  console.log(formatTreasuryGenerateOutput(generateTreasuryMnemonic()))
} catch (error) {
  const code = error instanceof PayoutError ? error.code : 'PAYOUT_TREASURY_UNAVAILABLE'
  console.error(code)
  process.exit(1)
}
