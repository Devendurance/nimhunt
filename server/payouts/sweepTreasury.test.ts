import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { formatNimFromLuna } from './config.ts'
import { PayoutError } from './errors.ts'
import { generateTreasuryMnemonic } from './generateTreasury.ts'
import { createNimiqTreasury, type SignedBasicTransfer } from './nimiqTreasury.ts'
import {
  SWEEP_LEAVE_LUNA,
  SWEEP_LEAVE_NIM,
  assertSweepRecipient,
  buildSweepPlan,
  calculateSweepSendLuna,
  formatSweepReport,
  nimToLuna,
  parseSweepArgs,
  readBasicTransferFeeLuna,
  readSweepConfig,
  runTreasurySweep,
  type SweepTransport,
} from './sweepTreasury.ts'
import { LUNA_PER_NIM, type TreasuryTransaction } from './types.ts'

const RECIPIENT = 'NQ21 8BQV KD0Y JBPY 7HXB JPY5 XBVG QSS8 6GEB'

describe('treasury sweep calculation', () => {
  it('converts 100 NIM to 10000000 Luna and subtracts the live fee', () => {
    expect(SWEEP_LEAVE_NIM).toBe(100n)
    expect(nimToLuna(100n)).toBe(10_000_000n)
    expect(SWEEP_LEAVE_LUNA).toBe(10_000_000n)
    expect(SWEEP_LEAVE_LUNA).toBe(100n * LUNA_PER_NIM)
    expect(formatNimFromLuna(SWEEP_LEAVE_LUNA)).toBe('100.00000')

    expect(calculateSweepSendLuna({
      currentBalanceLuna: 25_000_000n,
      leaveLuna: SWEEP_LEAVE_LUNA,
      feeLuna: 0n,
    })).toBe(15_000_000n)
    expect(calculateSweepSendLuna({
      currentBalanceLuna: 25_000_000n,
      leaveLuna: SWEEP_LEAVE_LUNA,
      feeLuna: 7n,
    })).toBe(14_999_993n)

    const feeLuna = readBasicTransferFeeLuna()
    expect(feeLuna).toBe(0n)
    const currentBalanceLuna = 18_431_055n
    const sendLuna = calculateSweepSendLuna({
      currentBalanceLuna,
      leaveLuna: SWEEP_LEAVE_LUNA,
      feeLuna,
    })
    expect(sendLuna).toBe(currentBalanceLuna - SWEEP_LEAVE_LUNA - feeLuna)
    expect(currentBalanceLuna - sendLuna - feeLuna).toBe(SWEEP_LEAVE_LUNA)
  })

  it('fails closed when the live balance cannot leave a positive send amount', () => {
    expect(() => calculateSweepSendLuna({
      currentBalanceLuna: SWEEP_LEAVE_LUNA,
      leaveLuna: SWEEP_LEAVE_LUNA,
      feeLuna: 0n,
    })).toThrowError(/PAYOUT_AMOUNT_INVALID/)
    expect(() => calculateSweepSendLuna({
      currentBalanceLuna: SWEEP_LEAVE_LUNA + 1n,
      leaveLuna: SWEEP_LEAVE_LUNA,
      feeLuna: 2n,
    })).toThrowError(/PAYOUT_AMOUNT_INVALID/)
    expect(() => nimToLuna(0n)).toThrowError(/PAYOUT_AMOUNT_INVALID/)
    expect(() => calculateSweepSendLuna({
      currentBalanceLuna: 20_000_000n,
      leaveLuna: 0n,
      feeLuna: 0n,
    })).toThrowError(/PAYOUT_AMOUNT_INVALID/)
  })
})

