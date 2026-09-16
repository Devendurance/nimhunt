import { describe, expect, it } from 'vitest'
import {
  createDefaultProofService,
  createProofBackendLoader,
  isOwnedExpeditionPath,
  resolveExpeditionRuntime,
} from './vitePlugin.ts'
import type { MemoryProofService } from './types.ts'

describe('expedition proof runtime policy', () => {
  it('owns every proof HTTP path including product checkpoint', () => {
    expect(isOwnedExpeditionPath('/api/expeditions/start-challenge')).toBe(true)
    expect(isOwnedExpeditionPath('/api/expeditions/start')).toBe(true)
    expect(isOwnedExpeditionPath('/api/expeditions/active')).toBe(true)
    expect(isOwnedExpeditionPath('/api/expeditions/gameplay-start')).toBe(true)
    expect(isOwnedExpeditionPath('/api/expeditions/checkpoint')).toBe(true)
    expect(isOwnedExpeditionPath('/api/expeditions/verify')).toBe(true)
    expect(isOwnedExpeditionPath('/api/expeditions/abandon')).toBe(true)
    expect(isOwnedExpeditionPath('/api/expeditions/vault-seal/prepare')).toBe(true)
    expect(isOwnedExpeditionPath('/api/expeditions/vault-seal/verify')).toBe(true)
    expect(isOwnedExpeditionPath('/api/expeditions/vault-seal')).toBe(false)
    expect(isOwnedExpeditionPath('/api/wallet-daily-status')).toBe(true)
    expect(isOwnedExpeditionPath('/api/wallet/recover-challenge')).toBe(true)
    expect(isOwnedExpeditionPath('/api/wallet/recover-session')).toBe(true)
    expect(isOwnedExpeditionPath('/api/rewards/claim/prepare')).toBe(true)
    expect(isOwnedExpeditionPath('/api/rewards/claim/finalize')).toBe(true)
    expect(isOwnedExpeditionPath('/api/rewards/claim/payout')).toBe(true)
    expect(isOwnedExpeditionPath('/api/rewards/prepare')).toBe(false)
    expect(isOwnedExpeditionPath('/api/rewards/claim')).toBe(false)
  })

  it('enables memory proof only for explicit local development', () => {
    expect(resolveExpeditionRuntime({
      mode: 'development',
      backend: 'memory',
      appOrigin: 'http://localhost:5173',
    })).toMatchObject({
      backend: 'memory',
      appOrigin: 'http://localhost:5173',
      expectedHost: 'localhost:5173',
      expectedProtocol: 'http',
      secureCookie: false,
      allowAuthorizedLocalHttpOrigins: true,
    })
  })

  it('allows memory proof in test mode', () => {
    expect(resolveExpeditionRuntime({
      mode: 'test',
      backend: 'memory',
      appOrigin: 'http://localhost:5173',
    })).toMatchObject({ backend: 'memory' })
  })

  it('enables postgres proof for development, preview, and production', () => {
    expect(resolveExpeditionRuntime({
      mode: 'development',
      backend: 'postgres',
      appOrigin: 'http://localhost:5173',
    })).toMatchObject({
      backend: 'postgres',
      secureCookie: false,
      allowAuthorizedLocalHttpOrigins: true,
    })
    expect(resolveExpeditionRuntime({
      mode: 'preview',
      backend: 'postgres',
      appOrigin: 'https://hunt.example',
    })).toMatchObject({
      backend: 'postgres',
      expectedOrigin: 'https://hunt.example',
      expectedHost: 'hunt.example',
      expectedProtocol: 'https',
      secureCookie: true,
      allowAuthorizedLocalHttpOrigins: false,
    })
    expect(resolveExpeditionRuntime({
      mode: 'production',
      backend: 'postgres',
      appOrigin: 'https://hunt.example',
    })).toMatchObject({ backend: 'postgres', secureCookie: true })
  })

  it('never treats postgres as a silent memory fallback', () => {
    expect(resolveExpeditionRuntime({
      mode: 'development',
      backend: undefined,
      appOrigin: 'http://localhost:5173',
    })).toMatchObject({ backend: 'unavailable' })
    expect(resolveExpeditionRuntime({
      mode: 'development',
      backend: 'memory',
      appOrigin: 'http://localhost:5173',
    })).toMatchObject({ backend: 'memory' })
  })

  it('fails closed for preview even when memory is configured', () => {
    expect(resolveExpeditionRuntime({
      mode: 'preview',
      backend: 'memory',
      appOrigin: 'https://hunt.example',
    })).toMatchObject({ backend: 'unavailable', secureCookie: true })
    expect(resolveExpeditionRuntime({
      mode: 'preview',
      backend: 'memory',
      appOrigin: 'https://hunt.example',
    })).toMatchObject({
      expectedOrigin: 'https://hunt.example',
      expectedHost: 'hunt.example',
      expectedProtocol: 'https',
      allowAuthorizedLocalHttpOrigins: false,
    })
  })

  it('fails closed when the backend or origin is not explicit', () => {
    expect(resolveExpeditionRuntime({
      mode: 'development',
      backend: undefined,
      appOrigin: 'http://localhost:5173',
    })).toMatchObject({ backend: 'unavailable' })
    expect(resolveExpeditionRuntime({
      mode: 'development',
      backend: 'memory',
      appOrigin: undefined,
    })).toMatchObject({ backend: 'unavailable' })
  })

  it('omits Secure only for explicit HTTP development or test origins', () => {
    expect(resolveExpeditionRuntime({
      mode: 'development',
      backend: 'memory',
      appOrigin: 'http://192.168.1.10:5173',
    })).toMatchObject({ backend: 'memory', secureCookie: false, allowAuthorizedLocalHttpOrigins: true })
    expect(resolveExpeditionRuntime({
      mode: 'test',
      backend: 'memory',
      appOrigin: 'http://hunt.example',
    })).toMatchObject({ backend: 'memory', secureCookie: true })
  })
})

