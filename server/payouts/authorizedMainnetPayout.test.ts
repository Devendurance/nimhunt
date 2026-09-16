import { describe, expect, it } from 'vitest'
import {
  AUTHORIZED_MAINNET_PAYOUT,
  evaluateAuthorizedMainnetBroadcastGate,
  runAuthorizedMainnetPayoutOnce,
} from './authorizedMainnetPayout.ts'
import { createFakeTreasury } from './fakeTreasury.ts'
import { createMemoryPayoutStore } from './store.ts'
import { runPayoutWorker } from './worker.ts'

const CONFIG = {
  network: 'mainnet' as const,
  mainnetEnabled: true,
  amountLuna: 10_000n,
}

function seedAuthorized(store: ReturnType<typeof createMemoryPayoutStore>) {
  store.seedClaim({
    claimId: '40891624-0000-0000-0000-000000000001',
    runId: '22222222-2222-2222-2222-222222222222',
    wallet: AUTHORIZED_MAINNET_PAYOUT.recipient,
    dayKey: '2026-09-16',
    status: 'RESERVED',
    publicKey: 'pk',
    signature: 'sig',
    finalizedAt: '2026-09-16T12:00:00.000Z',
  })
}

describe('authorized mainnet payout once', () => {
  it('keeps the bulk worker refuse-closed on mainnet', async () => {
    await expect(runPayoutWorker({
      store: createMemoryPayoutStore(),
      treasury: createFakeTreasury({ network: 'mainnet', address: AUTHORIZED_MAINNET_PAYOUT.treasury }),
      config: CONFIG,
    })).rejects.toMatchObject({ code: 'PAYOUT_MAINNET_DISABLED' })
  })

  it('stops without sending when any live gate fails', async () => {
    const store = createMemoryPayoutStore()
    seedAuthorized(store)
    const created = await store.create({
      claimId: '40891624-0000-0000-0000-000000000001',
      payoutId: AUTHORIZED_MAINNET_PAYOUT.payoutId,
      amountLuna: 10_000n,
      network: 'mainnet',
    })
    const treasury = createFakeTreasury({
      network: 'mainnet',
      address: AUTHORIZED_MAINNET_PAYOUT.treasury,
      balance: 5_000n,
    })
    const result = await runAuthorizedMainnetPayoutOnce({
      store,
      treasury,
      config: CONFIG,
      claimStatus: 'RESERVED',
      claimWallet: AUTHORIZED_MAINNET_PAYOUT.recipient,
      treasuryBalanceLuna: 5_000n,
    })
    expect(result.action).toBe('stopped')
    expect(result.sent).toBe(false)
    expect(result.gate.ok).toBe(false)
    expect(result.gate.failures).toContain('treasury_balance_insufficient')
    expect(treasury.submitted).toHaveLength(0)
    expect((await store.get(created.payout.payoutId)).status).toBe('PENDING')
  })

  it('broadcasts the authorized payout once and does not resend on rerun', async () => {
    const store = createMemoryPayoutStore()
    seedAuthorized(store)
    await store.create({
      claimId: '40891624-0000-0000-0000-000000000001',
      payoutId: AUTHORIZED_MAINNET_PAYOUT.payoutId,
      amountLuna: 10_000n,
      network: 'mainnet',
    })
    const treasury = createFakeTreasury({
      network: 'mainnet',
      address: AUTHORIZED_MAINNET_PAYOUT.treasury,
      balance: 50_000n,
    })
    const first = await runAuthorizedMainnetPayoutOnce({
      store,
      treasury,
      config: CONFIG,
      claimStatus: 'RESERVED',
      claimWallet: AUTHORIZED_MAINNET_PAYOUT.recipient,
      treasuryBalanceLuna: 50_000n,
    })
    expect(first.action).toBe('broadcast')
    expect(first.sent).toBe(true)
    expect(first.payout.status).toBe('CONFIRMED')
    expect(first.payout.payoutId).toBe(AUTHORIZED_MAINNET_PAYOUT.payoutId)
    expect(treasury.submitted).toHaveLength(1)
    expect(treasury.submitted[0]?.recipient).toBe(AUTHORIZED_MAINNET_PAYOUT.recipient)
    expect(treasury.submitted[0]?.amountLuna).toBe(10_000n)
    expect(Buffer.from(treasury.submitted[0]?.extraData ?? new Uint8Array()).toString())
      .toBe(`NIMHUNT_PAYOUT:${AUTHORIZED_MAINNET_PAYOUT.payoutId}`)

    const second = await runAuthorizedMainnetPayoutOnce({
      store,
      treasury,
      config: CONFIG,
      claimStatus: 'RESERVED',
      claimWallet: AUTHORIZED_MAINNET_PAYOUT.recipient,
      treasuryBalanceLuna: 40_000n,
    })
    expect(second.action).toBe('reconcile-only')
    expect(second.sent).toBe(false)
    expect(second.payout.status).toBe('CONFIRMED')
    expect(treasury.submitted).toHaveLength(1)
  })

  it('requires the exact authorized recipient, amount, and treasury', () => {
    const payout = {
      payoutId: AUTHORIZED_MAINNET_PAYOUT.payoutId,
      claimId: '40891624-0000-0000-0000-000000000001',
      runId: '22222222-2222-2222-2222-222222222222',
      wallet: AUTHORIZED_MAINNET_PAYOUT.recipient,
      dayKey: '2026-09-16',
      amountLuna: 10_000n,
      network: 'mainnet' as const,
      status: 'PENDING' as const,
      attemptCount: 0,
      txHash: null,
      failureCode: null,
      failureMessageSafe: null,
      createdAt: '2026-09-16T12:00:00.000Z',
      processingStartedAt: null,
      submittedAt: null,
      confirmedAt: null,
      updatedAt: '2026-09-16T12:00:00.000Z',
    }
    expect(evaluateAuthorizedMainnetBroadcastGate({
      payout,
      claimStatus: 'RESERVED',
      claimWallet: AUTHORIZED_MAINNET_PAYOUT.recipient,
      treasuryAddress: AUTHORIZED_MAINNET_PAYOUT.treasury,
      treasuryBalanceLuna: 10_000n,
      mainnetEnabled: true,
      eligiblePayoutIds: [AUTHORIZED_MAINNET_PAYOUT.payoutId],
    }).ok).toBe(true)
    expect(evaluateAuthorizedMainnetBroadcastGate({
      payout: { ...payout, status: 'SUBMITTED', txHash: 'ab'.repeat(32), attemptCount: 1 },
      claimStatus: 'RESERVED',
      claimWallet: AUTHORIZED_MAINNET_PAYOUT.recipient,
      treasuryAddress: AUTHORIZED_MAINNET_PAYOUT.treasury,
      treasuryBalanceLuna: 10_000n,
      mainnetEnabled: true,
      eligiblePayoutIds: [],
    }).ok).toBe(false)
  })
})
