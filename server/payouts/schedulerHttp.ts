import {
  authorizePayoutSchedulerRequest,
  isUsablePayoutSchedulerSecret,
  PAYOUT_CYCLE_PATH,
  type ScheduledPayoutCycleResult,
} from './scheduler.js'

const BASE_HEADERS = {
  'cache-control': 'no-store',
  'content-type': 'application/json; charset=utf-8',
  'x-content-type-options': 'nosniff',
}

export type PayoutSchedulerHttpRequest = {
  readonly method: string
  readonly path: string
  readonly headers?: Readonly<Record<string, string | undefined>>
  readonly rawBody?: string
}

export type PayoutSchedulerHttpResponse = {
  readonly status: number
  readonly body: unknown
  readonly headers: Readonly<Record<string, string>>
}

export type PayoutSchedulerHttpDependencies = {
  readonly secret: string | null
  readonly runCycle: () => Promise<ScheduledPayoutCycleResult>
}

export async function dispatchPayoutSchedulerHttp(
  dependencies: PayoutSchedulerHttpDependencies,
  request: PayoutSchedulerHttpRequest,
): Promise<PayoutSchedulerHttpResponse> {
  const url = parseRequestUrl(request.path)
  if (!url || url.pathname !== PAYOUT_CYCLE_PATH) {
    return response(404, { ok: false, error: 'MALFORMED_REQUEST' })
  }
  if (url.search || url.hash) {
    return response(400, { ok: false, error: 'MALFORMED_REQUEST' })
  }
  if (!isUsablePayoutSchedulerSecret(dependencies.secret)) {
    return response(503, { ok: false, error: 'PAYOUT_UNAVAILABLE' })
  }
  if (!authorizePayoutSchedulerRequest(request.headers, dependencies.secret)) {
    return response(401, { ok: false, error: 'UNAUTHORIZED' })
  }

  const method = request.method.toUpperCase()
  if (method !== 'GET' && method !== 'POST') {
    return response(405, { ok: false, error: 'METHOD_NOT_ALLOWED' })
  }

  try {
    // The body is intentionally ignored. Amount, network, and cycle max are server configuration only.
    return response(200, await dependencies.runCycle())
  } catch {
    return response(500, { ok: false, error: 'PAYOUT_UNAVAILABLE' })
  }
}

function parseRequestUrl(path: string): URL | null {
  if (!path.startsWith('/')) return null
  try {
    return new URL(path, 'https://internal.nimhunt')
  } catch {
    return null
  }
}

function response(status: number, body: unknown): PayoutSchedulerHttpResponse {
  return { status, body, headers: BASE_HEADERS }
}
