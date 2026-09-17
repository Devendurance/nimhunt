import { KeyPair } from '@nimiq/core'
import { describe, expect, it } from 'vitest'
import { PayoutError } from './errors.ts'
import { createFakeTreasury } from './fakeTreasury.ts'
import {
  authorizePayoutSchedulerRequest,
  DEFAULT_PAYOUT_MAX_PER_CYCLE,
  executeScheduledPayoutCycle,
  readPayoutOperationsStatus,
  readPayoutSchedulerConfig,
} from './scheduler.ts'
import { dispatchPayoutSchedulerHttp } from './schedulerHttp.ts'
import { createMemoryPayoutStore, type MemoryClaimRecord } from './store.ts'
import {
  BETA_MAX_DAILY_REWARD_LUNA,
  BETA_REWARD_AMOUNT_LUNA,
} from './types.ts'
import type { PayoutExecutionConfig } from './config.ts'

const SECRET = 'scheduler-secret-'.padEnd(32, 'x')
const AUTOMATIC: PayoutExecutionConfig = {
  network: 'mainnet',
  mainnetEnabled: true,
  automaticPayoutsEnabled: true,
  amountLuna: BETA_REWARD_AMOUNT_LUNA,
  maxDailyRewardLuna: BETA_MAX_DAILY_REWARD_LUNA,
  treasuryMinReserveLuna: 0n,
}
const DISABLED: PayoutExecutionConfig = { ...AUTOMATIC, automaticPayoutsEnabled: false }

type SeedClaim = MemoryClaimRecord & { readonly result: 'PASS' | 'REVIEW' | 'BLOCK' }

function claim(index: number, result: 'PASS' | 'REVIEW' | 'BLOCK' = 'PASS'): SeedClaim {
  const id = index.toString().padStart(12, '0')
  const keyPair = KeyPair.generate()
  return {
    claimId: `11111111-1111-1111-${id.slice(0, 4)}-${id.slice(4)}`,
    runId: `22222222-2222-2222-${id.slice(0, 4)}-${id.slice(4)}`,
    wallet: keyPair.toAddress().toUserFriendlyAddress(),
    dayKey: '2026-09-18',
    status: 'RESERVED',
    publicKey: 'pk',
    signature: 'sig',
    finalizedAt: new Date().toISOString(),
    result,
  }
}

function seed(store: ReturnType<typeof createMemoryPayoutStore>, row: SeedClaim): void {
  store.seedClaim(row)
  store.seedAssessment(row.runId, row.result)
}

