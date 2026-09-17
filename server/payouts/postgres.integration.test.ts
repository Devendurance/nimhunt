import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { KeyPair } from '@nimiq/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client, Pool } from 'pg'
import { hashBlueprint } from '../../src/game/replay/canonical.ts'
import { createRoom01Blueprint } from '../../src/game/world/room01.ts'
import { serializeStartPayload } from '../expeditions/canonical.ts'
import { nimiqSignedMessageHash } from '../expeditions/crypto.ts'
import { createPgProofRpcClient } from '../expeditions/proofDb.ts'
import { createPostgresProofService } from '../expeditions/postgresProofStore.ts'
import { minimumPlausibleCompletionMs } from '../expeditions/riskGate.ts'
import { PREVALIDATED_ROOM_01_BOOTSTRAP_WINNING_SEQUENCES } from '../expeditions/room01BootstrapPrevalidation.ts'
import type { ProofService } from '../expeditions/types.ts'
import type { Direction, MoveAction } from '../../src/game/replay/types.ts'
import { utcDayKey } from '../ledger/utcDay.ts'
import { createPgPayoutRpcClient } from './db.ts'
import { createFakeTreasury } from './fakeTreasury.ts'
import { createPayoutService } from './service.ts'
import { createPayoutStore } from './store.ts'
import {
  BETA_MAX_DAILY_REWARD_LUNA,
  BETA_REWARD_AMOUNT_LUNA,
} from './types.ts'
import { runPayoutWorker } from './worker.ts'
import { executeScheduledPayoutCycle } from './scheduler.ts'

const execFileAsync = promisify(execFile)
const sqlDir = join(dirname(fileURLToPath(import.meta.url)), '../ledger/sql')
const dockerEnabled = process.env.NIMHUNT_PROOF_DOCKER === '1'
const AMOUNT = 100_000n

let harness: { host: string; port: number; container: string } | null = null
let adminPool: Pool | null = null
const pools: Pool[] = []

