import { describe, expect, it } from 'vitest'
import { resolveExpeditionRuntime } from './vitePlugin.ts'

describe('expedition proof runtime policy', () => {
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
    })
  })

  it('allows memory proof in test mode', () => {
    expect(resolveExpeditionRuntime({
      mode: 'test',
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
    })).toMatchObject({ backend: 'memory', secureCookie: false })
    expect(resolveExpeditionRuntime({
      mode: 'test',
      backend: 'memory',
      appOrigin: 'http://hunt.example',
    })).toMatchObject({ backend: 'memory', secureCookie: true })
  })
})
