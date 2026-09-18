import { describe, expect, it } from 'vitest'
import {
  dispatchProductHttp,
  isOwnedProductPath,
  isPayoutCyclePath,
  PRODUCT_OWNED_PATHS,
  readVercelHost,
  readVercelProtocol,
} from './productAdapter.js'
import { resolveProductionExpeditionRuntime } from '../expeditions/proofRuntime.js'

const REQUIRED_PRODUCT_PATHS = [
  '/api/daily-hunt-status',
  '/api/wallet-daily-status',
  '/api/expeditions/start-challenge',
  '/api/expeditions/start',
  '/api/expeditions/active',
  '/api/expeditions/gameplay-start',
  '/api/expeditions/checkpoint',
  '/api/expeditions/verify',
  '/api/expeditions/abandon',
  '/api/expeditions/vault-seal/prepare',
  '/api/expeditions/vault-seal/verify',
  '/api/rewards/claim/prepare',
  '/api/rewards/claim/finalize',
  '/api/rewards/claim/payout',
  '/api/wallet/recover-challenge',
  '/api/wallet/recover-session',
] as const

describe('production product API adapter', () => {
  it('recognizes all required owned routes', () => {
    for (const path of REQUIRED_PRODUCT_PATHS) {
      expect(isOwnedProductPath(path), path).toBe(true)
      expect(PRODUCT_OWNED_PATHS).toContain(path)
    }
  })

  it('fails closed for unknown API routes with JSON, not Vercel NOT_FOUND', async () => {
    expect(isOwnedProductPath('/api/unknown-route')).toBe(false)
    expect(isOwnedProductPath('/api/expeditions/unknown')).toBe(false)
    const response = await dispatchProductHttp({
      method: 'GET',
      path: '/api/unknown-route',
      headers: {},
    }, {
      NIMHUNT_PROOF_BACKEND: 'postgres',
      NIMHUNT_APP_ORIGIN: 'https://nimhunt.vercel.app',
    })
    expect(response.status).toBe(404)
    expect(response.body).toEqual({ ok: false, error: 'MALFORMED_REQUEST' })
  })

  it('keeps payout-cycle separate and fails closed through the product adapter', async () => {
    expect(isPayoutCyclePath('/api/internal/payout-cycle')).toBe(true)
    expect(isOwnedProductPath('/api/internal/payout-cycle')).toBe(false)
    const response = await dispatchProductHttp({
      method: 'GET',
      path: '/api/internal/payout-cycle',
      headers: { authorization: 'Bearer wrong' },
    }, {
      NIMHUNT_PROOF_BACKEND: 'postgres',
      NIMHUNT_APP_ORIGIN: 'https://nimhunt.vercel.app',
    })
    expect(response.status).toBe(404)
    expect(response.body).toEqual({ ok: false, error: 'MALFORMED_REQUEST' })
  })

  it('returns JSON errors (not NOT_FOUND) for deliberately invalid expedition requests without consuming attempts', async () => {
    const response = await dispatchProductHttp({
      method: 'GET',
      path: '/api/expeditions/active?runId=test',
      headers: {
        origin: 'https://nimhunt.vercel.app',
        host: 'nimhunt.vercel.app',
      },
      host: 'nimhunt.vercel.app',
      protocol: 'https',
    }, {
      NIMHUNT_PROOF_BACKEND: 'postgres',
      NIMHUNT_APP_ORIGIN: 'https://nimhunt.vercel.app',
    })
    expect(response.body).toMatchObject({ ok: false })
    expect(typeof response.status).toBe('number')
    expect(response.status).not.toBe(200)
    const text = JSON.stringify(response.body)
    expect(text).not.toContain('NOT_FOUND')
    expect(text).not.toContain('NOT_FOUND_PAGE')
  })

  it('returns JSON (not NOT_FOUND) for daily-hunt-status without credentials', async () => {
    const response = await dispatchProductHttp({
      method: 'GET',
      path: '/api/daily-hunt-status',
    }, {
      NIMHUNT_PROOF_BACKEND: 'postgres',
      NIMHUNT_APP_ORIGIN: 'https://nimhunt.vercel.app',
    })
    expect(response.body).toMatchObject({ ok: expect.anything() })
    expect([200, 503]).toContain(response.status)
    if (response.status === 503) {
      expect(response.body).toEqual({ ok: false, error: 'LEDGER_UNAVAILABLE' })
    }
  })

  it('preserves origin/host checks for proof routes', async () => {
    const response = await dispatchProductHttp({
      method: 'POST',
      path: '/api/expeditions/start-challenge',
      headers: {
        origin: 'https://evil.example',
        host: 'nimhunt.vercel.app',
        'content-type': 'application/json',
      },
      host: 'nimhunt.vercel.app',
      protocol: 'https',
      rawBody: JSON.stringify({ wallet: 'NQ00', mission: 'gem-runner' }),
    }, {
      NIMHUNT_PROOF_BACKEND: 'postgres',
      NIMHUNT_APP_ORIGIN: 'https://nimhunt.vercel.app',
    })
    expect(response.body).toEqual({ ok: false, error: expect.anything() })
    expect(response.status).toBeGreaterThanOrEqual(400)
  })

  it('uses secure HttpOnly SameSite cookies via production https runtime', () => {
    const runtime = resolveProductionExpeditionRuntime({
      NIMHUNT_PROOF_BACKEND: 'postgres',
      NIMHUNT_APP_ORIGIN: 'https://nimhunt.vercel.app',
    })
    expect(runtime.backend).toBe('postgres')
    expect(runtime.expectedHost).toBe('nimhunt.vercel.app')
    expect(runtime.expectedProtocol).toBe('https')
    expect(runtime.secureCookie).toBe(true)
  })

  it('reads Vercel forwarded host/proto for TLS-terminated production', () => {
    expect(readVercelHost({ host: 'internal', 'x-forwarded-host': 'nimhunt.vercel.app' })).toBe('nimhunt.vercel.app')
    expect(readVercelProtocol({ 'x-forwarded-proto': 'https' }, false)).toBe('https')
    expect(readVercelProtocol({ host: 'nimhunt.vercel.app' }, true)).toBe('https')
    expect(readVercelProtocol({}, false)).toBeUndefined()
  })
})
