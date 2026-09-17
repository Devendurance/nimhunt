import type { IncomingMessage, ServerResponse } from 'node:http'
import { createDefaultPayoutRuntime, type PayoutRuntime } from '../../server/payouts/runtime.ts'
import { executeScheduledPayoutCycle, readPayoutSchedulerConfig } from '../../server/payouts/scheduler.ts'
import { dispatchPayoutSchedulerHttp } from '../../server/payouts/schedulerHttp.ts'

export default async function payoutCycleHandler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  let schedulerConfig
  try {
    schedulerConfig = readPayoutSchedulerConfig(process.env)
  } catch {
    writeJson(res, 503, { ok: false, error: 'PAYOUT_UNAVAILABLE' })
    return
  }

  let runtimePromise: Promise<PayoutRuntime | null> | undefined
  const response = await dispatchPayoutSchedulerHttp({
    secret: schedulerConfig.cronSecret,
    runCycle: async () => {
      runtimePromise ??= Promise.resolve(createDefaultPayoutRuntime(process.env))
      const runtime = await runtimePromise
      if (!runtime) throw new Error('PAYOUT_UNAVAILABLE')
      return executeScheduledPayoutCycle({
        store: runtime.store,
        treasury: runtime.treasury,
        config: runtime.config,
        scheduler: runtime.scheduler,
        secret: runtime.secret,
      })
    },
  }, {
    method: req.method ?? 'GET',
    path: req.url ?? '',
    headers: readHeaders(req),
  })
  writeJson(res, response.status, response.body, response.headers)
}

function readHeaders(req: IncomingMessage): Record<string, string | undefined> {
  return Object.fromEntries(
    Object.entries(req.headers).map(([key, value]) => [key, typeof value === 'string' ? value : undefined]),
  )
}

function writeJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: Readonly<Record<string, string>> = {},
): void {
  res.statusCode = status
  for (const [name, value] of Object.entries(headers)) res.setHeader(name, value)
  res.end(JSON.stringify(body))
}
