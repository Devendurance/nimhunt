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
import { PREVALIDATED_ROOM_01_BOOTSTRAP_WINNING_SEQUENCES } from '../expeditions/room01BootstrapPrevalidation.ts'
import type { ProofService } from '../expeditions/types.ts'
import type { Direction, MoveAction } from '../../src/game/replay/types.ts'
import { utcDayKey } from '../ledger/utcDay.ts'
import { createPgPayoutRpcClient } from './db.ts'
import { createFakeTreasury } from './fakeTreasury.ts'
import { createPayoutService } from './service.ts'
import { createPayoutStore } from './store.ts'

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
    } finally {
      await anon.end()
      await authenticated.end()
    }
  }, 30_000)
})

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