describe('lazy development proof backend', () => {
  it('does not construct a memory backend for preview or production', async () => {
    let created = 0
    const createService = () => {
      created += 1
      throw new Error('memory backend must stay disabled')
    }

    const preview = createProofBackendLoader(
      () => resolveExpeditionRuntime({
        mode: 'preview',
        backend: 'memory',
        appOrigin: 'https://hunt.example',
      }),
      createService,
    )
    const production = createProofBackendLoader(
      () => resolveExpeditionRuntime({
        mode: 'production',
        backend: 'memory',
        appOrigin: 'https://hunt.example',
      }),
      createService,
    )

    expect(await preview.ensure()).toBeNull()
    expect(await production.ensure()).toBeNull()
    expect(created).toBe(0)
    expect(preview.peek()).toBeNull()
    expect(production.peek()).toBeNull()
  })

  it('initializes the development memory backend once under concurrent first requests', async () => {
    let created = 0
    const service = { id: 'memory-once' } as unknown as MemoryProofService
    const loader = createProofBackendLoader(
      () => resolveExpeditionRuntime({
        mode: 'development',
        backend: 'memory',
        appOrigin: 'http://localhost:5173',
      }),
      async () => {
        created += 1
        await new Promise(resolve => setTimeout(resolve, 20))
        return service
      },
    )

    const [first, second, third] = await Promise.all([loader.ensure(), loader.ensure(), loader.ensure()])
    expect(first).toBe(service)
    expect(second).toBe(service)
    expect(third).toBe(service)
    expect(created).toBe(1)
    expect(loader.initCount()).toBe(1)
    expect(await loader.ensure()).toBe(service)
    expect(created).toBe(1)
  })

  it('does not construct a memory backend when postgres is configured without credentials', async () => {
    let created = 0
    const loader = createProofBackendLoader(
      () => resolveExpeditionRuntime({
        mode: 'development',
        backend: 'postgres',
        appOrigin: 'http://localhost:5173',
      }),
      async () => {
        created += 1
        return null
      },
    )

    expect(await loader.ensure()).toBeNull()
    expect(created).toBe(1)
  })

  it('fails closed for postgres when supabase env is not provided', async () => {
    await expect(createDefaultProofService(
      resolveExpeditionRuntime({
        mode: 'development',
        backend: 'postgres',
        appOrigin: 'http://localhost:5173',
      }),
      {},
    )).resolves.toBeNull()
  })
})