describe('treasury sweep validation', () => {
  it('rejects malformed recipients and recipient == treasury', () => {
    const treasury = generateTreasuryMnemonic().address
    expect(() => assertSweepRecipient('not-an-address', treasury)).toThrow(PayoutError)
    expect(() => assertSweepRecipient('not-an-address', treasury)).toThrowError(/WALLET_MISMATCH/)
    expect(() => assertSweepRecipient('NQ00', treasury)).toThrowError(/WALLET_MISMATCH/)
    expect(() => assertSweepRecipient(treasury, treasury)).toThrowError(/WALLET_MISMATCH/)
    expect(assertSweepRecipient(RECIPIENT, treasury)).not.toBe(treasury)
  })

  it('requires --confirm for execution and treats missing confirm as preview-only', () => {
    const preview = parseSweepArgs([
      `--recipient=${RECIPIENT}`,
      '--leave-nim=100',
    ])
    expect(preview.confirm).toBe(false)
    expect(preview.leaveNim).toBe(100n)
    expect(parseSweepArgs([
      `--recipient=${RECIPIENT}`,
      '--leave-nim=100',
      '--confirm',
    ]).confirm).toBe(true)
    expect(() => parseSweepArgs(['--leave-nim=100'])).toThrowError(/MALFORMED_REQUEST/)
    expect(() => parseSweepArgs([`--recipient=${RECIPIENT}`])).toThrowError(/MALFORMED_REQUEST/)
    expect(() => parseSweepArgs([
      `--recipient=${RECIPIENT}`,
      '--leave-nim=0',
    ])).toThrowError(/PAYOUT_AMOUNT_INVALID/)
    expect(() => parseSweepArgs([
      `--recipient=${RECIPIENT}`,
      '--leave-nim=100.5',
    ])).toThrowError(/PAYOUT_AMOUNT_INVALID/)
    expect(() => parseSweepArgs([
      `--recipient=${RECIPIENT}`,
      '--leave-nim=100',
      '--network=mainnet',
    ])).toThrowError(/MALFORMED_REQUEST/)
  })

  it('requires an explicit mainnet mnemonic and never accepts browser secrets', () => {
    const generated = generateTreasuryMnemonic()
    expect(readSweepConfig({
      NIMHUNT_PAYOUT_NETWORK: 'mainnet',
      NIMHUNT_TREASURY_MNEMONIC: generated.mnemonic,
    }).network).toBe('mainnet')
    expect(() => readSweepConfig({
      NIMHUNT_TREASURY_MNEMONIC: generated.mnemonic,
    })).toThrowError(/PAYOUT_NETWORK_INVALID/)
    expect(() => readSweepConfig({
      NIMHUNT_PAYOUT_NETWORK: 'testnet',
      NIMHUNT_TREASURY_MNEMONIC: generated.mnemonic,
    })).toThrowError(/PAYOUT_NETWORK_INVALID/)
    expect(() => readSweepConfig({
      NIMHUNT_PAYOUT_NETWORK: 'mainnet',
    })).toThrowError(/PAYOUT_TREASURY_UNAVAILABLE/)
    expect(() => readSweepConfig({
      NIMHUNT_PAYOUT_NETWORK: 'mainnet',
      NIMHUNT_TREASURY_PRIVATE_KEY: 'ab'.repeat(32),
    })).toThrowError(/PAYOUT_TREASURY_UNAVAILABLE/)
    expect(() => readSweepConfig({
      NIMHUNT_PAYOUT_NETWORK: 'mainnet',
      VITE_NIMHUNT_TREASURY_MNEMONIC: generated.mnemonic,
    })).toThrowError(/PAYOUT_TREASURY_UNAVAILABLE/)
  })
})