describe.skipIf(!dockerEnabled)('postgres payout adapter', () => {
  beforeAll(async () => {
    harness = await startPostgres()
    adminPool = new Pool({
      host: harness.host,
      port: harness.port,
      user: 'postgres',
      password: 'postgres',
      database: 'postgres',
    })
    adminPool.on('error', () => undefined)
    await adminPool.query(`
      do $$ begin create role anon login password 'anon'; exception when duplicate_object then null; end $$;
      do $$ begin create role authenticated login password 'authenticated'; exception when duplicate_object then null; end $$;
      do $$ begin create role service_role login password 'service' bypassrls; exception when duplicate_object then null; end $$;
      grant usage on schema public to anon, authenticated, service_role;
    `)
    await adminPool.query(readFileSync(join(sqlDir, '001_daily_ledger.sql'), 'utf8'))
    await adminPool.query(readFileSync(join(sqlDir, '002_expedition_proof.sql'), 'utf8'))
    await adminPool.query(readFileSync(join(sqlDir, '003_expedition_proof_runtime.sql'), 'utf8'))
    await adminPool.query(readFileSync(join(sqlDir, '004_reward_claims.sql'), 'utf8'))
    await adminPool.query(readFileSync(join(sqlDir, '005_reward_payouts.sql'), 'utf8'))
    await adminPool.query(readFileSync(join(sqlDir, '006_reward_claim_session_recovery.sql'), 'utf8'))
    await adminPool.query(readFileSync(join(sqlDir, '007_wallet_recovery_session.sql'), 'utf8'))
    await adminPool.query(readFileSync(join(sqlDir, '008_reward_risk_gate.sql'), 'utf8'))
    await adminPool.query(readFileSync(join(sqlDir, '009_automatic_payout_pipeline.sql'), 'utf8'))
    await adminPool.query(readFileSync(join(sqlDir, '010_payout_execution_day.sql'), 'utf8'))
    await adminPool.query(readFileSync(join(sqlDir, '011_payout_scheduler_operations.sql'), 'utf8'))
  }, 120_000)

  afterAll(async () => {
    await Promise.all(pools.map(pool => pool.end().catch(() => undefined)))
    await adminPool?.end().catch(() => undefined)
    if (harness) await execFileAsync('docker', ['rm', '-f', harness.container]).catch(() => undefined)
  }, 30_000)

  it('creates one payout per reserved claim and rejects non-reserved claims', async () => {
    const reserved = await completeReserved()
    const store = createStore()
    const first = await store.create({
      claimId: reserved.claimId,
      payoutId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      amountLuna: AMOUNT,
      network: 'testnet',
    })
    const retry = await store.create({
      claimId: reserved.claimId,
      payoutId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      amountLuna: 200_000n,
      network: 'mainnet',
    })
    expect(retry.existing).toBe(true)
    expect(retry.payout.payoutId).toBe(first.payout.payoutId)
    expect(retry.payout.amountLuna).toBe(AMOUNT)
    expect(retry.payout.network).toBe('testnet')
    expect(retry.payout.wallet).toBe(reserved.wallet)

    const prepared = await completePrepared()
    await expect(store.create({
      claimId: prepared.claimId,
      payoutId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
      amountLuna: AMOUNT,
      network: 'testnet',
    })).rejects.toMatchObject({ code: 'CLAIM_NOT_ELIGIBLE' })

    const claimRow = await adminPool!.query('select status, public_key, signature from public.reward_claims where claim_id = $1', [reserved.claimId])
    expect(claimRow.rows[0]?.status).toBe('RESERVED')
    const runRow = await adminPool!.query('select checkpoint_hash, terminal from public.expedition_runs where id = $1', [reserved.runId])
    expect(runRow.rows[0]?.checkpoint_hash).toBeTruthy()
  }, 60_000)

  it('acquires one payout under concurrent workers and does not pay twice', async () => {
    await adminPool!.query(`
      update public.reward_payouts
      set status = 'FAILED_FINAL',
          failure_code = 'TEST_ISOLATE',
          failure_message_safe = 'test isolate',
          updated_at = timezone('utc', now())
      where status in ('PENDING', 'FAILED_RETRYABLE', 'PROCESSING')
    `)
    const reserved = await completeReserved()
    const store = createStore()
    const created = await store.create({
      claimId: reserved.claimId,
      payoutId: cryptoRandom(),
      amountLuna: AMOUNT,
      network: 'testnet',
    })
    const firstClient = await independentClient()
    const secondClient = await independentClient()
    try {
      const [left, right] = await Promise.all([
        firstClient.query('select public.acquire_reward_payout() as result'),
        secondClient.query('select public.acquire_reward_payout() as result'),
      ])
      const acquired = [left.rows[0]?.result, right.rows[0]?.result]
        .map(value => value?.payout ?? null)
        .filter(Boolean)
      expect(acquired).toHaveLength(1)
      expect(acquired[0]?.payout_id).toBe(created.payout.payoutId)
      expect(acquired[0]?.status).toBe('PROCESSING')
      expect(acquired[0]?.attempt_count).toBe(1)
      const stored = await adminPool!.query('select status, attempt_count from public.reward_payouts where payout_id = $1', [created.payout.payoutId])
      expect(stored.rows[0]).toMatchObject({ status: 'PROCESSING' })
      expect(Number(stored.rows[0]?.attempt_count)).toBe(1)
    } finally {
      await firstClient.end()
      await secondClient.end()
    }
  }, 60_000)

  it('executes once, persists the tx hash, confirms, and never resends after SUBMITTED', async () => {
    const reserved = await completeReserved()
    const store = createStore()
    const treasury = createFakeTreasury({ address: 'NQ07 TEST TREA SURY 0000 0000 0000 0000 0000' })
    const service = createPayoutService({
      store,
      treasury,
      config: { network: 'testnet', mainnetEnabled: false, amountLuna: AMOUNT },
    })
    const created = await service.ensureForReservedClaim(reserved.claimId)
    const submitted = await service.executeNext()
    expect(submitted?.status).toBe('SUBMITTED')
    expect(submitted?.txHash).toMatch(/^[0-9a-f]{64}$/)
    expect(treasury.submitted).toHaveLength(1)
    expect(treasury.submitted[0]?.recipient).toBe(reserved.wallet)
    expect(treasury.submitted[0]?.amountLuna).toBe(AMOUNT)
    const persisted = await adminPool!.query('select status, tx_hash, amount_luna, wallet from public.reward_payouts where payout_id = $1', [created.payoutId])
    expect(persisted.rows[0]).toMatchObject({
      status: 'SUBMITTED',
      tx_hash: submitted?.txHash,
      wallet: reserved.wallet,
    })
    expect(BigInt(persisted.rows[0]?.amount_luna)).toBe(AMOUNT)
    expect(await service.executeNext()).toBeNull()
    const confirmed = await service.reconcile(submitted!)
    expect(confirmed?.status).toBe('CONFIRMED')
    expect(treasury.submitted).toHaveLength(1)
    const claim = await adminPool!.query('select status from public.reward_claims where claim_id = $1', [reserved.claimId])
    expect(claim.rows[0]?.status).toBe('RESERVED')
  }, 60_000)

  it('rejects anon/authenticated writes and payout RPC execution', async () => {
    const anon = new Pool({
      host: harness!.host,
      port: harness!.port,
      user: 'anon',
      password: 'anon',
      database: 'postgres',
    })
    const authenticated = new Pool({
      host: harness!.host,
      port: harness!.port,
      user: 'authenticated',
      password: 'authenticated',
      database: 'postgres',
    })
    try {
      await expect(anon.query("insert into public.reward_payouts (payout_id, claim_id, run_id, wallet, day_key, amount_luna, network, status) values (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'NQ-TEST', current_date, 1, 'testnet', 'PENDING')")).rejects.toThrow()
      expect((await anon.query('update public.reward_payouts set status = status returning payout_id')).rowCount).toBe(0)
      expect((await anon.query('delete from public.reward_payouts returning payout_id')).rowCount).toBe(0)
      await expect(authenticated.query("insert into public.reward_payouts (payout_id, claim_id, run_id, wallet, day_key, amount_luna, network, status) values (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'NQ-TEST', current_date, 1, 'testnet', 'PENDING')")).rejects.toThrow()
      expect((await authenticated.query('update public.reward_payouts set status = status returning payout_id')).rowCount).toBe(0)
      expect((await anon.query("select has_function_privilege('anon', 'public.create_reward_payout(uuid,uuid,bigint,text)', 'EXECUTE') as allowed")).rows[0]?.allowed).toBe(false)
      expect((await authenticated.query("select has_function_privilege('authenticated', 'public.acquire_reward_payout()', 'EXECUTE') as allowed")).rows[0]?.allowed).toBe(false)
      expect((await anon.query("select has_function_privilege('anon', 'public.mark_reward_payout_submitted(uuid,text)', 'EXECUTE') as allowed")).rows[0]?.allowed).toBe(false)
      expect((await anon.query("select has_function_privilege('anon', 'public.get_reserved_reward_claim_for_session(text)', 'EXECUTE') as allowed")).rows[0]?.allowed).toBe(false)
      expect((await authenticated.query("select has_function_privilege('authenticated', 'public.get_reserved_reward_claim_for_session(text)', 'EXECUTE') as allowed")).rows[0]?.allowed).toBe(false)
      expect((await anon.query("select has_function_privilege('anon', 'public.get_payout_operations_status()', 'EXECUTE') as allowed")).rows[0]?.allowed).toBe(false)
      expect((await authenticated.query("select has_function_privilege('authenticated', 'public.record_payout_cycle_result(uuid,timestamptz,text,jsonb)', 'EXECUTE') as allowed")).rows[0]?.allowed).toBe(false)
    } finally {
      await anon.end()
      await authenticated.end()
    }
  }, 30_000)

  it('applies 006 recovery and keeps reserved claims bound to their own session', async () => {
    await adminPool!.query('drop function if exists public.get_reserved_reward_claim_for_session(text)')
    await adminPool!.query(readFileSync(join(sqlDir, '006_reward_claim_session_recovery.sql'), 'utf8'))
    const fn = await adminPool!.query(`
      select p.prosecdef, p.proconfig
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'get_reserved_reward_claim_for_session'
    `)
    expect(fn.rows[0]?.prosecdef).toBe(true)
    expect(JSON.stringify(fn.rows[0]?.proconfig ?? [])).toMatch(/search_path=[\s\S]*pg_catalog,\s*public/)

    const walletA = await completeReserved()
    const walletB = await completeReserved()
    const recoveredA = await walletA.service.getReservedRewardClaim(walletA.session)
    const recoveredB = await walletB.service.getReservedRewardClaim(walletB.session)
    expect(recoveredA?.claimId).toBe(walletA.claimId)
    expect(recoveredB?.claimId).toBe(walletB.claimId)
    expect(recoveredA?.claimId).not.toBe(walletB.claimId)

    const crossed = await adminPool!.query(
      'select public.get_reserved_reward_claim_for_session($1::text) as result',
      [walletA.session.sessionHash],
    )
    expect(crossed.rows[0]?.result).toMatchObject({
      ok: true,
      claim: { claim_id: walletA.claimId },
    })
    expect(JSON.stringify(crossed.rows[0]?.result)).not.toContain(walletB.claimId)

    const missing = await adminPool!.query(
      'select public.get_reserved_reward_claim_for_session($1::text) as result',
      ['f'.repeat(64)],
    )
    expect(missing.rows[0]?.result).toMatchObject({ ok: false, error: 'RUN_SESSION_INVALID' })
  }, 60_000)

  it('lets only one automated worker create and acquire a PASS claim', async () => {
    await isolateAutomationState()
    const seeded = await seedReservedPass(1)
    const claim = seeded[0]!
    const storeA = createStore()
    const storeB = createStore()
    await storeA.setAutomationEnabled(true)
    const treasury = createFakeTreasury({
      network: 'mainnet',
      address: 'NQ07 TEST TREA SURY 0000 0000 0000 0000 0000',
      balance: 50_000_000n,
    })
    const config = automaticConfig()
    const [left, right] = await Promise.all([
      runPayoutWorker({ store: storeA, treasury, config, max: 5 }),
      runPayoutWorker({ store: storeB, treasury, config, max: 5 }),
    ])
    const created = left.payoutsCreated + right.payoutsCreated
    expect(created).toBe(1)
    expect(treasury.submitted).toHaveLength(1)
    const payouts = await adminPool!.query('select count(*)::int as n from public.reward_payouts where claim_id = $1', [claim.claimId])
    expect(payouts.rows[0]?.n).toBe(1)
    const confirmed = await adminPool!.query('select status, amount_luna from public.reward_payouts where claim_id = $1', [claim.claimId])
    expect(confirmed.rows[0]?.status).toBe('CONFIRMED')
    expect(BigInt(confirmed.rows[0]?.amount_luna)).toBe(BETA_REWARD_AMOUNT_LUNA)
  }, 60_000)

  it('keeps overlapping scheduled cycles single-use with a mocked treasury', async () => {
    await isolateAutomationState()
    const seeded = await seedReservedPass(2, '2026-09-19')
    const storeA = createStore()
    const storeB = createStore()
    await storeA.setAutomationEnabled(true)
    const treasury = createFakeTreasury({
      network: 'mainnet',
      address: 'NQ07 TEST TREA SURY 0000 0000 0000 0000 0000',
      balance: 15_000_000n,
    })
    const config = {
      ...automaticConfig(),
      treasuryMinReserveLuna: 5_000_000n,
    }
    const scheduler = { maxPerCycle: 5, cronSecret: 'scheduler-secret-'.padEnd(32, 'x') }
    const secret = { kind: 'mnemonic' as const, value: 'test mnemonic' }
    const [left, right] = await Promise.all([
      executeScheduledPayoutCycle({ store: storeA, treasury, config, scheduler, secret }),
      executeScheduledPayoutCycle({ store: storeB, treasury, config, scheduler, secret }),
    ])
    expect(left.cycleRan && right.cycleRan).toBe(true)
    expect(left.signed + right.signed).toBe(1)
    expect(left.broadcast + right.broadcast).toBe(1)
    expect(treasury.submitted).toHaveLength(1)
    expect(await treasury.getBalance()).toBe(5_000_000n)
    const rows = await adminPool!.query(
      `select count(*)::int as total,
              count(*) filter (where status = 'CONFIRMED')::int as confirmed,
              count(*) filter (where status = 'PENDING')::int as pending
       from public.reward_payouts where claim_id = any($1::uuid[])`,
      [seeded.map(row => row.claimId)],
    )
    expect(rows.rows[0]).toMatchObject({ total: 2, confirmed: 1, pending: 1 })
  }, 60_000)

  it('cannot exceed the daily cap or drain below reserve with concurrent workers', async () => {
    await isolateAutomationState()
    const seeded = await seedReservedPass(4, '2026-09-19')
    const storeA = createStore()
    const storeB = createStore()
    await storeA.setAutomationEnabled(true)
    const treasury = createFakeTreasury({
      network: 'mainnet',
      address: 'NQ07 TEST TREA SURY 0000 0000 0000 0000 0000',
      balance: 15_000_000n,
    })
    const config = {
      ...automaticConfig(),
      treasuryMinReserveLuna: 5_000_000n,
    }
    const scheduler = { maxPerCycle: 4, cronSecret: 'scheduler-secret-'.padEnd(32, 'x') }
    const secret = { kind: 'mnemonic' as const, value: 'test mnemonic' }
    await Promise.all([
      executeScheduledPayoutCycle({ store: storeA, treasury, config, scheduler, secret }),
      executeScheduledPayoutCycle({ store: storeB, treasury, config, scheduler, secret }),
    ])
    expect(treasury.submitted).toHaveLength(1)
    const paid = treasury.submitted.reduce((sum, row) => sum + row.amountLuna, 0n)
    expect(paid).toBe(BETA_REWARD_AMOUNT_LUNA)
    expect(await treasury.getBalance()).toBe(5_000_000n)
    const pending = await adminPool!.query(
      `select count(*)::int as n from public.reward_payouts
       where claim_id = any($1::uuid[]) and status = 'PENDING'`,
      [seeded.map(row => row.claimId)],
    )
    expect(pending.rows[0]?.n).toBeGreaterThan(0)
  }, 60_000)

  it('cannot exceed the daily cap with concurrent workers', async () => {
    await isolateAutomationState()
    const seeded = await seedReservedPass(70, '2026-09-22')
    const storeA = createStore()
    const storeB = createStore()
    await storeA.setAutomationEnabled(true)
    const treasury = createFakeTreasury({
      network: 'mainnet',
      address: 'NQ07 TEST TREA SURY 0000 0000 0000 0000 0000',
      balance: 1_000_000_000n,
    })
    const config = automaticConfig()
    const scheduler = { maxPerCycle: 69, cronSecret: 'scheduler-secret-'.padEnd(32, 'x') }
    const secret = { kind: 'mnemonic' as const, value: 'test mnemonic' }
    await Promise.all([
      executeScheduledPayoutCycle({ store: storeA, treasury, config, scheduler, secret }),
      executeScheduledPayoutCycle({ store: storeB, treasury, config, scheduler, secret }),
    ])
    expect(treasury.submitted).toHaveLength(69)
    expect(treasury.submitted.reduce((sum, row) => sum + row.amountLuna, 0n)).toBe(BETA_MAX_DAILY_REWARD_LUNA)
    const confirmed = await adminPool!.query(
      `select count(*)::int as n from public.reward_payouts
       where claim_id = any($1::uuid[]) and status = 'CONFIRMED'`,
      [seeded.map(row => row.claimId)],
    )
    expect(confirmed.rows[0]?.n).toBe(69)
    const overpaid = await adminPool!.query(
      `select count(*)::int as n from public.reward_payouts
       where claim_id = any($1::uuid[]) and status in ('SUBMITTED', 'CONFIRMED')`,
      [seeded.map(row => row.claimId)],
    )
    expect(overpaid.rows[0]?.n).toBe(69)
  }, 120_000)

  it('simulates 69 PASS payouts at 10,000,000 Luna and keeps #70 and REVIEW/BLOCK unpaid', async () => {
    await isolateAutomationState()
    const dayKey = '2026-09-20'
    const pass = await seedReservedPass(69, dayKey)
    const review = await seedReservedWithRisk(1, 'REVIEW', dayKey)
    const blocked = await seedReservedWithRisk(1, 'BLOCK', dayKey)
    const store = createStore()
    await store.setAutomationEnabled(true)
    const treasury = createFakeTreasury({
      network: 'mainnet',
      address: 'NQ07 TEST TREA SURY 0000 0000 0000 0000 0000',
      balance: 1_000_000_000n,
    })
    const first = await runPayoutWorker({
      store,
      treasury,
      config: automaticConfig(),
      max: 69,
    })
    expect(first.payoutsCreated).toBe(69)
    expect(first.confirmed).toBe(69)
    expect(first.reviewSkipped).toBe(1)
    expect(first.blockSkipped).toBe(1)
    expect(treasury.submitted).toHaveLength(69)
    expect(treasury.submitted.reduce((sum, row) => sum + row.amountLuna, 0n)).toBe(BETA_MAX_DAILY_REWARD_LUNA)
    expect(await store.getByClaim(review[0]!.claimId)).toBeNull()
    expect(await store.getByClaim(blocked[0]!.claimId)).toBeNull()

    const extra = await seedReservedPass(1, dayKey)
    await store.create({
      claimId: extra[0]!.claimId,
      payoutId: cryptoRandom(),
      amountLuna: BETA_REWARD_AMOUNT_LUNA,
      network: 'mainnet',
    })
    const overflow = await runPayoutWorker({
      store,
      treasury,
      config: automaticConfig(),
      max: 5,
    })
    expect(overflow.dailyCapReached).toBe(true)
    expect(treasury.submitted).toHaveLength(69)
    expect((await store.getByClaim(extra[0]!.claimId))?.status).toBe('PENDING')
    const paidClaims = await adminPool!.query(
      `select count(*)::int as n from public.reward_payouts
       where claim_id = any($1::uuid[]) and status = 'CONFIRMED'`,
      [pass.map(row => row.claimId)],
    )
    expect(paidClaims.rows[0]?.n).toBe(69)
  }, 120_000)

  it('honors the DB kill switch off and skips REVIEW/BLOCK discovery', async () => {
    await isolateAutomationState()
    await createStore().setAutomationEnabled(false)
    const enabled = await adminPool!.query('select automatic_payouts_enabled from public.payout_automation_control where id is true')
    expect(enabled.rows[0]?.automatic_payouts_enabled).toBe(false)
    const pass = await seedReservedPass(1, '2026-09-21')
    await seedReservedWithRisk(1, 'REVIEW', '2026-09-21')
    const store = createStore()
    const treasury = createFakeTreasury({ network: 'mainnet', balance: 50_000_000n })
    const report = await runPayoutWorker({
      store,
      treasury,
      config: automaticConfig(),
      max: 5,
    })
    expect(report.payoutsCreated).toBe(0)
    expect(report.reviewSkipped).toBe(1)
    expect(treasury.submitted).toHaveLength(0)
    expect(await store.getByClaim(pass[0]!.claimId)).toBeNull()
  }, 60_000)

  it('stamps execution_day_key on acquire without rewriting reservation day_key', async () => {
    await isolateAutomationState()
    const reservationDay = '2026-09-16'
    const seeded = await seedReservedPass(1, reservationDay)
    const store = createStore()
    await store.setAutomationEnabled(true)
    const created = await store.create({
      claimId: seeded[0]!.claimId,
      payoutId: cryptoRandom(),
      amountLuna: BETA_REWARD_AMOUNT_LUNA,
      network: 'mainnet',
    })
    expect(created.payout.dayKey).toBe(reservationDay)
    expect(created.payout.executionDayKey).toBeNull()
    const acquired = await store.acquireAutomated({
      availableForRewardsLuna: BETA_REWARD_AMOUNT_LUNA,
      maxDailyRewardLuna: BETA_MAX_DAILY_REWARD_LUNA,
      feeLuna: 0n,
    })
    expect(acquired.payout?.dayKey).toBe(reservationDay)
    expect(acquired.payout?.executionDayKey).toBe(utcDayKey(new Date()))
    expect(acquired.payout?.status).toBe('PROCESSING')
    const spend = await store.getExecutionDaySpend(utcDayKey(new Date()))
    expect(spend).toBe(BETA_REWARD_AMOUNT_LUNA)
    expect(await store.getExecutionDaySpend(reservationDay)).toBe(0n)
  }, 60_000)

  it('cannot exceed the execution-day cap when yesterday and today claims race at 680 NIM spent', async () => {
    await isolateAutomationState()
    const today = utcDayKey(new Date())
    const yesterday = '2026-09-16'
    const filled = await seedReservedPass(1, yesterday)
    const racers = [...await seedReservedPass(1, yesterday), ...await seedReservedPass(1, today)]
    const storeA = createStore()
    const storeB = createStore()
    await storeA.setAutomationEnabled(true)
    await storeA.create({
      claimId: filled[0]!.claimId,
      payoutId: cryptoRandom(),
      amountLuna: 680_000_000n,
      network: 'mainnet',
    })
    await adminPool!.query(
      `update public.reward_payouts
       set status = 'CONFIRMED',
           execution_day_key = $2::date,
           tx_hash = $3,
           processing_started_at = timezone('utc', now()),
           submitted_at = timezone('utc', now()),
           confirmed_at = timezone('utc', now()),
           attempt_count = 1,
           updated_at = timezone('utc', now())
       where claim_id = $1::uuid`,
      [filled[0]!.claimId, today, '11'.repeat(32)],
    )
    for (const row of racers) {
      await storeA.create({
        claimId: row.claimId,
        payoutId: cryptoRandom(),
        amountLuna: BETA_REWARD_AMOUNT_LUNA,
        network: 'mainnet',
      })
    }
    const treasury = createFakeTreasury({
      network: 'mainnet',
      address: 'NQ07 TEST TREA SURY 0000 0000 0000 0000 0000',
      balance: 1_000_000_000n,
    })
    await Promise.all([
      runPayoutWorker({ store: storeA, treasury, config: automaticConfig(), max: 5 }),
      runPayoutWorker({ store: storeB, treasury, config: automaticConfig(), max: 5 }),
    ])
    expect(treasury.submitted).toHaveLength(1)
    expect(treasury.submitted.reduce((sum, row) => sum + row.amountLuna, 0n)).toBe(BETA_REWARD_AMOUNT_LUNA)
    const committed = await storeA.getExecutionDaySpend(today)
    expect(committed).toBe(BETA_MAX_DAILY_REWARD_LUNA)
    const pending = await adminPool!.query(
      `select count(*)::int as n from public.reward_payouts
       where claim_id = any($1::uuid[]) and status = 'PENDING'`,
      [racers.map(row => row.claimId)],
    )
    expect(pending.rows[0]?.n).toBe(1)
    const reservation = await adminPool!.query(
      `select day_key::text as day_key, execution_day_key::text as execution_day_key, status
       from public.reward_payouts where claim_id = $1`,
      [filled[0]!.claimId],
    )
    expect(String(reservation.rows[0]?.day_key).slice(0, 10)).toBe(yesterday)
    expect(String(reservation.rows[0]?.execution_day_key).slice(0, 10)).toBe(today)
  }, 60_000)

  it('stops mixed carryover and current-day execution at the 690 NIM cap', async () => {
    await isolateAutomationState()
    const today = utcDayKey(new Date())
    const yesterday = '2026-09-16'
    const previous = await seedReservedPass(40, yesterday)
    const current = await seedReservedPass(40, today)
    const store = createStore()
    await store.setAutomationEnabled(true)
    const treasury = createFakeTreasury({
      network: 'mainnet',
      address: 'NQ07 TEST TREA SURY 0000 0000 0000 0000 0000',
      balance: 1_000_000_000n,
    })
    const first = await runPayoutWorker({
      store,
      treasury,
      config: automaticConfig(),
      max: 69,
    })
    expect(first.confirmed).toBe(69)
    expect(first.executionDay).toBe(today)
    expect(first.executionDayCommittedLuna).toBe(BETA_MAX_DAILY_REWARD_LUNA.toString())
    expect(treasury.submitted).toHaveLength(69)
    for (const row of [...previous, ...current]) {
      if (await store.getByClaim(row.claimId)) continue
      await store.create({
        claimId: row.claimId,
        payoutId: cryptoRandom(),
        amountLuna: BETA_REWARD_AMOUNT_LUNA,
        network: 'mainnet',
      })
    }
    const overflow = await runPayoutWorker({
      store,
      treasury,
      config: automaticConfig(),
      max: 5,
    })
    expect(overflow.dailyCapReached).toBe(true)
    expect(treasury.submitted).toHaveLength(69)
    expect(await store.getExecutionDaySpend(today)).toBe(BETA_MAX_DAILY_REWARD_LUNA)
    const pending = await adminPool!.query(
      `select count(*)::int as n from public.reward_payouts
       where claim_id = any($1::uuid[]) and status = 'PENDING'`,
      [[...previous, ...current].map(row => row.claimId)],
    )
    expect(pending.rows[0]?.n).toBeGreaterThan(0)
    const mixed = await adminPool!.query(
      `select day_key::text as day_key, execution_day_key::text as execution_day_key
       from public.reward_payouts
       where claim_id = any($1::uuid[]) and status = 'CONFIRMED'`,
      [[...previous, ...current].map(row => row.claimId)],
    )
    expect(mixed.rows).toHaveLength(69)
    expect(mixed.rows.every(row => String(row.execution_day_key).slice(0, 10) === today)).toBe(true)
    expect(mixed.rows.some(row => String(row.day_key).slice(0, 10) === yesterday)).toBe(true)
    expect(mixed.rows.some(row => String(row.day_key).slice(0, 10) === today)).toBe(true)
  }, 120_000)
})

