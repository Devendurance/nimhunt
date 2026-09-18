import { describe, expect, it } from 'vitest'
import {
  formatTreasureDay,
  missionLabel,
  parseTreasureBankResponse,
  TREASURE_BANK_PATH,
} from './domain/treasureBank.ts'

describe('treasure bank domain', () => {
  it('uses the wallet-scoped treasure bank path', () => {
    expect(TREASURE_BANK_PATH).toBe('/api/wallet/treasure-bank')
  })

  it('formats recent treasure rows without sample values', () => {
    expect(formatTreasureDay('2026-09-18')).toBe('Sep 18')
    expect(missionLabel('gem-runner')).toBe('Gem Runner')
    expect(missionLabel('vault-breaker')).toBe('Vault Breaker')
    expect('Sep 18 · Gem Runner · 100 NIM · Secured').toContain('100 NIM')
  })

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
    expect(JSON.stringify(parsed)).not.toMatch(/"RESERVED"|"CONFIRMED"/i)
  })

  it('rejects tx hashes on secured rewards', () => {
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
  })
})
