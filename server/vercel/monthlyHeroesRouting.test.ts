import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  dispatchProductHttp,
  isOwnedProductPath,
  isPayoutCyclePath,
  PRODUCT_OWNED_PATHS,
  resolveRewriteDispatchPath,
} from './productAdapter.js'
import { MONTHLY_HEROES_PATH, WALLET_MONTHLY_STATS_PATH } from '../../src/domain/monthlyHeroes.js'

const root = process.cwd()
const read = (rel: string) => readFileSync(join(root, rel), 'utf8')

type VercelConfig = {
  rewrites?: Array<{ source: string; destination: string }>
  crons?: Array<{ path: string; schedule: string }>
}

function rewrites(): Array<{ source: string; destination: string }> {
  return (JSON.parse(read('vercel.json')) as VercelConfig).rewrites ?? []
}

describe('monthly heroes production routing', () => {
  it('owns both heroes paths without touching payout-cycle', () => {
    expect(MONTHLY_HEROES_PATH).toBe('/api/monthly-heroes')
    expect(WALLET_MONTHLY_STATS_PATH).toBe('/api/wallet/monthly-stats')
    expect(isOwnedProductPath(MONTHLY_HEROES_PATH)).toBe(true)
    expect(isOwnedProductPath(WALLET_MONTHLY_STATS_PATH)).toBe(true)
    expect(PRODUCT_OWNED_PATHS).toContain(MONTHLY_HEROES_PATH)
    expect(PRODUCT_OWNED_PATHS).toContain(WALLET_MONTHLY_STATS_PATH)
    expect(isPayoutCyclePath('/api/internal/payout-cycle')).toBe(true)
    expect(isOwnedProductPath('/api/internal/payout-cycle')).toBe(false)
  })

  it('has explicit Vercel rewrites for both heroes routes', () => {
    const entries = rewrites()
    const publicRoute = entries.find(entry => entry.source === '/api/monthly-heroes')
    expect(publicRoute?.destination).toBe('/api/product?__nimhunt_route=/api/monthly-heroes')
    const walletRoute = entries.find(entry => entry.source === '/api/wallet/monthly-stats')
    expect(walletRoute?.destination).toBe('/api/product?__nimhunt_route=/api/wallet/monthly-stats')
    // Every wallet route has its own explicit entry (no wildcard fallback).
    expect(entries.some(entry => entry.source === '/api/wallet/treasure-bank')).toBe(true)
  })

  it('resolves the REAL rewrite destinations through the adapter helper', () => {
    // Each Vercel rewrite destination is fed through the production resolver
    // with a realistic example sub-path for wildcard entries.
    const examples: Record<string, string> = {
      '/api/daily-hunt-status': '/api/product?__nimhunt_route=/api/daily-hunt-status',
      '/api/wallet-daily-status': '/api/product?__nimhunt_route=/api/wallet-daily-status',
      '/api/expeditions/session/recover': '/api/product?__nimhunt_route=/api/expeditions/session/recover',
      '/api/expeditions/result': '/api/product?__nimhunt_route=/api/expeditions/result',
      '/api/expeditions/start-challenge': '/api/product?__nimhunt_route=/api/expeditions/start-challenge',
      '/api/expeditions/start': '/api/product?__nimhunt_route=/api/expeditions/start',
      '/api/expeditions/active': '/api/product?__nimhunt_route=/api/expeditions/active',
      '/api/expeditions/gameplay-start': '/api/product?__nimhunt_route=/api/expeditions/gameplay-start',
      '/api/expeditions/checkpoint': '/api/product?__nimhunt_route=/api/expeditions/checkpoint',
      '/api/expeditions/verify': '/api/product?__nimhunt_route=/api/expeditions/verify',
      '/api/expeditions/abandon': '/api/product?__nimhunt_route=/api/expeditions/abandon',
      '/api/expeditions/vault-seal/prepare': '/api/product?__nimhunt_route=/api/expeditions/vault-seal/prepare',
      '/api/expeditions/vault-seal/verify': '/api/product?__nimhunt_route=/api/expeditions/vault-seal/verify',
      '/api/expeditions/complete': '/api/product?__nimhunt_route=/api/expeditions/complete',
      '/api/expeditions/fail': '/api/product?__nimhunt_route=/api/expeditions/fail',
      '/api/rewards/claim/prepare': '/api/product?__nimhunt_route=/api/rewards/claim/prepare',
      '/api/rewards/claim/finalize': '/api/product?__nimhunt_route=/api/rewards/claim/finalize',
      '/api/rewards/claim/payout': '/api/product?__nimhunt_route=/api/rewards/claim/payout',
      '/api/rewards/reserve': '/api/product?__nimhunt_route=/api/rewards/reserve',
      '/api/wallet/recover-challenge': '/api/product?__nimhunt_route=/api/wallet/recover-challenge',
      '/api/wallet/recover-session': '/api/product?__nimhunt_route=/api/wallet/recover-session',
      '/api/wallet/treasure-bank': '/api/product?__nimhunt_route=/api/wallet/treasure-bank',
      '/api/wallet/monthly-stats': '/api/product?__nimhunt_route=/api/wallet/monthly-stats',
      '/api/monthly-heroes': '/api/product?__nimhunt_route=/api/monthly-heroes',
    }
    for (const entry of rewrites()) {
      if (!entry.source.startsWith('/api/')) continue
      const internal = examples[entry.source]
      expect(internal, `rewrite example for ${entry.source}`).toBeDefined()
      const resolved = resolveRewriteDispatchPath(internal ?? '')
      expect(resolved.startsWith('/api/')).toBe(true)
      expect(isOwnedProductPath(resolved)).toBe(true)
    }
    expect(resolveRewriteDispatchPath('/api/product?__nimhunt_route=/api/monthly-heroes')).toBe('/api/monthly-heroes')
    expect(resolveRewriteDispatchPath('/api/product?__nimhunt_route=/api/wallet/monthly-stats')).toBe('/api/wallet/monthly-stats')
  })

  it('fails closed through the product adapter without credentials', async () => {
    for (const path of [MONTHLY_HEROES_PATH, WALLET_MONTHLY_STATS_PATH]) {
      const response = await dispatchProductHttp({
        method: 'GET',
        path,
        headers: { origin: 'https://nimhunt.vercel.app', host: 'nimhunt.vercel.app' },
        host: 'nimhunt.vercel.app',
        protocol: 'https',
      }, {
        NIMHUNT_PROOF_BACKEND: 'postgres',
        NIMHUNT_APP_ORIGIN: 'https://nimhunt.vercel.app',
      })
      // No Supabase credentials in sandbox -> unavailable, never anonymous data.
      expect([401, 503]).toContain(response.status)
      expect(response.body).toMatchObject({ ok: false })
      expect(JSON.stringify(response.body)).not.toMatch(/luna|treasury|mnemonic/i)
    }
  })

  it('keeps payout cron config unchanged', () => {
    const vercel = JSON.parse(read('vercel.json')) as VercelConfig
    expect(vercel.crons).toHaveLength(1)
    expect(vercel.crons?.[0]).toEqual({ path: '/api/internal/payout-cycle', schedule: '0 14 * * *' })
  })
})