describe('treasury sweep preview and confirm', () => {
  it('previews without signing or broadcasting and never prints secrets', async () => {
    const generated = generateTreasuryMnemonic()
    const fake = createFakeSweepTransport({
      address: generated.address,
      balances: [21_000_000n],
    })
    const report = await runTreasurySweep({
      command: { recipient: RECIPIENT, leaveNim: 100n, confirm: false },
      transport: fake,
      feeLuna: 0n,
    })
    expect(report.mode).toBe('preview')
    expect(report.signed).toBe(false)
    expect(report.broadcast).toBe(false)
    expect(report.sendLuna).toBe(11_000_000n)
    expect(report.leaveLuna).toBe(10_000_000n)
    expect(report.feeLuna).toBe(0n)
    expect(report.expectedFinalLuna).toBe(10_000_000n)
    expect(fake.signCount).toBe(0)
    expect(fake.submitCount).toBe(0)

    const output = formatSweepReport(report)
    expect(output).toContain('TREASURY SWEEP CHECKPOINT')
    expect(output).toContain(`treasury=${generated.address}`)
    expect(output).toContain('currentBalanceNim=210.00000')
    expect(output).toContain('currentBalanceLuna=21000000')
    expect(output).toContain('sendNim=110.00000')
    expect(output).toContain('sendLuna=11000000')
    expect(output).toContain('leave=100.00000 NIM / 10000000 Luna')
    expect(output).toContain('fee=0 Luna')
    expect(output).toContain('feeLuna=0')
    expect(output).toContain('expectedFinalBalanceNim=100.00000')
    expect(output).toContain('signed=no')
    expect(output).toContain('broadcast=no')
    expect(output).not.toContain(generated.mnemonic)
    expect(output).not.toMatch(/private key|mnemonic/i)
    expect(JSON.stringify(report, (_key, value) => typeof value === 'bigint' ? value.toString() : value))
      .not.toContain(generated.mnemonic)
  })

  it('recalculates the live send amount immediately before confirmed execution', async () => {
    const generated = generateTreasuryMnemonic()
    const fake = createFakeSweepTransport({
      address: generated.address,
      balances: [21_000_000n, 33_000_007n],
      feeLuna: 7n,
    })
    const preview = await runTreasurySweep({
      command: { recipient: RECIPIENT, leaveNim: 100n, confirm: false },
      transport: fake,
      feeLuna: 7n,
    })
    expect(preview.sendLuna).toBe(10_999_993n)
    expect(fake.signCount).toBe(0)
    expect(fake.submitCount).toBe(0)

    const confirmed = await runTreasurySweep({
      command: { recipient: RECIPIENT, leaveNim: 100n, confirm: true },
      transport: fake,
      feeLuna: 7n,
      sleep: async () => undefined,
      confirmTimeoutMs: 0,
      pollMs: 0,
    })
    expect(confirmed.mode).toBe('confirmed')
    if (confirmed.mode !== 'confirmed') throw new Error('expected confirmed')
    expect(confirmed.sendLuna).toBe(23_000_000n)
    expect(confirmed.sendLuna).not.toBe(preview.sendLuna)
    expect(confirmed.leaveLuna).toBe(10_000_000n)
    expect(confirmed.feeLuna).toBe(7n)
    expect(confirmed.signed).toBe(true)
    expect(confirmed.broadcast).toBe(true)
    expect(fake.signCount).toBe(1)
    expect(fake.submitCount).toBe(1)
    expect(fake.signedAmounts).toEqual([23_000_000n])
    expect(confirmed.leaveMatch).toBe(true)
    expect(confirmed.finalBalanceLuna).toBe(10_000_000n)
  })

  it('requires --confirm before any signature and does not resend an ambiguous broadcast', async () => {
    const generated = generateTreasuryMnemonic()
    const fake = createFakeSweepTransport({
      address: generated.address,
      balances: [20_000_000n],
      submitMode: 'throw',
    })
    const preview = await runTreasurySweep({
      command: { recipient: RECIPIENT, leaveNim: 100n, confirm: false },
      transport: fake,
    })
    expect(preview.mode).toBe('preview')
    expect(fake.signCount).toBe(0)
    expect(fake.submitCount).toBe(0)

    const ambiguous = await runTreasurySweep({
      command: { recipient: RECIPIENT, leaveNim: 100n, confirm: true },
      transport: fake,
      sleep: async () => undefined,
      confirmTimeoutMs: 0,
      pollMs: 0,
    })
    expect(ambiguous.mode).toBe('ambiguous')
    if (ambiguous.mode !== 'ambiguous') throw new Error('expected ambiguous')
    expect(ambiguous.broadcast).toBe('unknown')
    expect(ambiguous.txHash).toMatch(/^[0-9a-f]{64}$/)
    expect(fake.signCount).toBe(1)
    expect(fake.submitCount).toBe(1)
    const output = formatSweepReport(ambiguous)
    expect(output).toContain('TREASURY SWEEP AMBIGUOUS SUBMISSION')
    expect(output).toContain(`tx_hash=${ambiguous.txHash}`)
    expect(output).toContain('Do not retry. Reconcile this transaction.')
    expect(output).not.toContain(generated.mnemonic)
  })

  it('builds a plan from the live balance instead of a hardcoded remainder', () => {
    const treasury = generateTreasuryMnemonic().address
    const first = buildSweepPlan({
      treasury,
      recipient: RECIPIENT,
      currentBalanceLuna: 40_000_000n,
      leaveLuna: SWEEP_LEAVE_LUNA,
      feeLuna: 0n,
    })
    const second = buildSweepPlan({
      treasury,
      recipient: RECIPIENT,
      currentBalanceLuna: 12_500_123n,
      leaveLuna: SWEEP_LEAVE_LUNA,
      feeLuna: 0n,
    })
    expect(first.sendLuna).toBe(30_000_000n)
    expect(second.sendLuna).toBe(2_500_123n)
    expect(first.sendLuna).not.toBe(second.sendLuna)
    expect(first.expectedFinalLuna).toBe(SWEEP_LEAVE_LUNA)
    expect(second.expectedFinalLuna).toBe(SWEEP_LEAVE_LUNA)
  })
})

