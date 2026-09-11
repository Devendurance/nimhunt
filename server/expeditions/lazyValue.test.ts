import { describe, expect, it } from 'vitest'
import { createLazyValue } from './lazyValue.ts'

describe('createLazyValue', () => {
  it('initializes exactly once across concurrent callers', async () => {
    let running = 0
    let maxRunning = 0
    let created = 0
    const lazy = createLazyValue(async () => {
      created += 1
      running += 1
      maxRunning = Math.max(maxRunning, running)
      await new Promise(resolve => setTimeout(resolve, 20))
      running -= 1
      return 'ready'
    })

    const [first, second, third] = await Promise.all([lazy.ensure(), lazy.ensure(), lazy.ensure()])

    expect(first).toBe('ready')
    expect(second).toBe('ready')
    expect(third).toBe('ready')
    expect(created).toBe(1)
    expect(maxRunning).toBe(1)
    expect(lazy.initCount()).toBe(1)
    expect(lazy.peek()).toBe('ready')
  })

  it('retries after a failed initialization', async () => {
    let created = 0
    const lazy = createLazyValue(() => {
      created += 1
      if (created === 1) throw new Error('init-failed')
      return 'ok'
    })

    await expect(lazy.ensure()).rejects.toThrow('init-failed')
    expect(lazy.peek()).toBeUndefined()
    expect(await lazy.ensure()).toBe('ok')
    expect(created).toBe(2)
    expect(lazy.initCount()).toBe(2)
  })
})
