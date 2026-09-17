import { loadEnv } from 'vite'
import { createDefaultPayoutRuntime } from '../server/payouts/runtime.ts'
import { readPayoutOperationsStatus } from '../server/payouts/scheduler.ts'
import { PayoutError } from '../server/payouts/errors.ts'

const env = {
  ...loadEnv('development', process.cwd(), ''),
  ...process.env,
}

try {
  const runtime = createDefaultPayoutRuntime(env)
  if (!runtime) throw new PayoutError('PAYOUT_UNAVAILABLE')
  const status = await readPayoutOperationsStatus(runtime)
  assertSafeOutput(status)
  console.log(JSON.stringify({ ok: true, ...status }))
  process.exit(0)
} catch (error) {
  const code = error instanceof PayoutError ? error.code : 'PAYOUT_UNAVAILABLE'
  console.error(code)
  process.exit(1)
}

function assertSafeOutput(value: unknown): void {
  const text = JSON.stringify(value)
  if (/mnemonic|private key|private_key|capability|raw capabilities|signature/i.test(text)) {
    throw new PayoutError('PAYOUT_UNAVAILABLE')
  }
}
