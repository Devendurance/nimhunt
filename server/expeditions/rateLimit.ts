export type RateLimiter = {
  take(key: string, limit: number, windowMs: number, now?: number): boolean
  reset(): void
}

export const START_CHALLENGE_WALLET_LIMIT = 30
export const START_CHALLENGE_INSTALL_LIMIT = 60
export const RECOVERY_CHALLENGE_WALLET_LIMIT = 20
export const RECOVERY_CHALLENGE_INSTALL_LIMIT = 40
export const CLAIM_SESSION_LIMIT = 30
export const CLAIM_INSTALL_LIMIT = 60
export const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1_000

export function createRateLimiter(clock: () => number = Date.now): RateLimiter {
  const buckets = new Map<string, number[]>()
  return {
    take(key, limit, windowMs, now = clock()) {
      const recent = (buckets.get(key) ?? []).filter(timestamp => now - timestamp < windowMs)
      if (recent.length >= limit) {
        buckets.set(key, recent)
        return false
      }
      recent.push(now)
      buckets.set(key, recent)
      return true
    },
    reset() {
      buckets.clear()
    },
  }
}

export function rateLimitKey(kind: string, subject: string): string {
  return `${kind}:${subject}`
}

export type ExpeditionRateSubject = {
  readonly path: string
  readonly wallet?: string
  readonly installIdHash?: string | null
  readonly sessionHash?: string
}

export function assertExpeditionRateLimit(
  limiter: RateLimiter,
  subject: ExpeditionRateSubject,
  fail: () => never,
): void {
  const windowMs = RATE_LIMIT_WINDOW_MS
  const checks: Array<{ key: string; limit: number }> = []
  if (subject.path === '/api/expeditions/start-challenge') {
    if (subject.wallet) checks.push({ key: rateLimitKey('start-challenge-wallet', subject.wallet), limit: START_CHALLENGE_WALLET_LIMIT })
    if (subject.installIdHash) checks.push({ key: rateLimitKey('start-challenge-install', subject.installIdHash), limit: START_CHALLENGE_INSTALL_LIMIT })
  } else if (subject.path === '/api/wallet/recover-challenge') {
    if (subject.wallet) checks.push({ key: rateLimitKey('recovery-challenge-wallet', subject.wallet), limit: RECOVERY_CHALLENGE_WALLET_LIMIT })
    if (subject.installIdHash) checks.push({ key: rateLimitKey('recovery-challenge-install', subject.installIdHash), limit: RECOVERY_CHALLENGE_INSTALL_LIMIT })
  } else if (subject.path === '/api/rewards/claim/prepare') {
    if (subject.sessionHash) checks.push({ key: rateLimitKey('claim-prepare-session', subject.sessionHash), limit: CLAIM_SESSION_LIMIT })
    if (subject.installIdHash) checks.push({ key: rateLimitKey('claim-prepare-install', subject.installIdHash), limit: CLAIM_INSTALL_LIMIT })
  } else if (subject.path === '/api/rewards/claim/finalize') {
    if (subject.sessionHash) checks.push({ key: rateLimitKey('claim-finalize-session', subject.sessionHash), limit: CLAIM_SESSION_LIMIT })
    if (subject.installIdHash) checks.push({ key: rateLimitKey('claim-finalize-install', subject.installIdHash), limit: CLAIM_INSTALL_LIMIT })
  }
  for (const check of checks) {
    if (!limiter.take(check.key, check.limit, windowMs)) fail()
  }
}