describe('treasury sweep isolation', () => {
  it('does not persist secrets, touch payouts, or hardcode a prior treasury balance', () => {
    const generated = generateTreasuryMnemonic()
    const source = [
      readFileSync(new URL('./sweepTreasury.ts', import.meta.url), 'utf8'),
      readFileSync(new URL('../../scripts/sweep-treasury.ts', import.meta.url), 'utf8'),
    ].join('\n')
    expect(source).not.toMatch(/writeFile|appendFile|createWriteStream/)
    expect(source).not.toMatch(/VITE_/)
    expect(source).not.toMatch(/13920|13_920|13,920/)
    expect(source).not.toMatch(/reward_payouts|payout-worker|createPayoutService|createPayoutStore/)
    expect(source).not.toContain(generated.mnemonic)
    expect(createNimiqTreasury({
      network: 'mainnet',
      secret: { kind: 'mnemonic', value: generated.mnemonic },
      connect: false,
    }).address()).toBe(generated.address)
  })
})

function createFakeSweepTransport(options: {
  readonly address: string
  readonly balances: bigint[]
  readonly feeLuna?: bigint
  readonly submitMode?: 'broadcast' | 'throw'
}): SweepTransport & {
  readonly signCount: number
  readonly submitCount: number
  readonly signedAmounts: bigint[]
} {
  const balances = [...options.balances]
  const feeLuna = options.feeLuna ?? 0n
  const transactions = new Map<string, TreasuryTransaction>()
  const signedAmounts: bigint[] = []
  const state = {
    signCount: 0,
    submitCount: 0,
  }
  let liveBalance = balances[0] ?? 0n

  return {
    network: 'mainnet',
    get signCount() { return state.signCount },
    get submitCount() { return state.submitCount },
    signedAmounts,
    address: () => options.address,
    async getBalance() {
      if (balances.length > 0) liveBalance = balances.shift() ?? liveBalance
      return liveBalance
    },
    async signBasicTransfer(input) {
      state.signCount += 1
      signedAmounts.push(input.amountLuna)
      const txHash = createHash('sha256')
        .update(`${options.address}:${input.recipient}:${input.amountLuna.toString()}:${state.signCount}`)
        .digest('hex')
      return {
        sender: options.address,
        recipient: input.recipient,
        amountLuna: input.amountLuna,
        feeLuna,
        network: 'mainnet',
        networkId: 24,
        validityStartHeight: 1,
        txHash,
        serializedHex: '00',
      } satisfies SignedBasicTransfer
    },
    async submitBasic(intent) {
      state.submitCount += 1
      if (options.submitMode === 'throw') throw new Error('broadcast-ambiguous')
      liveBalance = liveBalance - intent.amountLuna - intent.feeLuna
      transactions.set(intent.txHash, {
        txHash: intent.txHash,
        sender: intent.sender,
        recipient: intent.recipient,
        amountLuna: intent.amountLuna,
        network: 'mainnet',
        extraData: null,
        status: 'confirmed',
        confirmations: 1,
      })
      return { txHash: intent.txHash }
    },
    async getTransaction(txHash) {
      return transactions.get(txHash) ?? null
    },
  }
}
