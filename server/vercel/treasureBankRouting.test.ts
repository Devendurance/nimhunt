import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  dispatchProductHttp,
  isOwnedProductPath,
  isPayoutCyclePath,
  PRODUCT_OWNED_PATHS,
} from './productAdapter.js'
import { TREASURE_BANK_PATH, parseTreasureBankResponse } from '../../src/domain/treasureBank.js'

const root = process.cwd()
const read = (rel: string) => readFileSync(join(root, rel), 'utf8')

describe('treasure bank production routing', () => {
  it('is a wallet-owned product route without touching payout-cycle', () => {
    expect(TREASURE_BANK_PATH).toBe('/api/wallet/treasure-bank')
    expect(isOwnedProductPath(TREASURE_BANK_PATH)).toBe(true)
    expect(PRODUCT_OWNED_PATHS).toContain(TREASURE_BANK_PATH)
    expect(isPayoutCyclePath('/api/internal/payout-cycle')).toBe(true)
    expect(isOwnedProductPath('/api/internal/payout-cycle')).toBe(false)
  })

  it('is covered by an explicit Vercel rewrite (no wildcard)', () => {
    const vercel = JSON.parse(read('vercel.json')) as {
      rewrites?: Array<{ source: string; destination: string }>
    }
    const treasure = (vercel.rewrites ?? []).find(entry => entry.source === '/api/wallet/treasure-bank')
    expect(treasure).toBeDefined()
    expect(treasure?.destination).toBe('/api/product?__nimhunt_route=/api/wallet/treasure-bank')
  })

  it('fails closed through the product adapter without credentials', async () => {
    const response = await dispatchProductHttp({
      method: 'GET',
      path: TREASURE_BANK_PATH,
      headers: { origin: 'https://nimhunt.vercel.app', host: 'nimhunt.vercel.app' },
      host: 'nimhunt.vercel.app',
      protocol: 'https',
    }, {
      NIMHUNT_PROOF_BACKEND: 'postgres',
      NIMHUNT_APP_ORIGIN: 'https://nimhunt.vercel.app',
    })
    // No Supabase credentials in sandbox -> service unavailable, never anonymous data.
    expect([401, 503]).toContain(response.status)
    expect(response.body).toMatchObject({ ok: false })
    expect(JSON.stringify(response.body)).not.toMatch(/luna|treasury|mnemonic/i)
  })

  it('keeps payout cron config unchanged', () => {
    const vercel = JSON.parse(read('vercel.json')) as {
      crons?: Array<{ path: string; schedule: string }>
    }
    expect(vercel.crons).toHaveLength(1)
    expect(vercel.crons?.[0]).toEqual({ path: '/api/internal/payout-cycle', schedule: '0 14 * * *' })
  })
})

describe('treasure bank response contract', () => {
  it('parses the wallet-scoped summary without Luna or internal enums', () => {
    const parsed = parseTreasureBankResponse({
      ok: true,
      pendingNim: 200,
      deliveredNim: 400,
      lifetimeEarnedNim: 600,
      pendingCount: 2,
      deliveredCount: 1,
      rewards: [
        { rewardDay: '2026-09-18', mission: 'gem-runner', missionLabel: 'Gem Runner', amountNim: 100, status: 'SECURED', txHash: null },
        { rewardDay: '2026-09-17', mission: 'chest-hunter', missionLabel: 'Chest Hunter', amountNim: 100, status: 'SECURED', txHash: null },
        { rewardDay: '2026-09-16', mission: 'vault-breaker', missionLabel: 'Vault Breaker', amountNim: 400, status: 'DELIVERED', txHash: 'ab'.repeat(32) },
      ],
    })
    expect(parsed?.lifetimeEarnedNim).toBe(600)
    expect(JSON.stringify(parsed)).not.toMatch(/luna|RESERVED|CONFIRMED/i)
  })

  it('rejects Luna leakage and tx hashes on secured rewards', () => {
    expect(parseTreasureBankResponse({
      ok: true,
      pendingNim: 100,
      deliveredNim: 0,
      lifetimeEarnedNim: 100,
      pendingCount: 1,
      deliveredCount: 0,
      rewards: [
        { rewardDay: '2026-09-18', mission: 'gem-runner', missionLabel: 'Gem Runner', amountNim: 100, status: 'SECURED', txHash: 'ab'.repeat(32) },
      ],
    })).toBeNull()
    expect(parseTreasureBankResponse({
      ok: true,
      pendingNim: 100,
      deliveredNim: 0,
      lifetimeEarnedNim: 100,
      pendingCount: 1,
      deliveredCount: 0,
      rewards: [{ rewardDay: '2026-09-18', mission: 'gem-runner', missionLabel: 'Gem Runner', amountNim: 100, status: 'SECURED', txHash: null, amountLuna: '10000000' }],
    })).toBeNull()
  })
})