async function isolateAutomationState() {
  await adminPool!.query(`
    update public.reward_payouts
    set status = 'FAILED_FINAL',
        tx_hash = null,
        failure_code = 'TEST_ISOLATE',
        failure_message_safe = 'test isolate',
        updated_at = timezone('utc', now())
    where status in ('PENDING', 'FAILED_RETRYABLE', 'PROCESSING', 'SUBMITTED', 'CONFIRMED')
  `)
  await adminPool!.query(`
    update public.reward_claims
    set status = 'EXPIRED'
    where status = 'RESERVED'
  `)
}

function automaticConfig() {
  return {
    network: 'mainnet' as const,
    mainnetEnabled: true,
    automaticPayoutsEnabled: true,
    amountLuna: BETA_REWARD_AMOUNT_LUNA,
    maxDailyRewardLuna: BETA_MAX_DAILY_REWARD_LUNA,
    treasuryMinReserveLuna: 0n,
  }
}

async function seedReservedPass(count: number, dayKey = utcDayKey(new Date())) {
  return seedReservedWithRisk(count, 'PASS', dayKey)
}

async function seedReservedWithRisk(
  count: number,
  result: 'PASS' | 'REVIEW' | 'BLOCK',
  dayKey = utcDayKey(new Date()),
) {
  const seeded: { claimId: string; runId: string; wallet: string }[] = []
  await adminPool!.query(
    `insert into public.daily_reward_pools (day_key, reserved_slots)
     values ($1::date, 0)
     on conflict (day_key) do nothing`,
    [dayKey],
  )
  for (let index = 0; index < count; index += 1) {
    const keyPair = KeyPair.generate()
    const wallet = keyPair.toAddress().toUserFriendlyAddress()
    const run = await adminPool!.query(
      `insert into public.expedition_runs (day_key, wallet, mission_type, status, reward_status)
       values ($1::date, $2, 'gem-runner', 'COMPLETED', 'RESERVED')
       returning id`,
      [dayKey, wallet],
    )
    const runId = String(run.rows[0]?.id)
    const claimId = cryptoRandom()
    const hash = 'ab'.repeat(32)
    await adminPool!.query(
      `insert into public.reward_claims (
         claim_id, run_id, wallet, mission, day_key, canonical_payload, claim_payload_hash,
         status, public_key, signature, expires_at, finalized_at
       ) values (
         $1::uuid, $2::uuid, $3, 'gem-runner', $4::date, 'payload', $5,
         'RESERVED', 'pk', 'sig', $6::timestamptz, $6::timestamptz
       )`,
      [claimId, runId, wallet, dayKey, hash, `${dayKey}T12:00:00.000Z`],
    )
    await adminPool!.query(
      `insert into public.reward_risk_assessments (run_id, wallet, day_key, result)
       values ($1::uuid, $2, $3::date, $4::public.reward_risk_result)`,
      [runId, wallet, dayKey, result],
    )
    seeded.push({ claimId, runId, wallet })
  }
  return seeded
}

