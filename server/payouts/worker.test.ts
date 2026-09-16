import { describe, expect, it } from 'vitest'
import { createFakeTreasury } from './fakeTreasury.ts'
import { createMemoryPayoutStore } from './store.ts'
import { preparePayoutsWithoutBroadcast, runPayoutWorker } from './worker.ts'

const CLAIM = {
  claimId: '11111111-1111-1111-1111-111111111111',
  runId: '22222222-2222-2222-2222-222222222222',
  wallet: 'NQ07 TEST RECI PIEN T000 0000 0000 0000 0000',
  dayKey: '2026-09-16',
  status: 'RESERVED',
  publicKey: 'pk',
  signature: 'sig',
  finalizedAt: '2026-09-16T12:00:00.000Z',
}

describe('payout worker mainnet guard', () => {
  it('refuses mainnet broadcast even when the enable flag is set', async () => {
    await expect(runPayoutWorker({
      store: createMemoryPayoutStore(),
      treasury: createFakeTreasury({ network: 'mainnet' }),
      config: { network: 'mainnet', mainnetEnabled: true, amountLuna: 10000n },
    })).rejects.toMatchObject({ code: 'PAYOUT_MAINNET_DISABLED' })
  })

  it('creates a pending payout without acquiring or broadcasting', async () => {
    const store = createMemoryPayoutStore()
    store.seedClaim(CLAIM)
    const first = await preparePayoutsWithoutBroadcast({
      store,
      config: { network: 'mainnet', mainnetEnabled: true, amountLuna: 10000n },
      claimId: CLAIM.claimId,
    })
    const retry = await preparePayoutsWithoutBroadcast({
      store,
      config: { network: 'mainnet', mainnetEnabled: true, amountLuna: 10000n },
      claimId: CLAIM.claimId,
    })
    expect(first).toHaveLength(1)
    expect(retry).toHaveLength(1)
    expect(retry[0]?.payoutId).toBe(first[0]?.payoutId)
    expect(first[0]).toMatchObject({
      claimId: CLAIM.claimId,
      amountLuna: 10000n,
      network: 'mainnet',
      status: 'PENDING',
      txHash: null,
      attemptCount: 0,
    })
    expect(await store.acquire()).not.toBeNull()
  })
})
