import { describe, expect, it } from 'vitest'
import { formatNimFromLuna, payoutStatusCopy, type ProductPayoutView } from './productPayoutStatus.ts'

const hash = 'ab'.repeat(32)

function view(overrides: Partial<ProductPayoutView> = {}): ProductPayoutView {
  return {
    status: 'PENDING',
    payoutId: null,
    claimId: 'claim-1',
    amountLuna: null,
    network: null,
    txHashSafe: null,
    submittedAt: null,
    confirmedAt: null,
    ...overrides,
  }
}

describe('payout status copy', () => {
  it('uses reserved copy for pending, processing, and missing payouts', () => {
    for (const status of ['PENDING', 'PROCESSING'] as const) {
      expect(payoutStatusCopy(view({ status }))).toEqual({
        title: 'TREASURE RESERVED',
        lines: ['Your treasure is reserved and waiting for payout.'],
        amountLabel: null,
        txHashShort: null,
        verified: false,
      })
    }
    expect(payoutStatusCopy(null).title).toBe('TREASURE RESERVED')
  })

  it('shows submitted copy and a shortened tx hash', () => {
    expect(payoutStatusCopy(view({ status: 'SUBMITTED', txHashSafe: hash }))).toEqual({
      title: 'PAYOUT SUBMITTED',
      lines: ['Your NIM reward was submitted to the network.'],
      amountLabel: null,
      txHashShort: 'abababab…',
      verified: false,
    })
  })

  it('shows treasure delivered with amount, shortened hash, and verified mark', () => {
    expect(payoutStatusCopy(view({
      status: 'CONFIRMED',
      amountLuna: '10000',
      txHashSafe: 'cd'.repeat(32),
    }))).toEqual({
      title: 'TREASURE DELIVERED',
      lines: ['Your NIM reward was confirmed on-chain.'],
      amountLabel: '0.1 NIM',
      txHashShort: 'cdcdcdcd…',
      verified: true,
    })
    expect(payoutStatusCopy(view({
      status: 'CONFIRMED',
      amountLuna: '10000',
      txHashSafe: 'c58022f37ed7352f41c29ef9862297a9cfa8c45593456395d7a6eb7a68009ff6',
    }))).toEqual({
      title: 'TREASURE DELIVERED',
      lines: ['Your NIM reward was confirmed on-chain.'],
      amountLabel: '0.1 NIM',
      txHashShort: 'c58022f3…',
      verified: true,
    })
  })

  it('keeps the reservation safe on retryable and final failure', () => {
    expect(payoutStatusCopy(view({ status: 'FAILED_RETRYABLE' })).lines).toEqual([
      'Your reservation is safe. Payout is being retried safely.',
    ])
    expect(payoutStatusCopy(view({ status: 'FAILED_FINAL' })).lines).toEqual([
      'Your reservation is safe. Payout needs review.',
    ])
  })

  it('never tells the player to replay the expedition', () => {
    const texts = ['PENDING', 'PROCESSING', 'SUBMITTED', 'FAILED_RETRYABLE', 'FAILED_FINAL', 'CONFIRMED'].flatMap(status => {
      const copy = payoutStatusCopy(view({
        status: status as ProductPayoutView['status'],
        amountLuna: '10000',
        txHashSafe: status === 'SUBMITTED' || status === 'CONFIRMED' ? hash : null,
      }))
      return [copy.title, ...copy.lines, copy.amountLabel, copy.txHashShort, copy.verified ? 'Verified ✓' : '']
    }).join(' ')
    expect(texts).not.toMatch(/replay|play again|try the expedition again/i)
  })

  it('formats luna as NIM without floats', () => {
    expect(formatNimFromLuna(10_000n)).toBe('0.1 NIM')
    expect(formatNimFromLuna('100000')).toBe('1 NIM')
    expect(formatNimFromLuna(100_000_000n)).toBe('1000 NIM')
  })
})