function createStore() {
  const pool = new Pool({
    host: harness!.host,
    port: harness!.port,
    user: 'postgres',
    password: 'postgres',
    database: 'postgres',
  })
  pool.on('error', () => undefined)
  pools.push(pool)
  return createPayoutStore(createPgPayoutRpcClient(async (sql, params) => {
    const result = await pool.query(sql, params)
    return result.rows[0]?.result
  }))
}

async function createService(): Promise<ProofService> {
  const pool = new Pool({
    host: harness!.host,
    port: harness!.port,
    user: 'postgres',
    password: 'postgres',
    database: 'postgres',
  })
  pool.on('error', () => undefined)
  pools.push(pool)
  const rpc = createPgProofRpcClient(async (sql, params) => {
    const result = await pool.query(sql, params)
    return result.rows[0]?.result
  })
  const dayKey = utcDayKey(new Date())
  const service = await createPostgresProofService({ rpc, blueprints: [] })
  for (const mission of ['gem-runner', 'chest-hunter', 'vault-breaker'] as const) {
    if (!(await service.getPublishedBlueprint(dayKey, mission))) {
      const source = createRoom01Blueprint(dayKey, mission, `payout-${mission}`)
      await service.registerBlueprint({ ...source, status: 'PUBLISHED', blueprintHash: hashBlueprint(source) })
    }
  }
  return service
}