describe('scheduled payout orchestration', () => {
  it('validates a bounded server-side cycle limit and never defaults above five', () => {
    expect(readPayoutSchedulerConfig({}).maxPerCycle).toBe(DEFAULT_PAYOUT_MAX_PER_CYCLE)
    expect(readPayoutSchedulerConfig({}).cronSecret).toBeNull()
    expect(readPayoutSchedulerConfig({ NIMHUNT_PAYOUT_MAX_PER_CYCLE: '69' }).maxPerCycle).toBe(69)
    for (const value of ['0', '70', '1.5', '-1', 'many']) {
      expect(() => readPayoutSchedulerConfig({ NIMHUNT_PAYOUT_MAX_PER_CYCLE: value })).toThrowError(
        new PayoutError('PAYOUT_CYCLE_LIMIT_INVALID'),
      )
    }
    expect(() => readPayoutSchedulerConfig({ NIMHUNT_PAYOUT_CRON_SECRET: 'short' })).toThrowError(
      new PayoutError('PAYOUT_SCHEDULER_SECRET_INVALID'),
    )
    expect(() => readPayoutSchedulerConfig({ CRON_SECRET: 'short' })).toThrowError(
      new PayoutError('PAYOUT_SCHEDULER_SECRET_INVALID'),
    )
  })

  it('prefers Vercel-native CRON_SECRET with the legacy key as a local/dev alias', () => {
    const cron = 'cron-secret-'.padEnd(32, 'y')
    const alias = 'scheduler-secret-'.padEnd(32, 'x')
    expect(readPayoutSchedulerConfig({ CRON_SECRET: cron })).toMatchObject({
      cronSecret: cron,
      cronSecretSource: 'CRON_SECRET',
    })
    expect(readPayoutSchedulerConfig({ NIMHUNT_PAYOUT_CRON_SECRET: alias })).toMatchObject({
      cronSecret: alias,
      cronSecretSource: 'NIMHUNT_PAYOUT_CRON_SECRET',
    })
    // Canonical production secret wins; production must not require two identical values.
    expect(readPayoutSchedulerConfig({ CRON_SECRET: cron, NIMHUNT_PAYOUT_CRON_SECRET: alias })).toMatchObject({
      cronSecret: cron,
      cronSecretSource: 'CRON_SECRET',
    })
    // Vercel Cron Bearer tokens validate through the same constant-time path.
    expect(authorizePayoutSchedulerRequest({ authorization: `Bearer ${cron}` }, cron)).toBe(true)
    expect(authorizePayoutSchedulerRequest({ authorization: `Bearer ${alias}` }, cron)).toBe(false)
    expect(authorizePayoutSchedulerRequest(undefined, cron)).toBe(false)
  })

  it('rejects browser-prefixed scheduler secrets fail-closed', () => {
    const cron = 'cron-secret-'.padEnd(32, 'y')
    expect(() => readPayoutSchedulerConfig({ CRON_SECRET: cron, VITE_CRON_SECRET: cron })).toThrowError(
      new PayoutError('PAYOUT_SCHEDULER_SECRET_INVALID'),
    )
    expect(() => readPayoutSchedulerConfig({ CRON_SECRET: cron, VITE_NIMHUNT_PAYOUT_CRON_SECRET: cron })).toThrowError(
      new PayoutError('PAYOUT_SCHEDULER_SECRET_INVALID'),
    )
  })

  it('uses constant-time authorization and rejects missing, wrong, duplicate, and browser-only credentials', () => {
    expect(authorizePayoutSchedulerRequest(undefined, SECRET)).toBe(false)
    expect(authorizePayoutSchedulerRequest({ cookie: 'nimhunt_session=browser' }, SECRET)).toBe(false)
    expect(authorizePayoutSchedulerRequest({ authorization: 'Bearer wrong-secret' }, SECRET)).toBe(false)
    expect(authorizePayoutSchedulerRequest({ authorization: `Bearer ${SECRET}`, 'x-nimhunt-payout-cron-secret': SECRET }, SECRET)).toBe(false)
    expect(authorizePayoutSchedulerRequest({ authorization: `Bearer ${SECRET}` }, SECRET)).toBe(true)
    expect(authorizePayoutSchedulerRequest({ 'x-nimhunt-payout-cron-secret': SECRET }, SECRET)).toBe(true)
  })

  it('rejects an unconfigured scheduler secret before any cycle can run', async () => {
    let calls = 0
    const response = await dispatchPayoutSchedulerHttp({
      secret: null,
      runCycle: async () => {
        calls += 1
        throw new Error('must not run')
      },
    }, {
      method: 'POST',
      path: '/api/internal/payout-cycle',
      headers: { authorization: `Bearer ${SECRET}` },
    })
    expect(response.status).toBe(503)
    expect(calls).toBe(0)
  })

  it('runs a disabled scheduled invocation read-only with zero signing and broadcast', async () => {
    const store = createMemoryPayoutStore()
    const ready = claim(1)
    seed(store, ready)
    const treasury = createFakeTreasury({ network: 'mainnet', balance: 50_000_000n })
    const result = await executeScheduledPayoutCycle({
      store,
      treasury,
      config: DISABLED,
      scheduler: { maxPerCycle: 5, cronSecret: SECRET },
      now: () => new Date('2026-09-18T12:00:00.000Z'),
    })

    expect(result.authorized).toBe(true)
    expect(result.automationEnabled).toBe(false)
    expect(result.envAutomationEnabled).toBe(false)
    expect(result.dbAutomationEnabled).toBe(false)
    expect(result.cycleRan).toBe(true)
    expect(result.result).toBe('DISABLED')
    expect(result.signed).toBe(0)
    expect(result.broadcast).toBe(0)
    expect(result.report.payoutsCreated).toBe(0)
    expect(result.operations.lastCycleResult).toBe('DISABLED')
    expect(result.operations.lastCycleAt).toBe('2026-09-18T12:00:00.000Z')
    expect(treasury.submitted).toHaveLength(0)
    expect(await store.getByClaim(ready.claimId)).toBeNull()
  })

  it('does not bypass the DB automation kill switch', async () => {
    const store = createMemoryPayoutStore()
    const ready = claim(1)
    seed(store, ready)
    const treasury = createFakeTreasury({ network: 'mainnet', balance: 50_000_000n })
    const result = await executeScheduledPayoutCycle({
      store,
      treasury,
      config: AUTOMATIC,
      scheduler: { maxPerCycle: 5, cronSecret: SECRET },
      secret: { kind: 'mnemonic', value: 'test mnemonic' },
    })
    expect(result.automationEnabled).toBe(false)
    expect(result.result).toBe('DISABLED')
    expect(result.signed).toBe(0)
    expect(result.broadcast).toBe(0)
    expect(await store.getByClaim(ready.claimId)).toBeNull()
    expect(treasury.submitted).toHaveLength(0)
  })

  it('authenticates the scheduler route and ignores body/query execution overrides', async () => {
    const store = createMemoryPayoutStore()
    await store.setAutomationEnabled(true)
    const first = claim(1)
    const second = claim(2)
    seed(store, first)
    seed(store, second)
    const treasury = createFakeTreasury({ network: 'mainnet', balance: 50_000_000n })
    const scheduler = { maxPerCycle: 1, cronSecret: SECRET }
    let calls = 0
    const runCycle = async () => {
      calls += 1
      return executeScheduledPayoutCycle({
        store,
        treasury,
        config: AUTOMATIC,
        scheduler,
        secret: { kind: 'mnemonic', value: 'test mnemonic' },
        now: () => new Date('2026-09-18T12:01:00.000Z'),
      })
    }

    const missing = await dispatchPayoutSchedulerHttp({ secret: SECRET, runCycle }, {
      method: 'POST',
      path: '/api/internal/payout-cycle',
      headers: {},
    })
    const wrong = await dispatchPayoutSchedulerHttp({ secret: SECRET, runCycle }, {
      method: 'POST',
      path: '/api/internal/payout-cycle',
      headers: { authorization: 'Bearer wrong-secret' },
    })
    const browser = await dispatchPayoutSchedulerHttp({ secret: SECRET, runCycle }, {
      method: 'POST',
      path: '/api/internal/payout-cycle',
      headers: { cookie: 'nimhunt_session=browser' },
    })
    expect(missing.status).toBe(401)
    expect(wrong.status).toBe(401)
    expect(browser.status).toBe(401)
    expect(calls).toBe(0)

    const query = await dispatchPayoutSchedulerHttp({ secret: SECRET, runCycle }, {
      method: 'POST',
      path: '/api/internal/payout-cycle?max=69',
      headers: { authorization: `Bearer ${SECRET}` },
    })
    expect(query.status).toBe(400)
    expect(calls).toBe(0)

    const response = await dispatchPayoutSchedulerHttp({ secret: SECRET, runCycle }, {
      method: 'POST',
      path: '/api/internal/payout-cycle',
      headers: { authorization: `Bearer ${SECRET}` },
      rawBody: JSON.stringify({ max: 69, amountLuna: '1', network: 'testnet' }),
    })
    expect(response.status).toBe(200)
    const body = response.body as {
      readonly report: { readonly payoutsCreated: number }
      readonly signed: number
      readonly broadcast: number
    }
    expect(body.report.payoutsCreated).toBe(1)
    expect(body.signed).toBe(1)
    expect(body.broadcast).toBe(1)
    expect(treasury.submitted).toHaveLength(1)
    expect(treasury.submitted[0]?.amountLuna).toBe(BETA_REWARD_AMOUNT_LUNA)
    expect(treasury.submitted[0]?.network).toBe('mainnet')
    expect(calls).toBe(1)
    expect(JSON.stringify(response.body)).not.toContain(SECRET)
    expect(JSON.stringify(response.body)).not.toMatch(/mnemonic|private key|raw capabilities|signature/i)
    expect(await store.getByClaim(second.claimId)).toBeNull()
    expect((await store.listUnpaidReservedClaims(69))).toHaveLength(1)
  })

  it('reports owner-safe operations status without secrets', async () => {
    const store = createMemoryPayoutStore({ clock: { now: () => new Date('2026-09-18T12:02:00.000Z') } })
    const pending = claim(1)
    const confirmed = claim(2)
    const processing = claim(3)
    const review = claim(4, 'REVIEW')
    const blocked = claim(5, 'BLOCK')
    for (const row of [pending, confirmed, processing, review, blocked]) seed(store, row)
    await store.create({ claimId: pending.claimId, payoutId: '11111111-1111-1111-1111-111111111111', amountLuna: 10_000n, network: 'mainnet' })
    await store.create({ claimId: confirmed.claimId, payoutId: '22222222-2222-2222-2222-222222222222', amountLuna: 20_000n, network: 'mainnet' })
    const acquired = await store.acquire()
    expect(acquired?.payoutId).toBe('11111111-1111-1111-1111-111111111111')
    const submitted = await store.markSubmitted(acquired!.payoutId, 'ab'.repeat(32))
    await store.markConfirmed(submitted.payoutId, 'ab'.repeat(32))
    await store.create({ claimId: processing.claimId, payoutId: '33333333-3333-3333-3333-333333333333', amountLuna: 30_000n, network: 'mainnet' })
    const processingRow = await store.acquire()
    expect(processingRow?.payoutId).toBe('22222222-2222-2222-2222-222222222222')
    await store.recordCycleResult({
      cycleId: '44444444-4444-4444-4444-444444444444',
      cycleAt: '2026-09-18T12:02:00.000Z',
      result: 'DISABLED',
      errors: [],
    })

    const status = await readPayoutOperationsStatus({
      store,
      treasury: createFakeTreasury({ network: 'mainnet', balance: 99_000n }),
      config: { ...DISABLED, treasuryMinReserveLuna: 10_000n },
      now: new Date('2026-09-18T12:02:00.000Z'),
    })
    expect(status).toMatchObject({
      automationEnvEnabled: false,
      automationDbEnabled: false,
      automationEnabled: false,
      treasuryBalanceLuna: '99000',
      minimumReserveLuna: '10000',
      pendingCount: 1,
      processingCount: 1,
      submittedCount: 0,
      confirmedTodayCount: 1,
      reviewCount: 1,
      blockCount: 1,
      lastCycleId: '44444444-4444-4444-4444-444444444444',
      lastCycleResult: 'DISABLED',
      lastCycleErrors: [],
    })
    expect(BigInt(status.executionDayCommittedLuna)).toBe(30_000n)
    expect(BigInt(status.remainingDailyBudgetLuna!)).toBe(BETA_MAX_DAILY_REWARD_LUNA - 30_000n)
    expect(JSON.stringify(status)).not.toMatch(/mnemonic|private key|capability|signature/i)
  })

  it('serializes overlapping memory cycles so reserve and sends stay single-use', async () => {
    const store = createMemoryPayoutStore()
    await store.setAutomationEnabled(true)
    const first = claim(1)
    const second = claim(2)
    seed(store, first)
    seed(store, second)
    const treasury = createFakeTreasury({ network: 'mainnet', balance: 15_000_000n })
    const options = {
      store,
      treasury,
      config: { ...AUTOMATIC, treasuryMinReserveLuna: 5_000_000n },
      scheduler: { maxPerCycle: 5, cronSecret: SECRET },
      secret: { kind: 'mnemonic' as const, value: 'test mnemonic' },
    }
    const [left, right] = await Promise.all([
      executeScheduledPayoutCycle(options),
      executeScheduledPayoutCycle(options),
    ])
    expect(left.cycleRan && right.cycleRan).toBe(true)
    expect(treasury.submitted).toHaveLength(1)
    expect(await treasury.getBalance()).toBe(5_000_000n)
    expect((await store.listByStatus('CONFIRMED', 69))).toHaveLength(1)
    expect((await store.listByStatus('PENDING', 69))).toHaveLength(1)
  })
})
