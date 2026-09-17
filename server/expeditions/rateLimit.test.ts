import { describe, expect, it } from 'vitest'
import { createRateLimiter, START_CHALLENGE_WALLET_LIMIT } from './rateLimit.ts'

describe('request rate limiter', () => {
  it('allows normal human volume and returns RATE_LIMITED only after a conservative burst', () => {
    let now = 1_000
    const limiter = createRateLimiter(() => now)
    for (let index = 0; index < START_CHALLENGE_WALLET_LIMIT; index += 1) {
      expect(limiter.take('start:wallet:a', START_CHALLENGE_WALLET_LIMIT, 10 * 60_000)).toBe(true)
    }
    expect(limiter.take('start:wallet:a', START_CHALLENGE_WALLET_LIMIT, 10 * 60_000)).toBe(false)
    expect(limiter.take('start:wallet:b', START_CHALLENGE_WALLET_LIMIT, 10 * 60_000)).toBe(true)
    now += 10 * 60_000
    expect(limiter.take('start:wallet:a', START_CHALLENGE_WALLET_LIMIT, 10 * 60_000)).toBe(true)
  })
})