async function completeReserved() {
  const playing = await completeEligible()
  const prepared = await playing.service.prepareRewardClaim(playing.runId, playing.session)
  if (prepared.outcome !== 'PREPARED') throw new Error('PREPARED_REQUIRED')
  const reserved = await playing.service.finalizeRewardClaim({
    session: playing.session,
    claimId: prepared.claimId,
    payload: prepared.canonicalPayload,
    publicKey: playing.keyPair.publicKey.toHex(),
    signature: playing.keyPair.sign(nimiqSignedMessageHash(prepared.canonicalPayload)).toHex(),
  })
  return { ...playing, claimId: reserved.claimId }
}

async function completePrepared() {
  const playing = await completeEligible()
  const prepared = await playing.service.prepareRewardClaim(playing.runId, playing.session)
  if (prepared.outcome !== 'PREPARED') throw new Error('PREPARED_REQUIRED')
  return { ...playing, claimId: prepared.claimId }
}

async function completeEligible() {
  const service = await createService()
  const keyPair = KeyPair.generate()
  const wallet = keyPair.toAddress().toUserFriendlyAddress()
  const challenge = await service.issueStartChallenge(wallet, 'gem-runner')
  const payload = serializeStartPayload({
    version: 1,
    type: 'NIMHUNT_START_EXPEDITION',
    wallet,
    mission: 'gem-runner',
    dayKey: challenge.dayKey,
    challenge: challenge.challenge,
    blueprintId: challenge.blueprintId,
    blueprintHash: challenge.blueprintHash,
  })
  const start = await service.authorizeStart({
    payload,
    publicKey: keyPair.publicKey.toHex(),
    signature: keyPair.sign(nimiqSignedMessageHash(payload)).toHex(),
  })
  await service.markGameplayStarted(start.start.runId, start.session)
  const directions = decodeSequence(PREVALIDATED_ROOM_01_BOOTSTRAP_WINNING_SEQUENCES['gem-runner'])
  for (let index = 0; index < directions.length; index += 8) {
    const current = await service.getRun(start.start.runId)
    if (!current) throw new Error('RUN_MISSING')
    await service.appendCheckpoint({
      runId: start.start.runId,
      session: start.session,
      previousCheckpointHash: current.checkpointHash,
      actions: moves(index + 1, directions.slice(index, index + 8)),
    })
  }
  const run = await service.getRun(start.start.runId)
  if (!run) throw new Error('RUN_MISSING')
  await service.verifyExpedition({
    runId: run.runId,
    session: start.session,
    checkpointHash: run.checkpointHash,
  })
  const extraMs = (minimumPlausibleCompletionMs(run.seq) ?? 0) + 5_000
  await adminPool!.query(
    `update public.expedition_runs
     set started_at = started_at - make_interval(secs => $2::numeric / 1000.0),
         gameplay_started_at = case
           when gameplay_started_at is null then null
           else gameplay_started_at - make_interval(secs => $2::numeric / 1000.0)
         end
     where id = $1`,
    [run.runId, extraMs],
  )
  return { service, keyPair, wallet, session: start.session, runId: run.runId }
}

function moves(start: number, directions: readonly Direction[]): MoveAction[] {
  return directions.map((direction, index) => ({ seq: start + index, type: 'MOVE' as const, direction }))
}

function decodeSequence(encoded: string): Direction[] {
  return [...encoded].map(character => {
    if (character === 'U') return 'UP'
    if (character === 'D') return 'DOWN'
    if (character === 'L') return 'LEFT'
    if (character === 'R') return 'RIGHT'
    throw new Error(`INVALID_SEQUENCE_CHAR:${character}`)
  })
}

async function independentClient(): Promise<Client> {
  const client = new Client({
    host: harness!.host,
    port: harness!.port,
    user: 'postgres',
    password: 'postgres',
    database: 'postgres',
  })
  client.on('error', () => undefined)
  await client.connect()
  return client
}

function cryptoRandom(): string {
  return 'dddddddd-dddd-dddd-dddd-dddddddddddd'.replace(/d/g, () => Math.floor(Math.random() * 10).toString())
}

async function startPostgres() {
  const container = `nimhunt-payout-${process.pid}-${Date.now()}`
  const port = 57000 + Math.floor(Math.random() * 800)
  await execFileAsync('docker', [
    'run',
    '-d',
    '--name',
    container,
    '-e',
    'POSTGRES_PASSWORD=postgres',
    '-p',
    `${port}:5432`,
    'postgres:16-alpine',
  ])
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    try {
      await execFileAsync('docker', ['exec', container, 'pg_isready', '-U', 'postgres'])
      return { host: '127.0.0.1', port, container }
    } catch {
      await new Promise(resolve => setTimeout(resolve, 500))
    }
  }
  throw new Error('POSTGRES_UNAVAILABLE')
}
