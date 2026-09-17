import { randomUUID } from 'node:crypto'
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { KeyPair } from '@nimiq/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { loadEnv } from 'vite'
import { Client, Pool } from 'pg'
import { hashBlueprint } from '../../src/game/replay/canonical.ts'
import { createRoom01Blueprint } from '../../src/game/world/room01.ts'
import { createSupabaseAdminClient, readServerSupabaseConfig } from '../ledger/config.ts'
import { serializeStartPayload, type StartExpeditionPayload } from './canonical.ts'
import { nimiqSignedMessageHash } from './crypto.ts'
import { ProofError } from './errors.ts'
import { dispatchExpeditionHttp, type ExpeditionHttpSecurity } from './http.ts'
import { createPgProofRpcClient } from './proofDb.ts'
import {
  hashInstallId,
  INSTALL_ID_HASH_PREFIX,
  isImpossibleRunSpeed,
  minimumPlausibleCompletionMs,
} from './riskGate.ts'
import { createPostgresProofService, createSupabaseProofService } from './postgresProofStore.ts'
import {
  CLAIM_SESSION_LIMIT,
  createRateLimiter,
  RATE_LIMIT_WINDOW_MS,
  RECOVERY_CHALLENGE_WALLET_LIMIT,
  START_CHALLENGE_WALLET_LIMIT,
} from './rateLimit.ts'
import { PREVALIDATED_ROOM_01_BOOTSTRAP_WINNING_SEQUENCES } from './room01BootstrapPrevalidation.ts'
import type { RunSessionRecord } from './session.ts'
import type { ProofService } from './types.ts'
import type { Direction, MoveAction } from '../../src/game/replay/types.ts'
import { utcDayKey } from '../ledger/utcDay.ts'
import { REWARD_BLOCK_TITLE, REWARD_REVIEW_TITLE } from '../../src/components/play/productCheckpoint.ts'
import { createRandomInstallId, getOrCreateInstallId, INSTALL_ID_STORAGE_KEY } from '../../src/domain/installId.ts'

const execFileAsync = promisify(execFile)
const sqlDir = join(dirname(fileURLToPath(import.meta.url)), '../ledger/sql')
const env = loadEnv('test', process.cwd(), '')
const liveConfig = readServerSupabaseConfig({
  SUPABASE_URL: env.SUPABASE_URL || process.env.SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY,
  SUPABASE_SECRET_KEY: env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SECRET_KEY,
})
const liveEnabled = Boolean(liveConfig) && (env.NIMHUNT_PROOF_INTEGRATION === '1' || process.env.NIMHUNT_PROOF_INTEGRATION === '1')
const dockerEnabled = process.env.NIMHUNT_PROOF_DOCKER === '1'
const anonKey = env.SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY

const SECURITY: ExpeditionHttpSecurity = {
  expectedOrigin: 'https://hunt.example',
  expectedHost: 'hunt.example',
  expectedProtocol: 'https',
  secureCookie: true,
}

const LIVE_SCHEMA_TABLES = [
  { name: 'daily_reward_pools', columns: 'day_key,total_slots,reserved_slots' },
  { name: 'daily_wallet_state', columns: 'day_key,wallet,expeditions_started,rewards_reserved' },
  { name: 'expedition_runs', columns: 'id,day_key,wallet,mission_type,status,reward_status,gameplay_started_at,checkpoint_hash,checkpoint_seq,terminal,trusted_final_summary' },
  { name: 'daily_expedition_blueprints', columns: 'id,day_key,mission_type,lifecycle,blueprint_id,blueprint_hash' },
  { name: 'expedition_start_challenges', columns: 'challenge_hash,wallet,mission_type,day_key,blueprint_id,consumed_at' },
  { name: 'run_sessions', columns: 'run_session_hash,run_id,wallet,expires_at,revoked_at' },
  { name: 'expedition_checkpoints', columns: 'run_id,seq,checkpoint_hash' },
  { name: 'expedition_checkpoint_batches', columns: 'run_id,seq_start,seq_end,previous_checkpoint_hash,batch_fingerprint,checkpoint_hash' },
  { name: 'expedition_vault_seals', columns: 'run_id,wallet,vault_seal_hash,vault_checkpoint_hash,verified_at' },
  { name: 'reward_claims', columns: 'claim_id,run_id,wallet,mission,day_key,claim_payload_hash,status' },
  { name: 'reward_risk_signals', columns: 'signal_id,kind,wallet,day_key,install_id_hash,run_id,pattern_hash,created_at' },
  { name: 'reward_risk_assessments', columns: 'assessment_id,run_id,wallet,day_key,install_id_hash,result,reason_codes,created_at,updated_at' },
] as const

const HISTORICAL_PAYOUT_ID = 'd19bf406-2b81-4c5a-b271-da8eb7587cbd'
const HISTORICAL_CLAIM_ID = '40891624-e2c2-471f-aa9a-9674ca6200a7'
const RISK_RPCS = [
  ['record_reward_risk_signal', {
    p_kind: 'CLAIM',
    p_wallet: 'NQ-TEST',
    p_day_key: '1970-01-01',
    p_install_id_hash: 'a'.repeat(64),
    p_run_id: null,
    p_pattern_hash: null,
  }],
  ['load_reward_risk_context', {
    p_run_id: '00000000-0000-0000-0000-000000000000',
    p_run_session_hash: 'a'.repeat(64),
    p_install_id_hash: null,
    p_pattern_hash: null,
  }],
  ['upsert_reward_risk_assessment', {
    p_run_id: '00000000-0000-0000-0000-000000000000',
    p_run_session_hash: 'a'.repeat(64),
    p_install_id_hash: null,
    p_result: 'PASS',
    p_reason_codes: [],
  }],
  ['get_reward_risk_assessment', {
    p_run_id: '00000000-0000-0000-0000-000000000000',
    p_run_session_hash: 'a'.repeat(64),
  }],
] as const

type PgHarness = {
  readonly kind: 'docker'
  readonly host: string
  readonly port: number
  readonly container: string
}

let harness: PgHarness | null = null
let adminPool: Pool | null = null
const pools: Pool[] = []

describe.skipIf(!dockerEnabled)('postgres proof adapter', () => {
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
    await applySql(adminPool, roleSetupSql())
    await applySql(adminPool, readFileSync(join(sqlDir, '001_daily_ledger.sql'), 'utf8'))
    await applySql(adminPool, readFileSync(join(sqlDir, '002_expedition_proof.sql'), 'utf8'))
    await applySql(adminPool, readFileSync(join(sqlDir, '003_expedition_proof_runtime.sql'), 'utf8'))
    await applySql(adminPool, readFileSync(join(sqlDir, '004_reward_claims.sql'), 'utf8'))
    await applySql(adminPool, readFileSync(join(sqlDir, '006_reward_claim_session_recovery.sql'), 'utf8'))
    await applySql(adminPool, readFileSync(join(sqlDir, '007_wallet_recovery_session.sql'), 'utf8'))
    await applySql(adminPool, readFileSync(join(sqlDir, '008_reward_risk_gate.sql'), 'utf8'))
  }, 120_000)

  afterAll(async () => {
    await Promise.all(pools.map(pool => pool.end().catch(() => undefined)))
    await adminPool?.end().catch(() => undefined)
    if (harness) await execFileAsync('docker', ['rm', '-f', harness.container]).catch(() => undefined)
  }, 30_000)

  it('applies migrations and enforces one published blueprint per day/mission', async () => {
    const service = await createService()
    const dayKey = utcDayKey(new Date())
    const stored = await service.getPublishedBlueprint(dayKey, 'gem-runner')
    expect(stored?.status).toBe('PUBLISHED')
    expect(stored?.blueprintHash).toMatch(/^[0-9a-f]{64}$/)
    await expect(service.registerBlueprint(publishedBlueprint(dayKey, 'gem-runner', 'pg-blueprint-b'))).rejects.toMatchObject({
      code: 'BLUEPRINT_ALREADY_PUBLISHED',
    })
    if (stored) await service.registerBlueprint(stored)
    expect((await service.getPublishedBlueprint(dayKey, 'gem-runner'))?.blueprintId).toBe(stored?.blueprintId)
  }, 30_000)

  it('atomically starts one signed run and stores only the session hash', async () => {
    const { service, start, capability } = await signedStart()
    expect(start.outcome).toBe('START_CREATED')
    expect(start.start.attemptsRemaining).toBe(2)
    const run = await service.getRun(start.start.runId)
    expect(run).toMatchObject({ seq: 0, status: 'STARTED', runChallenge: start.start.runChallenge })
    const snapshot = await service.snapshot()
    expect(JSON.stringify(snapshot)).not.toContain(capability)
    expect(snapshot.sessions.some(session => session.sessionHash === start.session.sessionHash)).toBe(true)
    expect(snapshot.sessions.every(session => /^[0-9a-f]{64}$/.test(session.sessionHash))).toBe(true)
  }, 30_000)

  it('returns the exact start on retry and never exceeds 3 attempts', async () => {
    const { service, keyPair, wallet, start, request } = await signedStart()
    const retry = await service.authorizeStart(request)
    expect(retry.outcome).toBe('START_ALREADY_CREATED')
    expect(retry.start).toEqual(start.start)
    expect(retry.sessionCapability).not.toBe(start.sessionCapability)
    expect((await service.getWalletDailyStatus(wallet)).expeditionsStarted).toBe(1)

    await signedStart({ service, keyPair, wallet, mission: 'chest-hunter' })
    await signedStart({ service, keyPair, wallet, mission: 'vault-breaker' })
    await expect(signedStart({ service, keyPair, wallet, mission: 'gem-runner' })).rejects.toMatchObject({
      code: 'DAILY_EXPEDITION_LIMIT_REACHED',
    })
    expect((await service.getWalletDailyStatus(wallet)).expeditionsStarted).toBe(3)
  }, 30_000)

  it('gives exactly one run to concurrent duplicate signed starts', async () => {
    const { service, request } = await prepareUnsigned()
    const other = await createService()
    const [first, second] = await Promise.all([
      service.authorizeStart(request),
      other.authorizeStart(request),
    ])
    const created = [first, second]
    expect(created.filter(result => result.outcome === 'START_CREATED')).toHaveLength(1)
    expect(created.filter(result => result.outcome === 'START_ALREADY_CREATED')).toHaveLength(1)
    expect(first.start.runId).toBe(second.start.runId)
    const run = await service.getRun(first.start.runId)
    expect((await service.getWalletDailyStatus(run!.wallet)).expeditionsStarted).toBe(1)
  }, 30_000)

  it('retries an exact checkpoint and rejects a racing different batch', async () => {
    const playing = await startPlaying()
    const actions = moves(1, 'LEFT')
    const request = {
      runId: playing.run.runId,
      session: playing.start.session,
      previousCheckpointHash: playing.run.checkpointHash,
      actions,
    }
    const [first, second] = await Promise.all([
      playing.service.appendCheckpoint(request),
      playing.service.appendCheckpoint(request),
    ])
    expect(second).toEqual(first)
    expect((await playing.service.getRun(playing.run.runId))?.seq).toBe(1)

    const other = await createService()
    const left = moves(1, 'LEFT')
    const right = moves(1, 'RIGHT')
    const racing = await startPlaying()
    const results = await Promise.allSettled([
      racing.service.appendCheckpoint({
        runId: racing.run.runId,
        session: racing.start.session,
        previousCheckpointHash: racing.run.checkpointHash,
        actions: left,
      }),
      other.appendCheckpoint({
        runId: racing.run.runId,
        session: racing.start.session,
        previousCheckpointHash: racing.run.checkpointHash,
        actions: right,
      }),
    ])
    const fulfilled = results.filter(result => result.status === 'fulfilled')
    const rejected = results.filter(result => result.status === 'rejected' && result.reason instanceof ProofError && result.reason.code === 'CHECKPOINT_MISMATCH')
    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect((await racing.service.getRun(racing.run.runId))?.seq).toBe(1)
  }, 30_000)

  it('persists final Gem replay as VERIFIED_ELIGIBLE across adapter restart', async () => {
    const playing = await startPlaying('gem-runner')
    const completed = await playSequence(playing.service, playing.start.session, playing.run.runId, PREVALIDATED_ROOM_01_BOOTSTRAP_WINNING_SEQUENCES['gem-runner'])
    const verified = await playing.service.verifyExpedition({
      runId: completed.runId,
      session: playing.start.session,
      checkpointHash: completed.checkpointHash,
    })
    expect(verified.outcome).toBe('VERIFIED_ELIGIBLE')
    expect(verified.status).toBe('COMPLETED')
    expect(verified.rewardStatus).toBe('ELIGIBLE')
    const retry = await playing.service.verifyExpedition({
      runId: completed.runId,
      session: playing.start.session,
      checkpointHash: completed.checkpointHash,
    })
    expect(retry).toEqual(verified)
    expect((await playing.service.getWalletDailyStatus(playing.wallet)).expeditionsRemaining).toBe(2)

    const restarted = await createService({ skipBlueprints: true })
    const stored = await restarted.getRun(completed.runId)
    expect(stored?.terminal?.type).toBe('VERIFIED')
    expect(stored?.status).toBe('COMPLETED')
    await expect(restarted.appendCheckpoint({
      runId: completed.runId,
      session: playing.start.session,
      previousCheckpointHash: completed.checkpointHash,
      actions: moves(completed.seq + 1, 'LEFT'),
    })).rejects.toMatchObject({ code: 'RUN_NOT_ACTIVE' })
  }, 30_000)

  it('freezes Vault gameplay and persists one run-bound seal', async () => {
    const playing = await startPlaying('vault-breaker')
    const completed = await playSequence(playing.service, playing.start.session, playing.run.runId, PREVALIDATED_ROOM_01_BOOTSTRAP_WINNING_SEQUENCES['vault-breaker'])
    const verified = await playing.service.verifyExpedition({
      runId: completed.runId,
      session: playing.start.session,
      checkpointHash: completed.checkpointHash,
    })
    expect(verified.outcome).toBe('VAULT_GAMEPLAY_VERIFIED')
    expect(verified.status).toBe('STARTED')
    expect(verified.rewardStatus).toBe('NONE')
    const prepared = await playing.service.prepareVaultSeal(completed.runId, playing.start.session)
    const signature = playing.keyPair.sign(nimiqSignedMessageHash(prepared.canonicalPayload)).toHex()
    const sealed = await playing.service.verifyVaultSeal({
      session: playing.start.session,
      payload: prepared.canonicalPayload,
      publicKey: playing.keyPair.publicKey.toHex(),
      signature,
    })
    expect(sealed.vaultSealHash).toBe(prepared.vaultSealHash)
    const retry = await playing.service.verifyVaultSeal({
      session: playing.start.session,
      payload: prepared.canonicalPayload,
      publicKey: playing.keyPair.publicKey.toHex(),
      signature,
    })
    expect(retry).toEqual(sealed)
    expect((await playing.service.getRun(completed.runId))?.vaultSeal?.canonicalPayload).toBe(prepared.canonicalPayload)
    expect((await playing.service.getWalletDailyStatus(playing.wallet)).expeditionsRemaining).toBe(2)
  }, 30_000)

  it('rejects expired and revoked sessions', async () => {
    const playing = await startPlaying()
    await adminPool!.query('update public.run_sessions set created_at = timezone(\'utc\', now()) - interval \'2 seconds\', expires_at = timezone(\'utc\', now()) - interval \'1 second\' where run_session_hash = $1', [playing.start.session.sessionHash])
    await expect(playing.service.authenticateSession(playing.capability)).rejects.toMatchObject({ code: 'SESSION_EXPIRED' })

    const active = await startPlaying()
    await adminPool!.query('update public.run_sessions set revoked_at = timezone(\'utc\', now()) where run_session_hash = $1', [active.start.session.sessionHash])
    await expect(active.service.authenticateSession(active.capability)).rejects.toMatchObject({ code: 'SESSION_REVOKED' })
  }, 30_000)

  it('rejects anon and authenticated writes and protected RPC use', async () => {
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
      await expect(anon.query('insert into public.expedition_runs (day_key, wallet, mission_type, status) values (current_date, \'NQ-TEST\', \'gem-runner\', \'STARTED\')')).rejects.toThrow()
      const existing = await adminPool!.query('select id from public.daily_expedition_blueprints limit 1')
      const blueprintId = existing.rows[0]?.id as string | undefined
      if (blueprintId) {
        expect((await anon.query('update public.daily_expedition_blueprints set rules_version = rules_version where id = $1 returning id', [blueprintId])).rowCount).toBe(0)
        expect((await anon.query('delete from public.daily_expedition_blueprints where id = $1 returning id', [blueprintId])).rowCount).toBe(0)
      }
      expect((await anon.query('delete from public.expedition_checkpoint_batches returning run_id')).rowCount).toBe(0)
      await expect(authenticated.query('insert into public.run_sessions (run_session_hash, run_id, wallet, created_at, expires_at) values (repeat(\'a\', 64), gen_random_uuid(), \'NQ-TEST\', timezone(\'utc\', now()), timezone(\'utc\', now()) + interval \'1 hour\')')).rejects.toThrow()
      expect((await anon.query("select has_function_privilege('anon', 'public.append_checkpoint_batch(uuid,text,text,jsonb,integer,integer,text,text,text,text,jsonb,jsonb)', 'EXECUTE') as allowed")).rows[0]?.allowed).toBe(false)
      expect((await authenticated.query("select has_function_privilege('authenticated', 'public.start_expedition_authorized(text,text,text,text,date,text,text,uuid,text,text,text,text,text,jsonb,timestamptz)', 'EXECUTE') as allowed")).rows[0]?.allowed).toBe(false)
      const service = await createService()
      const published = await service.getPublishedBlueprint(utcDayKey(new Date()), 'gem-runner')
      expect(published).not.toBeNull()
    } finally {
      await anon.end()
      await authenticated.end()
    }
  }, 30_000)

  it('serves the product HTTP gem flow against postgres', async () => {
    const playing = await startPlaying('gem-runner')
    const cookie = cookieHeader(playing.capability)
    await dispatchExpeditionHttp(playing.service, {
      method: 'POST',
      path: '/api/expeditions/gameplay-start',
      headers: headers(cookie),
      body: { runId: playing.run.runId },
    }, SECURITY)
    const directions = decodeSequence(PREVALIDATED_ROOM_01_BOOTSTRAP_WINNING_SEQUENCES['gem-runner'])
    let previous = playing.run.checkpointHash
    for (let index = 0; index < directions.length; index += 8) {
      const batch = directions.slice(index, index + 8)
      const response = await dispatchExpeditionHttp(playing.service, {
        method: 'POST',
        path: '/api/expeditions/checkpoint',
        headers: headers(cookie),
        body: {
          runId: playing.run.runId,
          previousCheckpointHash: previous,
          actions: moves(index + 1, ...batch),
        },
      }, SECURITY)
      expect(response.status).toBe(200)
      previous = (response.body as { checkpointHash: string }).checkpointHash
    }
    const verified = await dispatchExpeditionHttp(playing.service, {
      method: 'POST',
      path: '/api/expeditions/verify',
      headers: headers(cookie),
      body: { runId: playing.run.runId, checkpointHash: previous },
    }, SECURITY)
    expect(verified.status).toBe(200)
    expect(verified.body).toMatchObject({ ok: true, outcome: 'VERIFIED_ELIGIBLE' })
  }, 30_000)

  it('reserves exactly once for concurrent finalize of the same claim', async () => {
    const playing = await completeEligible('gem-runner')
    const prepared = await playing.service.prepareRewardClaim(playing.run.runId, playing.start.session)
    expect(prepared.outcome).toBe('PREPARED')
    if (prepared.outcome !== 'PREPARED') throw new Error('PREPARED_REQUIRED')
    const signed = {
      session: playing.start.session,
      claimId: prepared.claimId,
      payload: prepared.canonicalPayload,
      publicKey: playing.keyPair.publicKey.toHex(),
      signature: playing.keyPair.sign(nimiqSignedMessageHash(prepared.canonicalPayload)).toHex(),
    }
    const other = await createService({ skipBlueprints: true })
    const before = await adminPool!.query('select reserved_slots from public.daily_reward_pools where day_key = $1', [playing.run.dayKey])
    const beforeSlots = Number(before.rows[0]?.reserved_slots ?? 0)
    const [first, second] = await Promise.all([
      playing.service.finalizeRewardClaim(signed),
      other.finalizeRewardClaim(signed),
    ])
    expect(first.outcome).toBe('RESERVED')
    expect(second).toEqual(first)
    const pool = await adminPool!.query('select reserved_slots from public.daily_reward_pools where day_key = $1', [playing.run.dayKey])
    expect(Number(pool.rows[0]?.reserved_slots)).toBe(beforeSlots + 1)
    const wallet = await adminPool!.query('select rewards_reserved from public.daily_wallet_state where day_key = $1 and wallet = $2', [playing.run.dayKey, playing.wallet])
    expect(Number(wallet.rows[0]?.rewards_reserved)).toBe(1)
  }, 30_000)

  it('gives one RESERVED and one ALREADY_REWARDED when the same wallet finalizes two runs', async () => {
    const first = await completeEligible('gem-runner')
    const prepared = await first.service.prepareRewardClaim(first.run.runId, first.start.session)
    if (prepared.outcome !== 'PREPARED') throw new Error('PREPARED_REQUIRED')
    await first.service.finalizeRewardClaim({
      session: first.start.session,
      claimId: prepared.claimId,
      payload: prepared.canonicalPayload,
      publicKey: first.keyPair.publicKey.toHex(),
      signature: first.keyPair.sign(nimiqSignedMessageHash(prepared.canonicalPayload)).toHex(),
    })
    const secondStart = await signedStart({
      service: first.service,
      keyPair: first.keyPair,
      wallet: first.wallet,
      mission: 'chest-hunter',
    })
    await first.service.markGameplayStarted(secondStart.start.start.runId, secondStart.start.session)
    const secondRun = await playSequence(first.service, secondStart.start.session, secondStart.start.start.runId, PREVALIDATED_ROOM_01_BOOTSTRAP_WINNING_SEQUENCES['chest-hunter'])
    await first.service.verifyExpedition({
      runId: secondRun.runId,
      session: secondStart.start.session,
      checkpointHash: secondRun.checkpointHash,
    })
    const blocked = await first.service.prepareRewardClaim(secondRun.runId, secondStart.start.session)
    expect(blocked.outcome).toBe('ALREADY_REWARDED')
    const wallet = await adminPool!.query('select rewards_reserved from public.daily_wallet_state where day_key = $1 and wallet = $2', [first.run.dayKey, first.wallet])
    expect(Number(wallet.rows[0]?.rewards_reserved)).toBe(1)
    const claims = await adminPool!.query('select status from public.reward_claims where run_id = $1', [secondRun.runId])
    expect(claims.rows[0]?.status).toBe('ALREADY_REWARDED')
  }, 30_000)

  it('gives exactly one RESERVED when two wallets race for slot 69', async () => {
    const first = await completeEligible('gem-runner')
    const second = await completeEligible('gem-runner')
    const firstPrepared = await first.service.prepareRewardClaim(first.run.runId, first.start.session)
    const secondPrepared = await second.service.prepareRewardClaim(second.run.runId, second.start.session)
    if (firstPrepared.outcome !== 'PREPARED' || secondPrepared.outcome !== 'PREPARED') throw new Error('PREPARED_REQUIRED')
    await adminPool!.query(
      'insert into public.daily_reward_pools (day_key, reserved_slots) values ($1, 68) on conflict (day_key) do update set reserved_slots = 68',
      [first.run.dayKey],
    )
    try {
      const results = await Promise.all([
        first.service.finalizeRewardClaim({
          session: first.start.session,
          claimId: firstPrepared.claimId,
          payload: firstPrepared.canonicalPayload,
          publicKey: first.keyPair.publicKey.toHex(),
          signature: first.keyPair.sign(nimiqSignedMessageHash(firstPrepared.canonicalPayload)).toHex(),
        }),
        second.service.finalizeRewardClaim({
          session: second.start.session,
          claimId: secondPrepared.claimId,
          payload: secondPrepared.canonicalPayload,
          publicKey: second.keyPair.publicKey.toHex(),
          signature: second.keyPair.sign(nimiqSignedMessageHash(secondPrepared.canonicalPayload)).toHex(),
        }),
      ])
      expect(results.filter(result => result.outcome === 'RESERVED')).toHaveLength(1)
      expect(results.filter(result => result.outcome === 'SOLD_OUT')).toHaveLength(1)
      const pool = await adminPool!.query('select reserved_slots from public.daily_reward_pools where day_key = $1', [first.run.dayKey])
      expect(Number(pool.rows[0]?.reserved_slots)).toBe(69)
      expect(Number(pool.rows[0]?.reserved_slots)).toBeLessThan(70)
    } finally {
      await syncReservedSlots(first.run.dayKey)
    }
  }, 30_000)

  it('consumes no slot for invalid signatures, expired claims, or RPC mismatch', async () => {
    const playing = await completeEligible('gem-runner')
    const prepared = await playing.service.prepareRewardClaim(playing.run.runId, playing.start.session)
    if (prepared.outcome !== 'PREPARED') throw new Error('PREPARED_REQUIRED')
    const before = await adminPool!.query('select reserved_slots from public.daily_reward_pools where day_key = $1', [playing.run.dayKey])
    const beforeSlots = Number(before.rows[0]?.reserved_slots ?? 0)
    const signed = {
      session: playing.start.session,
      claimId: prepared.claimId,
      payload: prepared.canonicalPayload,
      publicKey: playing.keyPair.publicKey.toHex(),
      signature: playing.keyPair.sign(nimiqSignedMessageHash(prepared.canonicalPayload)).toHex(),
    }
    await expect(playing.service.finalizeRewardClaim({
      ...signed,
      signature: signed.signature.endsWith('0') ? `${signed.signature.slice(0, -1)}1` : `${signed.signature.slice(0, -1)}0`,
    })).rejects.toMatchObject({ code: 'INVALID_SIGNATURE' })

    await expect(playing.service.finalizeRewardClaim({
      ...signed,
      payload: `${prepared.canonicalPayload} `,
    })).rejects.toMatchObject({ code: 'CLAIM_MISMATCH' })
    const after = await adminPool!.query('select reserved_slots from public.daily_reward_pools where day_key = $1', [playing.run.dayKey])
    expect(Number(after.rows[0]?.reserved_slots ?? 0)).toBe(beforeSlots)
    const stored = await adminPool!.query('select status, public_key, signature from public.reward_claims where claim_id = $1', [prepared.claimId])
    expect(stored.rows[0]).toMatchObject({ status: 'PREPARED', public_key: null, signature: null })
    const retry = await playing.service.prepareRewardClaim(playing.run.runId, playing.start.session)
    expect(retry.outcome).toBe('PREPARED')
    if (retry.outcome !== 'PREPARED') throw new Error('PREPARED_REQUIRED')
    expect(retry.claimId).toBe(prepared.claimId)
    const wallet = await adminPool!.query('select rewards_reserved from public.daily_wallet_state where day_key = $1 and wallet = $2', [playing.run.dayKey, playing.wallet])
    expect(Number(wallet.rows[0]?.rewards_reserved ?? 0)).toBe(0)
  }, 30_000)

  it('hardens reward claim schema, indexes, RLS, and service-only RPCs', async () => {
    const table = await adminPool!.query(`
      select c.relrowsecurity, c.relforcerowsecurity
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'reward_claims'
    `)
    expect(table.rows[0]).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true })

    const runUnique = await adminPool!.query(`
      select pg_catalog.pg_get_constraintdef(oid) as def
      from pg_catalog.pg_constraint
      where conrelid = 'public.reward_claims'::regclass and contype in ('u', 'p')
    `)
    expect(runUnique.rows.some(row => /run_id/i.test(String(row.def)) && /UNIQUE|PRIMARY/i.test(String(row.def)))).toBe(true)

    const statuses = await adminPool!.query(`
      select e.enumlabel
      from pg_catalog.pg_enum e
      join pg_catalog.pg_type t on t.oid = e.enumtypid
      where t.typname = 'reward_claim_status'
      order by e.enumsortorder
    `)
    expect(statuses.rows.map(row => row.enumlabel)).toEqual(['PREPARED', 'RESERVED', 'SOLD_OUT', 'ALREADY_REWARDED', 'EXPIRED'])

    const partial = await adminPool!.query(`
      select indexdef from pg_catalog.pg_indexes
      where schemaname = 'public' and indexname = 'reward_claims_one_reserved_per_wallet_day'
    `)
    expect(String(partial.rows[0]?.indexdef)).toMatch(/UNIQUE/i)
    expect(String(partial.rows[0]?.indexdef)).toMatch(/day_key/)
    expect(String(partial.rows[0]?.indexdef)).toMatch(/wallet/)
    expect(String(partial.rows[0]?.indexdef)).toMatch(/RESERVED/)

    for (const name of ['prepare_reward_claim', 'finalize_reward_claim', 'get_reward_claim', 'get_reserved_reward_claim_for_session']) {
      const fn = await adminPool!.query(`
        select p.prosecdef, p.proconfig
        from pg_catalog.pg_proc p
        join pg_catalog.pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = $1
      `, [name])
      expect(fn.rows[0]?.prosecdef).toBe(true)
      expect(JSON.stringify(fn.rows[0]?.proconfig ?? [])).toMatch(/search_path=[\s\S]*pg_catalog,\s*public/)
      const publicExecute = await adminPool!.query(`
        select bool_or(p.proacl is null or (acl.privilege_type = 'EXECUTE' and acl.grantee = 0)) as allowed
        from pg_catalog.pg_proc p
        join pg_catalog.pg_namespace n on n.oid = p.pronamespace
        left join lateral pg_catalog.aclexplode(p.proacl) acl on true
        where n.nspname = 'public' and p.proname = $1
      `, [name])
      expect(publicExecute.rows[0]?.allowed, `PUBLIC.${name}`).toBe(false)
      for (const role of ['anon', 'authenticated']) {
        const privilege = await adminPool!.query(`
          select pg_catalog.has_function_privilege(
            $1,
            p.oid,
            'EXECUTE'
          ) as allowed
          from pg_catalog.pg_proc p
          join pg_catalog.pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = $2
          limit 1
        `, [role, name])
        expect(privilege.rows[0]?.allowed, `${role}.${name}`).toBe(false)
      }
    }
  }, 30_000)

  it('gives exactly one RESERVED when the same wallet races two eligible claims', async () => {
    const first = await completeEligible('gem-runner')
    const secondStart = await signedStart({
      service: first.service,
      keyPair: first.keyPair,
      wallet: first.wallet,
      mission: 'chest-hunter',
    })
    await first.service.markGameplayStarted(secondStart.start.start.runId, secondStart.start.session)
    const secondRun = await playSequence(
      first.service,
      secondStart.start.session,
      secondStart.start.start.runId,
      PREVALIDATED_ROOM_01_BOOTSTRAP_WINNING_SEQUENCES['chest-hunter'],
    )
    await first.service.verifyExpedition({
      runId: secondRun.runId,
      session: secondStart.start.session,
      checkpointHash: secondRun.checkpointHash,
    })
    const firstPrepared = await first.service.prepareRewardClaim(first.run.runId, first.start.session)
    const secondPrepared = await first.service.prepareRewardClaim(secondRun.runId, secondStart.start.session)
    expect(firstPrepared.outcome).toBe('PREPARED')
    expect(secondPrepared.outcome).toBe('PREPARED')
    if (firstPrepared.outcome !== 'PREPARED' || secondPrepared.outcome !== 'PREPARED') throw new Error('PREPARED_REQUIRED')
    const other = await createService({ skipBlueprints: true })
    const before = await adminPool!.query('select reserved_slots from public.daily_reward_pools where day_key = $1', [first.run.dayKey])
    const beforeSlots = Number(before.rows[0]?.reserved_slots ?? 0)
    const beforeProof = await adminPool!.query(
      'select checkpoint_hash, terminal from public.expedition_runs where id = $1',
      [first.run.runId],
    )
    const results = await Promise.all([
      first.service.finalizeRewardClaim({
        session: first.start.session,
        claimId: firstPrepared.claimId,
        payload: firstPrepared.canonicalPayload,
        publicKey: first.keyPair.publicKey.toHex(),
        signature: first.keyPair.sign(nimiqSignedMessageHash(firstPrepared.canonicalPayload)).toHex(),
      }),
      other.finalizeRewardClaim({
        session: secondStart.start.session,
        claimId: secondPrepared.claimId,
        payload: secondPrepared.canonicalPayload,
        publicKey: first.keyPair.publicKey.toHex(),
        signature: first.keyPair.sign(nimiqSignedMessageHash(secondPrepared.canonicalPayload)).toHex(),
      }),
    ])
    expect(results.filter(result => result.outcome === 'RESERVED')).toHaveLength(1)
    expect(results.filter(result => result.outcome === 'ALREADY_REWARDED')).toHaveLength(1)
    const pool = await adminPool!.query('select reserved_slots from public.daily_reward_pools where day_key = $1', [first.run.dayKey])
    expect(Number(pool.rows[0]?.reserved_slots)).toBe(beforeSlots + 1)
    const wallet = await adminPool!.query(
      'select rewards_reserved, expeditions_started from public.daily_wallet_state where day_key = $1 and wallet = $2',
      [first.run.dayKey, first.wallet],
    )
    expect(Number(wallet.rows[0]?.rewards_reserved)).toBe(1)
    expect(Number(wallet.rows[0]?.expeditions_started)).toBe(2)
    const afterProof = await adminPool!.query(
      'select checkpoint_hash, terminal from public.expedition_runs where id = $1',
      [first.run.runId],
    )
    expect(afterProof.rows[0]).toEqual(beforeProof.rows[0])
  }, 30_000)

  it('reserves once across two independent postgres connections for the same claim', async () => {
    const playing = await completeEligible('gem-runner')
    const prepared = await playing.service.prepareRewardClaim(playing.run.runId, playing.start.session)
    if (prepared.outcome !== 'PREPARED') throw new Error('PREPARED_REQUIRED')
    const signature = playing.keyPair.sign(nimiqSignedMessageHash(prepared.canonicalPayload)).toHex()
    const publicKey = playing.keyPair.publicKey.toHex()
    const before = await adminPool!.query('select reserved_slots from public.daily_reward_pools where day_key = $1', [playing.run.dayKey])
    const beforeSlots = Number(before.rows[0]?.reserved_slots ?? 0)
    const clients = await Promise.all([independentPgClient(), independentPgClient()])
    try {
      const results = await Promise.all(clients.map(client => finalizeViaClient(client, {
        claimId: prepared.claimId,
        runId: playing.run.runId,
        sessionHash: playing.start.session.sessionHash,
        wallet: playing.wallet,
        payload: prepared.canonicalPayload,
        payloadHash: prepared.claimPayloadHash,
        publicKey,
        signature,
      })))
      expect(results.filter(result => result.outcome === 'RESERVED')).toHaveLength(2)
      expect(results.filter(result => result.existing === true)).toHaveLength(1)
      expect(results.filter(result => result.existing === false)).toHaveLength(1)
    } finally {
      await Promise.all(clients.map(client => client.end().catch(() => undefined)))
    }
    const pool = await adminPool!.query('select reserved_slots from public.daily_reward_pools where day_key = $1', [playing.run.dayKey])
    expect(Number(pool.rows[0]?.reserved_slots)).toBe(beforeSlots + 1)
    const wallet = await adminPool!.query(
      'select rewards_reserved from public.daily_wallet_state where day_key = $1 and wallet = $2',
      [playing.run.dayKey, playing.wallet],
    )
    expect(Number(wallet.rows[0]?.rewards_reserved)).toBe(1)
  }, 30_000)

  it('gives exactly one RESERVED when two independent connections race for slot 69', async () => {
    const first = await completeEligible('gem-runner')
    const second = await completeEligible('gem-runner')
    const firstPrepared = await first.service.prepareRewardClaim(first.run.runId, first.start.session)
    const secondPrepared = await second.service.prepareRewardClaim(second.run.runId, second.start.session)
    if (firstPrepared.outcome !== 'PREPARED' || secondPrepared.outcome !== 'PREPARED') throw new Error('PREPARED_REQUIRED')
    await adminPool!.query(
      'insert into public.daily_reward_pools (day_key, reserved_slots) values ($1, 68) on conflict (day_key) do update set reserved_slots = 68',
      [first.run.dayKey],
    )
    const clients = await Promise.all([independentPgClient(), independentPgClient()])
    try {
      const results = await Promise.all([
        finalizeViaClient(clients[0]!, {
          claimId: firstPrepared.claimId,
          runId: first.run.runId,
          sessionHash: first.start.session.sessionHash,
          wallet: first.wallet,
          payload: firstPrepared.canonicalPayload,
          payloadHash: firstPrepared.claimPayloadHash,
          publicKey: first.keyPair.publicKey.toHex(),
          signature: first.keyPair.sign(nimiqSignedMessageHash(firstPrepared.canonicalPayload)).toHex(),
        }),
        finalizeViaClient(clients[1]!, {
          claimId: secondPrepared.claimId,
          runId: second.run.runId,
          sessionHash: second.start.session.sessionHash,
          wallet: second.wallet,
          payload: secondPrepared.canonicalPayload,
          payloadHash: secondPrepared.claimPayloadHash,
          publicKey: second.keyPair.publicKey.toHex(),
          signature: second.keyPair.sign(nimiqSignedMessageHash(secondPrepared.canonicalPayload)).toHex(),
        }),
      ])
      expect(results.filter(result => result.outcome === 'RESERVED')).toHaveLength(1)
      expect(results.filter(result => result.outcome === 'SOLD_OUT')).toHaveLength(1)
      const pool = await adminPool!.query('select reserved_slots from public.daily_reward_pools where day_key = $1', [first.run.dayKey])
      expect(Number(pool.rows[0]?.reserved_slots)).toBe(69)
      expect(Number(pool.rows[0]?.reserved_slots)).toBeLessThan(70)
    } finally {
      await Promise.all(clients.map(client => client.end().catch(() => undefined)))
      await syncReservedSlots(first.run.dayKey)
    }
  }, 30_000)

  it('returns SOLD_OUT from prepare when the pool is full without incrementing wallet rewards', async () => {
    const playing = await completeEligible('gem-runner')
    const beforeWallet = await adminPool!.query(
      'select rewards_reserved, expeditions_started from public.daily_wallet_state where day_key = $1 and wallet = $2',
      [playing.run.dayKey, playing.wallet],
    )
    await adminPool!.query(
      'insert into public.daily_reward_pools (day_key, reserved_slots) values ($1, 69) on conflict (day_key) do update set reserved_slots = 69',
      [playing.run.dayKey],
    )
    try {
      const prepared = await playing.service.prepareRewardClaim(playing.run.runId, playing.start.session)
      expect(prepared.outcome).toBe('SOLD_OUT')
      const pool = await adminPool!.query('select reserved_slots from public.daily_reward_pools where day_key = $1', [playing.run.dayKey])
      expect(Number(pool.rows[0]?.reserved_slots)).toBe(69)
      const wallet = await adminPool!.query(
        'select rewards_reserved, expeditions_started from public.daily_wallet_state where day_key = $1 and wallet = $2',
        [playing.run.dayKey, playing.wallet],
      )
      expect(Number(wallet.rows[0]?.rewards_reserved)).toBe(Number(beforeWallet.rows[0]?.rewards_reserved ?? 0))
      expect(Number(wallet.rows[0]?.expeditions_started)).toBe(Number(beforeWallet.rows[0]?.expeditions_started))
    } finally {
      await syncReservedSlots(playing.run.dayKey)
    }
  }, 30_000)

  it('rolls back pool, wallet, and claim when finalize hits a database failure', async () => {
    const playing = await completeEligible('gem-runner')
    const prepared = await playing.service.prepareRewardClaim(playing.run.runId, playing.start.session)
    if (prepared.outcome !== 'PREPARED') throw new Error('PREPARED_REQUIRED')
    const beforePool = await adminPool!.query('select reserved_slots from public.daily_reward_pools where day_key = $1', [playing.run.dayKey])
    const beforeSlots = Number(beforePool.rows[0]?.reserved_slots ?? 0)
    const beforeWallet = await adminPool!.query(
      'select rewards_reserved from public.daily_wallet_state where day_key = $1 and wallet = $2',
      [playing.run.dayKey, playing.wallet],
    )
    const beforeRun = await adminPool!.query(
      'select checkpoint_hash, terminal, status, reward_status from public.expedition_runs where id = $1',
      [playing.run.runId],
    )
    await adminPool!.query(`
      create or replace function public.inject_reward_claim_failure()
      returns trigger
      language plpgsql
      as $$
      begin
        if new.status = 'RESERVED' then
          raise exception 'INJECTED_FAILURE';
        end if;
        return new;
      end;
      $$;
      drop trigger if exists reward_claims_inject_failure on public.reward_claims;
      create trigger reward_claims_inject_failure
      before update on public.reward_claims
      for each row execute function public.inject_reward_claim_failure();
    `)
    try {
      await expect(playing.service.finalizeRewardClaim({
        session: playing.start.session,
        claimId: prepared.claimId,
        payload: prepared.canonicalPayload,
        publicKey: playing.keyPair.publicKey.toHex(),
        signature: playing.keyPair.sign(nimiqSignedMessageHash(prepared.canonicalPayload)).toHex(),
      })).rejects.toMatchObject({ code: 'PROOF_UNAVAILABLE' })
      const afterPool = await adminPool!.query('select reserved_slots from public.daily_reward_pools where day_key = $1', [playing.run.dayKey])
      expect(Number(afterPool.rows[0]?.reserved_slots ?? 0)).toBe(beforeSlots)
      const afterWallet = await adminPool!.query(
        'select rewards_reserved from public.daily_wallet_state where day_key = $1 and wallet = $2',
        [playing.run.dayKey, playing.wallet],
      )
      expect(Number(afterWallet.rows[0]?.rewards_reserved ?? 0)).toBe(Number(beforeWallet.rows[0]?.rewards_reserved ?? 0))
      const claim = await adminPool!.query(
        'select status, public_key, signature, finalized_at from public.reward_claims where claim_id = $1',
        [prepared.claimId],
      )
      expect(claim.rows[0]).toMatchObject({ status: 'PREPARED', public_key: null, signature: null, finalized_at: null })
      const afterRun = await adminPool!.query(
        'select checkpoint_hash, terminal, status, reward_status from public.expedition_runs where id = $1',
        [playing.run.runId],
      )
      expect(afterRun.rows[0]).toEqual(beforeRun.rows[0])
    } finally {
      await adminPool!.query(`
        drop trigger if exists reward_claims_inject_failure on public.reward_claims;
        drop function if exists public.inject_reward_claim_failure();
      `)
    }
    const reserved = await playing.service.finalizeRewardClaim({
      session: playing.start.session,
      claimId: prepared.claimId,
      payload: prepared.canonicalPayload,
      publicKey: playing.keyPair.publicKey.toHex(),
      signature: playing.keyPair.sign(nimiqSignedMessageHash(prepared.canonicalPayload)).toHex(),
    })
    expect(reserved.outcome).toBe('RESERVED')
  }, 30_000)

  it('rejects anon/authenticated writes and claim RPC execution', async () => {
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
      await expect(anon.query('insert into public.reward_claims (claim_id, run_id, wallet, mission, day_key, canonical_payload, claim_payload_hash, status, expires_at) values (gen_random_uuid(), gen_random_uuid(), \'NQ-TEST\', \'gem-runner\', current_date, \'x\', repeat(\'a\', 64), \'PREPARED\', timezone(\'utc\', now()))')).rejects.toThrow()
      expect((await anon.query('update public.reward_claims set status = status returning claim_id')).rowCount).toBe(0)
      expect((await anon.query('delete from public.reward_claims returning claim_id')).rowCount).toBe(0)
      await expect(authenticated.query('insert into public.reward_claims (claim_id, run_id, wallet, mission, day_key, canonical_payload, claim_payload_hash, status, expires_at) values (gen_random_uuid(), gen_random_uuid(), \'NQ-TEST\', \'gem-runner\', current_date, \'x\', repeat(\'a\', 64), \'PREPARED\', timezone(\'utc\', now()))')).rejects.toThrow()
      expect((await authenticated.query('update public.reward_claims set status = status returning claim_id')).rowCount).toBe(0)
      expect((await authenticated.query('delete from public.reward_claims returning claim_id')).rowCount).toBe(0)
      expect((await anon.query("select has_function_privilege('anon', 'public.prepare_reward_claim(uuid,text,text,text,date,uuid,text,text,timestamptz)', 'EXECUTE') as allowed")).rows[0]?.allowed).toBe(false)
      expect((await authenticated.query("select has_function_privilege('authenticated', 'public.finalize_reward_claim(uuid,uuid,text,text,text,text,text,text)', 'EXECUTE') as allowed")).rows[0]?.allowed).toBe(false)
      expect((await anon.query("select has_function_privilege('anon', 'public.get_reward_claim(uuid,text)', 'EXECUTE') as allowed")).rows[0]?.allowed).toBe(false)
      expect((await authenticated.query("select has_function_privilege('authenticated', 'public.get_reward_claim(uuid,text)', 'EXECUTE') as allowed")).rows[0]?.allowed).toBe(false)
      expect((await anon.query("select has_function_privilege('anon', 'public.get_reserved_reward_claim_for_session(text)', 'EXECUTE') as allowed")).rows[0]?.allowed).toBe(false)
      expect((await authenticated.query("select has_function_privilege('authenticated', 'public.get_reserved_reward_claim_for_session(text)', 'EXECUTE') as allowed")).rows[0]?.allowed).toBe(false)
      await expect(anon.query("insert into public.reward_risk_assessments (run_id, wallet, day_key, result) values (gen_random_uuid(), 'NQ-TEST', current_date, 'PASS')")).rejects.toThrow()
      expect((await anon.query('select * from public.reward_risk_assessments')).rowCount).toBe(0)
      expect((await authenticated.query('select * from public.reward_risk_signals')).rowCount).toBe(0)
      expect((await anon.query("select has_function_privilege('anon', 'public.upsert_reward_risk_assessment(uuid,text,text,text,jsonb)', 'EXECUTE') as allowed")).rows[0]?.allowed).toBe(false)
      expect((await authenticated.query("select has_function_privilege('authenticated', 'public.record_reward_risk_signal(text,text,date,text,uuid,text)', 'EXECUTE') as allowed")).rows[0]?.allowed).toBe(false)
    } finally {
      await anon.end()
      await authenticated.end()
    }
  }, 30_000)

  it('does not consume a slot for REVIEW or BLOCK and still reserves on PASS', async () => {
    const playing = await completeEligible('gem-runner')
    const before = await adminPool!.query('select reserved_slots from public.daily_reward_pools where day_key = $1', [playing.run.dayKey])
    const prepared = await playing.service.prepareRewardClaim(playing.run.runId, playing.start.session, {
      installId: '11111111-1111-4111-8111-111111111111',
    })
    expect(prepared.outcome).toBe('PREPARED')
    if (prepared.outcome !== 'PREPARED') throw new Error('PREPARED_REQUIRED')
    const reserved = await playing.service.finalizeRewardClaim({
      session: playing.start.session,
      claimId: prepared.claimId,
      payload: prepared.canonicalPayload,
      publicKey: playing.keyPair.publicKey.toHex(),
      signature: playing.keyPair.sign(nimiqSignedMessageHash(prepared.canonicalPayload)).toHex(),
      risk: { installId: '11111111-1111-4111-8111-111111111111' },
    })
    expect(reserved.outcome).toBe('RESERVED')

    const fast = await startPlaying('gem-runner')
    const completed = await playSequence(
      fast.service,
      fast.start.session,
      fast.run.runId,
      PREVALIDATED_ROOM_01_BOOTSTRAP_WINNING_SEQUENCES['gem-runner'],
    )
    await fast.service.verifyExpedition({
      runId: completed.runId,
      session: fast.start.session,
      checkpointHash: completed.checkpointHash,
    })
    const blocked = await fast.service.prepareRewardClaim(completed.runId, fast.start.session)
    expect(blocked.outcome).toBe('BLOCK')
    const after = await adminPool!.query('select reserved_slots from public.daily_reward_pools where day_key = $1', [playing.run.dayKey])
    expect(after.rows[0]?.reserved_slots).toBe((before.rows[0]?.reserved_slots ?? 0) + 1)
  }, 30_000)

  it('reviews a third wallet on one install without consuming a slot', async () => {
    const installId = '22222222-2222-4222-8222-222222222222'
    const service = await createService()
    const before = await adminPool!.query('select coalesce(sum(reserved_slots), 0)::int as reserved from public.daily_reward_pools')
    let last = null
    for (let index = 0; index < 3; index += 1) {
      last = await completeEligible('gem-runner', service)
      await service.issueStartChallenge(last.wallet, 'gem-runner', { installId })
    }
    const reviewed = await last!.service.prepareRewardClaim(last!.run.runId, last!.start.session, { installId })
    expect(reviewed.outcome).toBe('REVIEW')
    const after = await adminPool!.query('select coalesce(sum(reserved_slots), 0)::int as reserved from public.daily_reward_pools')
    expect(after.rows[0]?.reserved).toBe(before.rows[0]?.reserved)
  }, 60_000)
})

describe.skipIf(!liveEnabled)('configured supabase proof adapter', () => {
  it('exposes the live 001/002/003/004/008 schema to the service role', async () => {
    const client = createSupabaseAdminClient(liveConfig!)
    for (const table of LIVE_SCHEMA_TABLES) {
      const query = await client.from(table.name).select(table.columns).limit(1)
      expect(query.error, table.name).toBeNull()
      expect(Array.isArray(query.data), table.name).toBe(true)
    }
    const missing = await client.from('daily_expedition_blueprints').select('id').eq('day_key', '1970-01-01').limit(1)
    expect(missing.error).toBeNull()
    const published = await client.rpc('get_published_blueprint', {
      p_day_key: '1970-01-01',
      p_mission_type: 'gem-runner',
    })
    expect(published.error).toBeNull()
    expect(published.data).toMatchObject({ ok: false, error: 'DAILY_BLUEPRINT_UNAVAILABLE' })
    const snapshot = await client.rpc('load_proof_snapshot')
    expect(snapshot.error).toBeNull()
    expect(snapshot.data).toMatchObject({ ok: true })
    const started = await client.rpc('start_expedition_authorized', {
      p_challenge_hash: 'a'.repeat(64),
      p_authorization_fingerprint: 'b'.repeat(64),
      p_wallet: 'NQ-TEST',
      p_mission_type: 'gem-runner',
      p_day_key: '1970-01-01',
      p_blueprint_id: 'x',
      p_blueprint_hash: 'c'.repeat(64),
      p_run_id: '00000000-0000-0000-0000-000000000000',
      p_run_challenge: 'd'.repeat(64),
      p_run_session_hash: 'e'.repeat(64),
      p_initial_state_hash: 'f'.repeat(64),
      p_initial_transcript_hash: '1'.repeat(64),
      p_initial_checkpoint_hash: '2'.repeat(64),
      p_initial_state: {},
      p_session_expires_at: '1970-01-02T00:00:00Z',
    })
    expect(started.error).toBeNull()
    expect(started.data).toMatchObject({ ok: false, error: 'START_CHALLENGE_INVALID' })
    const appended = await client.rpc('append_checkpoint_batch', {
      p_run_id: '00000000-0000-0000-0000-000000000000',
      p_run_session_hash: 'a'.repeat(64),
      p_previous_checkpoint_hash: 'b'.repeat(64),
      p_actions: [],
      p_seq_start: 1,
      p_seq_end: 1,
      p_batch_fingerprint: 'c'.repeat(64),
      p_transcript_hash: 'd'.repeat(64),
      p_state_hash: 'e'.repeat(64),
      p_checkpoint_hash: 'f'.repeat(64),
      p_replay_snapshot: {},
      p_acknowledgement: {},
    })
    expect(appended.error).toBeNull()
    expect(appended.data).toMatchObject({ ok: false, error: 'RUN_SESSION_INVALID' })
  }, 30_000)

  it('rejects unauthenticated and authenticated writes plus protected RPC use', async () => {
    const unauthenticated = await liveSupabaseFetch('/rest/v1/expedition_runs?select=id&limit=1', {
      apikey: 'invalid',
      token: 'invalid',
    })
    expect(unauthenticated.status).toBe(401)

    if (anonKey) {
      const { createClient } = await import('@supabase/supabase-js')
      const anon = createClient(liveConfig!.url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
      const insert = await anon.from('expedition_runs').insert({
        day_key: utcDayKey(new Date()),
        wallet: 'NQ-TEST',
        mission_type: 'gem-runner',
        status: 'STARTED',
      })
      expect(insert.error).toBeTruthy()
      const claimInsert = await anon.from('reward_claims').insert({
        claim_id: '00000000-0000-0000-0000-000000000000',
        run_id: '00000000-0000-0000-0000-000000000000',
        wallet: 'NQ-TEST',
        mission: 'gem-runner',
        day_key: utcDayKey(new Date()),
        canonical_payload: 'x',
        claim_payload_hash: 'a'.repeat(64),
        status: 'PREPARED',
        expires_at: '1970-01-01T00:00:00Z',
      })
      expect(claimInsert.error).toBeTruthy()
      const rpc = await anon.rpc('append_checkpoint_batch', {})
      expect(rpc.error).toBeTruthy()
      const claimRpc = await anon.rpc('prepare_reward_claim', {})
      expect(claimRpc.error).toBeTruthy()
      const riskInsert = await anon.from('reward_risk_assessments').insert({
        run_id: '00000000-0000-0000-0000-000000000000',
        wallet: 'NQ-TEST',
        day_key: utcDayKey(new Date()),
        result: 'PASS',
      })
      expect(riskInsert.error).toBeTruthy()
      const riskSignalInsert = await anon.from('reward_risk_signals').insert({
        kind: 'CLAIM',
        wallet: 'NQ-TEST',
        day_key: utcDayKey(new Date()),
      })
      expect(riskSignalInsert.error).toBeTruthy()
      for (const [name, payload] of RISK_RPCS) {
        const riskRpc = await anon.rpc(name, payload)
        expect(riskRpc.error, name).toBeTruthy()
      }
    }

    const email = `nimhunt.rls.${randomUUID().slice(0, 8)}@gmail.com`
    const password = `RlsProbe-${randomUUID()}`
    const created = await liveSupabaseFetch('/auth/v1/admin/users', {
      method: 'POST',
      token: liveConfig!.serviceRoleKey,
      body: { email, password, email_confirm: true },
    })
    expect(created.status).toBe(200)
    const userId = asLiveId(created.body)
    try {
      const token = await liveSupabaseFetch('/auth/v1/token?grant_type=password', {
        method: 'POST',
        token: liveConfig!.serviceRoleKey,
        body: { email, password },
      })
      expect(token.status).toBe(200)
      const accessToken = asLiveAccessToken(token.body)
      const tables = LIVE_SCHEMA_TABLES.map(table => table.name)
      for (const table of tables) {
        const read = await liveSupabaseFetch(`/rest/v1/${table}?select=*&limit=5`, { token: accessToken })
        expect(read.status, table).toBe(200)
        expect(read.body, table).toEqual([])
      }
      const inserts = [
        ['expedition_runs', { day_key: '1970-01-01', wallet: 'NQ-AUTH-RLS', mission_type: 'gem-runner', status: 'STARTED' }],
        ['daily_reward_pools', { day_key: '1970-01-02', total_slots: 69, reserved_slots: 0 }],
        ['daily_expedition_blueprints', {
          day_key: '1970-01-01',
          mission_type: 'gem-runner',
          lifecycle: 'DRAFT',
          rules_version: '1',
          room_version: '1',
          blueprint_version: '1',
          blueprint_id: `auth-rls-${randomUUID()}`,
          canonical_blueprint: {},
          blueprint_hash: 'a'.repeat(64),
        }],
        ['run_sessions', {
          run_session_hash: 'b'.repeat(64),
          run_id: '00000000-0000-0000-0000-000000000000',
          wallet: 'NQ-AUTH-RLS',
          created_at: '1970-01-01T00:00:00Z',
          expires_at: '1970-01-01T01:00:00Z',
        }],
        ['expedition_checkpoint_batches', {
          run_id: '00000000-0000-0000-0000-000000000000',
          seq_start: 1,
          seq_end: 1,
          previous_checkpoint_hash: 'a'.repeat(64),
          actions: [{}],
          batch_fingerprint: 'b'.repeat(64),
          transcript_hash: 'c'.repeat(64),
          state_hash: 'd'.repeat(64),
          checkpoint_hash: 'e'.repeat(64),
          acknowledgement: {},
        }],
        ['expedition_vault_seals', {
          run_id: '00000000-0000-0000-0000-000000000000',
          wallet: 'NQ-AUTH-RLS',
          canonical_payload: 'x',
          vault_seal_hash: 'a'.repeat(64),
          public_key: 'pk',
          signature: 'sig',
          vault_checkpoint_hash: 'b'.repeat(64),
          verified_at: '1970-01-01T00:00:00Z',
        }],
        ['reward_claims', {
          claim_id: '00000000-0000-0000-0000-000000000000',
          run_id: '00000000-0000-0000-0000-000000000000',
          wallet: 'NQ-AUTH-RLS',
          mission: 'gem-runner',
          day_key: '1970-01-01',
          canonical_payload: 'x',
          claim_payload_hash: 'a'.repeat(64),
          status: 'PREPARED',
          expires_at: '1970-01-01T00:00:00Z',
        }],
        ['reward_risk_signals', {
          kind: 'CLAIM',
          wallet: 'NQ-AUTH-RLS',
          day_key: '1970-01-01',
          install_id_hash: 'a'.repeat(64),
        }],
        ['reward_risk_assessments', {
          run_id: '00000000-0000-0000-0000-000000000000',
          wallet: 'NQ-AUTH-RLS',
          day_key: '1970-01-01',
          result: 'PASS',
        }],
      ] as const
      for (const [table, payload] of inserts) {
        const inserted = await liveSupabaseFetch(`/rest/v1/${table}`, {
          method: 'POST',
          token: accessToken,
          body: payload,
        })
        expect(inserted.status, table).toBe(403)
        expect(JSON.stringify(inserted.body), table).toMatch(/row-level security policy/)
      }
      const updated = await liveSupabaseFetch('/rest/v1/daily_expedition_blueprints?id=eq.00000000-0000-0000-0000-000000000000', {
        method: 'PATCH',
        token: accessToken,
        body: { rules_version: 'x' },
      })
      expect(updated.status).toBe(200)
      expect(updated.body).toEqual([])
      const deleted = await liveSupabaseFetch('/rest/v1/expedition_checkpoint_batches?seq_start=eq.1', {
        method: 'DELETE',
        token: accessToken,
      })
      expect(deleted.status).toBe(200)
      expect(deleted.body).toEqual([])
      const claimUpdated = await liveSupabaseFetch('/rest/v1/reward_claims?claim_id=eq.00000000-0000-0000-0000-000000000000', {
        method: 'PATCH',
        token: accessToken,
        body: { status: 'RESERVED' },
      })
      expect(claimUpdated.status).toBe(200)
      expect(claimUpdated.body).toEqual([])
      const claimDeleted = await liveSupabaseFetch('/rest/v1/reward_claims?claim_id=eq.00000000-0000-0000-0000-000000000000', {
        method: 'DELETE',
        token: accessToken,
      })
      expect(claimDeleted.status).toBe(200)
      expect(claimDeleted.body).toEqual([])
      const denied = [
        ['create_start_challenge', {
          p_wallet: 'NQ-TEST',
          p_mission_type: 'gem-runner',
          p_challenge_hash: 'a'.repeat(64),
          p_blueprint_id: 'x',
          p_blueprint_hash: 'b'.repeat(64),
        }],
        ['get_published_blueprint', { p_day_key: '1970-01-01', p_mission_type: 'gem-runner' }],
        ['get_wallet_daily_status', { p_wallet: 'NQ-TEST' }],
        ['load_proof_snapshot', {}],
        ['persist_vault_seal', {
          p_run_id: '00000000-0000-0000-0000-000000000000',
          p_run_session_hash: 'a'.repeat(64),
          p_wallet: 'x',
          p_canonical_payload: 'x',
          p_vault_seal_hash: 'a'.repeat(64),
          p_public_key: 'pk',
          p_signature: 'sig',
          p_vault_checkpoint_hash: 'b'.repeat(64),
          p_verified_at: '1970-01-01T00:00:00Z',
        }],
        ['prepare_reward_claim', {
          p_run_id: '00000000-0000-0000-0000-000000000000',
          p_run_session_hash: 'a'.repeat(64),
          p_wallet: 'x',
          p_mission: 'gem-runner',
          p_day_key: '1970-01-01',
          p_claim_id: '00000000-0000-0000-0000-000000000000',
          p_canonical_payload: 'x',
          p_claim_payload_hash: 'a'.repeat(64),
          p_expires_at: '1970-01-01T00:00:00Z',
        }],
        ['finalize_reward_claim', {
          p_claim_id: '00000000-0000-0000-0000-000000000000',
          p_run_id: '00000000-0000-0000-0000-000000000000',
          p_run_session_hash: 'a'.repeat(64),
          p_wallet: 'x',
          p_canonical_payload: 'x',
          p_claim_payload_hash: 'a'.repeat(64),
          p_public_key: 'pk',
          p_signature: 'sig',
        }],
        ['get_reward_claim', {
          p_claim_id: '00000000-0000-0000-0000-000000000000',
          p_run_session_hash: 'a'.repeat(64),
        }],
        ['get_reserved_reward_claim_for_session', {
          p_run_session_hash: 'a'.repeat(64),
        }],
        ...RISK_RPCS,
      ] as const
      for (const [name, payload] of denied) {
        const rpc = await liveSupabaseFetch(`/rest/v1/rpc/${name}`, {
          method: 'POST',
          token: accessToken,
          body: payload,
        })
        expect(rpc.status, name).toBe(403)
        expect(JSON.stringify(rpc.body), name).toMatch(/permission denied for function/)
      }
    } finally {
      if (userId) {
        await liveSupabaseFetch(`/auth/v1/admin/users/${userId}`, {
          method: 'DELETE',
          token: liveConfig!.serviceRoleKey,
        })
      }
    }
  }, 30_000)

  it('atomically starts one signed run and stores only the session hash', async () => {
    const { service, start, capability } = await signedStart({ service: await createLiveService() })
    expect(start.outcome).toBe('START_CREATED')
    expect(start.start.attemptsRemaining).toBe(2)
    expect(await service.getRun(start.start.runId)).toMatchObject({
      seq: 0,
      status: 'STARTED',
      runChallenge: start.start.runChallenge,
    })
    const snapshot = await service.snapshot()
    expect(JSON.stringify(snapshot)).not.toContain(capability)
    expect(snapshot.sessions.some(session => session.sessionHash === start.session.sessionHash)).toBe(true)
    expect(snapshot.sessions.every(session => /^[0-9a-f]{64}$/.test(session.sessionHash))).toBe(true)
  }, 60_000)

  it('returns the exact start on retry and never exceeds 3 attempts', async () => {
    const { service, keyPair, wallet, start, request } = await signedStart({ service: await createLiveService() })
    const retry = await service.authorizeStart(request)
    expect(retry.outcome).toBe('START_ALREADY_CREATED')
    expect(retry.start).toEqual(start.start)
    expect(retry.sessionCapability).not.toBe(start.sessionCapability)
    expect((await service.getWalletDailyStatus(wallet)).expeditionsStarted).toBe(1)

    await signedStart({ service, keyPair, wallet, mission: 'chest-hunter' })
    await signedStart({ service, keyPair, wallet, mission: 'vault-breaker' })
    await expect(signedStart({ service, keyPair, wallet, mission: 'gem-runner' })).rejects.toMatchObject({
      code: 'DAILY_EXPEDITION_LIMIT_REACHED',
    })
    expect((await service.getWalletDailyStatus(wallet)).expeditionsStarted).toBe(3)
  }, 60_000)

  it('gives exactly one run to concurrent duplicate signed starts', async () => {
    const service = await createLiveService()
    const other = await createLiveService({ skipBlueprints: true })
    const prepared = await prepareUnsigned(service)
    const [first, second] = await Promise.all([
      service.authorizeStart(prepared.request),
      other.authorizeStart(prepared.request),
    ])
    expect([first, second].filter(result => result.outcome === 'START_CREATED')).toHaveLength(1)
    expect([first, second].filter(result => result.outcome === 'START_ALREADY_CREATED')).toHaveLength(1)
    expect(first.start.runId).toBe(second.start.runId)
    expect((await service.getWalletDailyStatus(prepared.wallet)).expeditionsStarted).toBe(1)
  }, 60_000)

  it('retries an exact checkpoint and rejects a racing different batch', async () => {
    const playing = await startPlaying('gem-runner', await createLiveService())
    const request = {
      runId: playing.run.runId,
      session: playing.start.session,
      previousCheckpointHash: playing.run.checkpointHash,
      actions: moves(1, 'LEFT'),
    }
    const [first, second] = await Promise.all([
      playing.service.appendCheckpoint(request),
      playing.service.appendCheckpoint(request),
    ])
    expect(second).toEqual(first)
    expect((await playing.service.getRun(playing.run.runId))?.seq).toBe(1)

    const other = await createLiveService({ skipBlueprints: true })
    const racing = await startPlaying('chest-hunter', await createLiveService())
    const results = await Promise.allSettled([
      racing.service.appendCheckpoint({
        runId: racing.run.runId,
        session: racing.start.session,
        previousCheckpointHash: racing.run.checkpointHash,
        actions: moves(1, 'LEFT'),
      }),
      other.appendCheckpoint({
        runId: racing.run.runId,
        session: racing.start.session,
        previousCheckpointHash: racing.run.checkpointHash,
        actions: moves(1, 'RIGHT'),
      }),
    ])
    const fulfilled = results.filter(result => result.status === 'fulfilled')
    const rejected = results.filter(result => result.status === 'rejected' && result.reason instanceof ProofError && result.reason.code === 'CHECKPOINT_MISMATCH')
    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect((await racing.service.getRun(racing.run.runId))?.seq).toBe(1)
  }, 60_000)

  it('persists final Gem replay as VERIFIED_ELIGIBLE across adapter restart', async () => {
    const playing = await startPlaying('gem-runner', await createLiveService())
    const completed = await playSequence(playing.service, playing.start.session, playing.run.runId, PREVALIDATED_ROOM_01_BOOTSTRAP_WINNING_SEQUENCES['gem-runner'])
    const verified = await playing.service.verifyExpedition({
      runId: completed.runId,
      session: playing.start.session,
      checkpointHash: completed.checkpointHash,
    })
    expect(verified.outcome).toBe('VERIFIED_ELIGIBLE')
    expect(verified.status).toBe('COMPLETED')
    expect(verified.rewardStatus).toBe('ELIGIBLE')
    expect(await playing.service.verifyExpedition({
      runId: completed.runId,
      session: playing.start.session,
      checkpointHash: completed.checkpointHash,
    })).toEqual(verified)
    expect((await playing.service.getWalletDailyStatus(playing.wallet)).expeditionsRemaining).toBe(2)

    const restarted = await createLiveService({ skipBlueprints: true })
    const stored = await restarted.getRun(completed.runId)
    expect(stored?.terminal?.type).toBe('VERIFIED')
    expect(stored?.status).toBe('COMPLETED')
    await expect(restarted.appendCheckpoint({
      runId: completed.runId,
      session: playing.start.session,
      previousCheckpointHash: completed.checkpointHash,
      actions: moves(completed.seq + 1, 'LEFT'),
    })).rejects.toMatchObject({ code: 'RUN_NOT_ACTIVE' })
  }, 60_000)

  it('freezes Vault gameplay and persists one run-bound seal', async () => {
    const playing = await startPlaying('vault-breaker', await createLiveService())
    const completed = await playSequence(playing.service, playing.start.session, playing.run.runId, PREVALIDATED_ROOM_01_BOOTSTRAP_WINNING_SEQUENCES['vault-breaker'])
    const verified = await playing.service.verifyExpedition({
      runId: completed.runId,
      session: playing.start.session,
      checkpointHash: completed.checkpointHash,
    })
    expect(verified.outcome).toBe('VAULT_GAMEPLAY_VERIFIED')
    expect(verified.status).toBe('STARTED')
    expect(verified.rewardStatus).toBe('NONE')
    const prepared = await playing.service.prepareVaultSeal(completed.runId, playing.start.session)
    const signature = playing.keyPair.sign(nimiqSignedMessageHash(prepared.canonicalPayload)).toHex()
    const sealed = await playing.service.verifyVaultSeal({
      session: playing.start.session,
      payload: prepared.canonicalPayload,
      publicKey: playing.keyPair.publicKey.toHex(),
      signature,
    })
    expect(sealed.vaultSealHash).toBe(prepared.vaultSealHash)
    expect(await playing.service.verifyVaultSeal({
      session: playing.start.session,
      payload: prepared.canonicalPayload,
      publicKey: playing.keyPair.publicKey.toHex(),
      signature,
    })).toEqual(sealed)
    expect((await playing.service.getRun(completed.runId))?.vaultSeal?.canonicalPayload).toBe(prepared.canonicalPayload)
    expect((await playing.service.getWalletDailyStatus(playing.wallet)).expeditionsRemaining).toBe(2)
  }, 60_000)

  it('prepares, signs, and atomically reserves one live reward claim', async () => {
    const playing = await completeEligible('gem-runner', await createLiveService())
    const before = await playing.service.getWalletDailyStatus(playing.wallet)
    const beforeRun = await playing.service.getRun(playing.run.runId)
    const prepared = await playing.service.prepareRewardClaim(playing.run.runId, playing.start.session)
    expect(prepared.outcome).toBe('PREPARED')
    if (prepared.outcome !== 'PREPARED') throw new Error('PREPARED_REQUIRED')
    expect(prepared.canonicalPayload).toContain('NIMHUNT_REWARD_CLAIM_V1')
    const retriedPrepare = await playing.service.prepareRewardClaim(playing.run.runId, playing.start.session)
    expect(retriedPrepare).toEqual(prepared)
    const signed = {
      session: playing.start.session,
      claimId: prepared.claimId,
      payload: prepared.canonicalPayload,
      publicKey: playing.keyPair.publicKey.toHex(),
      signature: playing.keyPair.sign(nimiqSignedMessageHash(prepared.canonicalPayload)).toHex(),
    }
    await expect(playing.service.finalizeRewardClaim({
      ...signed,
      signature: signed.signature.endsWith('0') ? `${signed.signature.slice(0, -1)}1` : `${signed.signature.slice(0, -1)}0`,
    })).rejects.toMatchObject({ code: 'INVALID_SIGNATURE' })
    const retried = await playing.service.prepareRewardClaim(playing.run.runId, playing.start.session)
    expect(retried.outcome === 'PREPARED' ? retried.claimId : null).toBe(prepared.claimId)
    expect((await playing.service.getWalletDailyStatus(playing.wallet)).rewardAlreadyReserved).toBe(false)

    const reserved = await playing.service.finalizeRewardClaim(signed)
    expect(reserved.outcome).toBe('RESERVED')
    const retry = await playing.service.finalizeRewardClaim(signed)
    expect(retry).toEqual(reserved)
    const after = await playing.service.getWalletDailyStatus(playing.wallet)
    expect(after.rewardAlreadyReserved).toBe(true)
    expect(after.expeditionsStarted).toBe(before.expeditionsStarted)
    const afterRun = await playing.service.getRun(playing.run.runId)
    expect(afterRun?.checkpointHash).toBe(beforeRun?.checkpointHash)
    expect(afterRun?.terminal).toEqual(beforeRun?.terminal)
    expect(afterRun?.seq).toBe(beforeRun?.seq)

    const secondStart = await signedStart({
      service: playing.service,
      keyPair: playing.keyPair,
      wallet: playing.wallet,
      mission: 'chest-hunter',
    })
    await playing.service.markGameplayStarted(secondStart.start.start.runId, secondStart.start.session)
    const secondRun = await playSequence(
      playing.service,
      secondStart.start.session,
      secondStart.start.start.runId,
      PREVALIDATED_ROOM_01_BOOTSTRAP_WINNING_SEQUENCES['chest-hunter'],
    )
    await playing.service.verifyExpedition({
      runId: secondRun.runId,
      session: secondStart.start.session,
      checkpointHash: secondRun.checkpointHash,
    })
    const blocked = await playing.service.prepareRewardClaim(secondRun.runId, secondStart.start.session)
    expect(blocked.outcome).toBe('ALREADY_REWARDED')
    expect((await playing.service.getWalletDailyStatus(playing.wallet)).rewardAlreadyReserved).toBe(true)
  }, 90_000)

  it('serves the product HTTP gem flow against live postgres', async () => {
    const playing = await startPlaying('gem-runner', await createLiveService())
    const cookie = cookieHeader(playing.capability)
    await dispatchExpeditionHttp(playing.service, {
      method: 'POST',
      path: '/api/expeditions/gameplay-start',
      headers: headers(cookie),
      body: { runId: playing.run.runId },
    }, SECURITY)
    const directions = decodeSequence(PREVALIDATED_ROOM_01_BOOTSTRAP_WINNING_SEQUENCES['gem-runner'])
    let previous = playing.run.checkpointHash
    for (let index = 0; index < directions.length; index += 8) {
      const batch = directions.slice(index, index + 8)
      const response = await dispatchExpeditionHttp(playing.service, {
        method: 'POST',
        path: '/api/expeditions/checkpoint',
        headers: headers(cookie),
        body: {
          runId: playing.run.runId,
          previousCheckpointHash: previous,
          actions: moves(index + 1, ...batch),
        },
      }, SECURITY)
      expect(response.status).toBe(200)
      previous = (response.body as { checkpointHash: string }).checkpointHash
    }
    const verified = await dispatchExpeditionHttp(playing.service, {
      method: 'POST',
      path: '/api/expeditions/verify',
      headers: headers(cookie),
      body: { runId: playing.run.runId, checkpointHash: previous },
    }, SECURITY)
    expect(verified.status).toBe(200)
    expect(verified.body).toMatchObject({ ok: true, outcome: 'VERIFIED_ELIGIBLE' })
  }, 60_000)
})

describe.skipIf(!liveEnabled)('live 008 reward risk gate', () => {
  it('exposes risk tables, one assessment per run, service RPCs, FORCE RLS SQL, and hardened search_path', async () => {
    const client = createSupabaseAdminClient(liveConfig!)
    for (const table of ['reward_risk_signals', 'reward_risk_assessments'] as const) {
      const query = await client.from(table).select('*').limit(1)
      expect(query.error, table).toBeNull()
      expect(Array.isArray(query.data), table).toBe(true)
    }
    const spec = await liveSupabaseFetch('/rest/v1/', {
      token: liveConfig!.serviceRoleKey,
    })
    expect(spec.status).toBe(200)
    const openApi = await fetch(`${liveConfig!.url}/rest/v1/`, {
      headers: {
        apikey: liveConfig!.serviceRoleKey,
        Authorization: `Bearer ${liveConfig!.serviceRoleKey}`,
        Accept: 'application/openapi+json',
      },
    })
    expect(openApi.status).toBe(200)
    const schema = await openApi.json() as {
      definitions?: Record<string, { required?: string[]; properties?: Record<string, { enum?: string[] }> }>
    }
    const assessments = schema.definitions?.reward_risk_assessments
    expect(assessments?.required).toEqual(expect.arrayContaining(['run_id', 'wallet', 'day_key', 'result']))
    expect(assessments?.properties?.result?.enum).toEqual(['PASS', 'REVIEW', 'BLOCK'])

    const executed = await client.rpc('get_reward_risk_assessment', {
      p_run_id: '00000000-0000-0000-0000-000000000000',
      p_run_session_hash: 'a'.repeat(64),
    })
    expect(executed.error, executed.error?.message).toBeNull()
    expect(executed.data).toMatchObject({ ok: false, error: 'RUN_SESSION_INVALID' })
    const malformed = await client.rpc('record_reward_risk_signal', {
      p_kind: 'CLAIM',
      p_wallet: 'NQ-TEST',
      p_day_key: '1970-01-01',
      p_install_id_hash: 'not-a-hash',
      p_run_id: null,
      p_pattern_hash: null,
    })
    expect(malformed.error, malformed.error?.message).toBeNull()
    expect(malformed.data).toMatchObject({ ok: false, error: 'MALFORMED_REQUEST' })
    const context = await client.rpc('load_reward_risk_context', {
      p_run_id: '00000000-0000-0000-0000-000000000000',
      p_run_session_hash: 'a'.repeat(64),
      p_install_id_hash: null,
      p_pattern_hash: null,
    })
    expect(context.error, context.error?.message).toBeNull()
    expect(context.data).toMatchObject({ ok: false, error: 'RUN_SESSION_INVALID' })

    const sql = readFileSync(join(sqlDir, '008_reward_risk_gate.sql'), 'utf8')
    expect(sql).toMatch(/alter table public.reward_risk_signals force row level security/i)
    expect(sql).toMatch(/alter table public.reward_risk_assessments force row level security/i)
    expect(sql).toMatch(/set search_path = pg_catalog, public/)
    expect(sql).toMatch(/revoke all on function public.get_reward_risk_assessment/)
    expect(sql).not.toMatch(/grant execute[^;]+anon/i)
    expect(sql).not.toMatch(/grant execute[^;]+authenticated/i)
    expect(sql).toMatch(/run_id uuid not null unique/)
  }, 30_000)

  it('rejects anon and authenticated risk writes plus protected risk RPC execution', async () => {
    const unauthenticated = await liveSupabaseFetch('/rest/v1/reward_risk_assessments?select=assessment_id&limit=1', {
      apikey: 'invalid',
      token: 'invalid',
    })
    expect(unauthenticated.status).toBe(401)

    if (anonKey) {
      const { createClient } = await import('@supabase/supabase-js')
      const anon = createClient(liveConfig!.url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
      const anonWrite = await anon.from('reward_risk_assessments').insert({
        run_id: '00000000-0000-0000-0000-000000000000',
        wallet: 'NQ-ANON-RLS',
        day_key: '1970-01-01',
        result: 'PASS',
      })
      expect(anonWrite.error).toBeTruthy()
      const anonSignal = await anon.from('reward_risk_signals').insert({
        kind: 'CLAIM',
        wallet: 'NQ-ANON-RLS',
        day_key: '1970-01-01',
      })
      expect(anonSignal.error).toBeTruthy()
      for (const [name, payload] of RISK_RPCS) {
        const rpc = await anon.rpc(name, payload)
        expect(rpc.error, name).toBeTruthy()
      }
    }

    const email = `nimhunt.risk.rls.${randomUUID().slice(0, 8)}@gmail.com`
    const password = `RlsProbe-${randomUUID()}`
    const created = await liveSupabaseFetch('/auth/v1/admin/users', {
      method: 'POST',
      token: liveConfig!.serviceRoleKey,
      body: { email, password, email_confirm: true },
    })
    expect(created.status).toBe(200)
    const userId = asLiveId(created.body)
    try {
      const token = await liveSupabaseFetch('/auth/v1/token?grant_type=password', {
        method: 'POST',
        token: liveConfig!.serviceRoleKey,
        body: { email, password },
      })
      expect(token.status).toBe(200)
      const accessToken = asLiveAccessToken(token.body)
      for (const table of ['reward_risk_signals', 'reward_risk_assessments'] as const) {
        const read = await liveSupabaseFetch(`/rest/v1/${table}?select=*&limit=5`, { token: accessToken })
        expect(read.status, table).toBe(200)
        expect(read.body, table).toEqual([])
        const inserted = await liveSupabaseFetch(`/rest/v1/${table}`, {
          method: 'POST',
          token: accessToken,
          body: table === 'reward_risk_signals'
            ? { kind: 'CLAIM', wallet: 'NQ-AUTH-RLS', day_key: '1970-01-01' }
            : { run_id: '00000000-0000-0000-0000-000000000000', wallet: 'NQ-AUTH-RLS', day_key: '1970-01-01', result: 'PASS' },
        })
        expect(inserted.status, table).toBe(403)
        expect(JSON.stringify(inserted.body), table).toMatch(/row-level security policy/)
      }
      for (const [name, payload] of RISK_RPCS) {
        const rpc = await liveSupabaseFetch(`/rest/v1/rpc/${name}`, {
          method: 'POST',
          token: accessToken,
          body: payload,
        })
        expect(rpc.status, name).toBe(403)
        expect(JSON.stringify(rpc.body), name).toMatch(/permission denied for function/)
      }
    } finally {
      if (userId) {
        await liveSupabaseFetch(`/auth/v1/admin/users/${userId}`, {
          method: 'DELETE',
          token: liveConfig!.serviceRoleKey,
        })
      }
    }
  }, 30_000)

  it('passes a low-risk eligible run, reserves once, and never stores a raw install id or payout', async () => {
    const client = createSupabaseAdminClient(liveConfig!)
    const installId = randomUUID()
    const playing = await completeEligible('gem-runner', await createLiveService())
    const before = await liveDayState(client, playing.run.dayKey, playing.wallet)
    const beforeRun = await playing.service.getRun(playing.run.runId)
    const elapsed = Date.parse(playing.run.terminal && playing.run.terminal.type === 'VERIFIED'
      ? playing.run.terminal.result.verifiedAt
      : '') - Date.parse(playing.run.gameplayStartedAt ?? playing.run.startedAt)
    const bound = minimumPlausibleCompletionMs(playing.run.seq)
    expect(bound).toBeGreaterThan(0)
    expect(elapsed).toBeGreaterThan(bound!)
    expect(isImpossibleRunSpeed({
      actionCount: playing.run.seq,
      startedAt: playing.run.gameplayStartedAt ?? playing.run.startedAt,
      verifiedAt: playing.run.terminal && playing.run.terminal.type === 'VERIFIED'
        ? playing.run.terminal.result.verifiedAt
        : '',
    })).toBe(false)

    const prepared = await playing.service.prepareRewardClaim(playing.run.runId, playing.start.session, { installId })
    expect(prepared.outcome).toBe('PREPARED')
    if (prepared.outcome !== 'PREPARED') throw new Error('PREPARED_REQUIRED')
    const retried = await playing.service.prepareRewardClaim(playing.run.runId, playing.start.session, { installId })
    expect(retried).toEqual(prepared)

    const assessed = await client.rpc('get_reward_risk_assessment', {
      p_run_id: playing.run.runId,
      p_run_session_hash: playing.start.session.sessionHash,
    })
    expect(assessed.error, assessed.error?.message).toBeNull()
    expect(assessed.data).toMatchObject({
      ok: true,
      assessment: {
        run_id: playing.run.runId,
        wallet: playing.wallet,
        result: 'PASS',
        install_id_hash: hashInstallId(installId),
      },
    })
    const rows = await client.from('reward_risk_assessments').select('assessment_id,run_id,install_id_hash,result').eq('run_id', playing.run.runId)
    expect(rows.error).toBeNull()
    expect(rows.data).toHaveLength(1)
    expect(JSON.stringify(rows.data)).not.toContain(installId)
    const signals = await client.from('reward_risk_signals').select('install_id_hash,kind,wallet').eq('run_id', playing.run.runId)
    expect(signals.error).toBeNull()
    expect(signals.data?.some(row => row.install_id_hash === hashInstallId(installId))).toBe(true)
    expect(signals.data?.every(row => row.install_id_hash == null || row.install_id_hash === hashInstallId(installId))).toBe(true)
    expect(JSON.stringify(signals.data)).not.toContain(installId)
    expect(INSTALL_ID_HASH_PREFIX).toBe('nimhunt-install-v1:')
    expect(hashInstallId(installId)).toMatch(/^[0-9a-f]{64}$/)
    const createdId = createRandomInstallId()
    expect(createdId).not.toBe(installId)
    expect(createRandomInstallId.toString()).not.toMatch(/userAgent|screen|font|language|wallet|address|ip|hardware/i)
    const storage: Record<string, string> = { [playing.wallet]: 'keep-wallet' }
    const memory = {
      getItem(key: string) { return Object.prototype.hasOwnProperty.call(storage, key) ? storage[key]! : null },
      setItem(key: string, value: string) { storage[key] = value },
    }
    const firstInstall = getOrCreateInstallId(memory, () => installId)
    expect(firstInstall).toBe(installId)
    delete storage[INSTALL_ID_STORAGE_KEY]
    const rotated = getOrCreateInstallId(memory, () => randomUUID())
    expect(rotated).not.toBe(installId)
    expect(storage[playing.wallet]).toBe('keep-wallet')

    const reserved = await playing.service.finalizeRewardClaim({
      session: playing.start.session,
      claimId: prepared.claimId,
      payload: prepared.canonicalPayload,
      publicKey: playing.keyPair.publicKey.toHex(),
      signature: playing.keyPair.sign(nimiqSignedMessageHash(prepared.canonicalPayload)).toHex(),
      risk: { installId },
    })
    expect(reserved.outcome).toBe('RESERVED')
    const after = await liveDayState(client, playing.run.dayKey, playing.wallet)
    expect(after.reservedSlots).toBe(before.reservedSlots + 1)
    expect(after.rewardsReserved).toBe(before.rewardsReserved + 1)
    expect(after.payoutCount).toBe(before.payoutCount)
    const payouts = await client.from('reward_payouts').select('payout_id').eq('claim_id', prepared.claimId)
    expect(payouts.error).toBeNull()
    expect(payouts.data).toEqual([])
    const afterRun = await playing.service.getRun(playing.run.runId)
    expect(afterRun?.checkpointHash).toBe(beforeRun?.checkpointHash)
    expect(afterRun?.terminal).toEqual(beforeRun?.terminal)
    const duplicate = await client.from('reward_risk_assessments').insert({
      run_id: playing.run.runId,
      wallet: playing.wallet,
      day_key: playing.run.dayKey,
      result: 'BLOCK',
    })
    expect(duplicate.error).toBeTruthy()
    const stillOne = await client.from('reward_risk_assessments').select('assessment_id,result').eq('run_id', playing.run.runId)
    expect(stillOne.data).toHaveLength(1)
    expect(stillOne.data?.[0]?.result).toBe('PASS')
  }, 120_000)

  it('reviews a third wallet on one install without consuming a slot and keeps neutral UI copy', async () => {
    expect(REWARD_REVIEW_TITLE).toBe('REWARD CHECK IN PROGRESS')
    const client = createSupabaseAdminClient(liveConfig!)
    const installId = randomUUID()
    const playing = await completeEligible('gem-runner', await createLiveService())
    const before = await liveDayState(client, playing.run.dayKey, playing.wallet)
    const beforeRun = await playing.service.getRun(playing.run.runId)
    const limiter = createRateLimiter()
    const security = { ...SECURITY, rateLimiter: limiter }
    const cookie = cookieHeader(playing.capability)
    for (let index = 0; index < CLAIM_SESSION_LIMIT; index += 1) {
      expect(limiter.take(`claim-prepare-session:${playing.start.session.sessionHash}`, CLAIM_SESSION_LIMIT, RATE_LIMIT_WINDOW_MS)).toBe(true)
    }
    const limitedPrepare = await dispatchExpeditionHttp(playing.service, {
      method: 'POST',
      path: '/api/rewards/claim/prepare',
      headers: headers(cookie),
      body: { runId: playing.run.runId, installId },
    }, security)
    expect(limitedPrepare.status).toBe(429)
    expect(limitedPrepare.body).toEqual({ ok: false, error: 'RATE_LIMITED' })
    expect(await liveDayState(client, playing.run.dayKey, playing.wallet)).toEqual(before)
    expect((await playing.service.getRun(playing.run.runId))?.checkpointHash).toBe(beforeRun?.checkpointHash)

    for (const extraWallet of [`NQ-REVIEW-A-${randomUUID()}`, `NQ-REVIEW-B-${randomUUID()}`]) {
      const seeded = await client.rpc('record_reward_risk_signal', {
        p_kind: 'START_CHALLENGE',
        p_wallet: extraWallet,
        p_day_key: playing.run.dayKey,
        p_install_id_hash: hashInstallId(installId),
        p_run_id: null,
        p_pattern_hash: null,
      })
      expect(seeded.error, seeded.error?.message).toBeNull()
      expect(seeded.data).toMatchObject({ ok: true })
    }
    const reviewed = await playing.service.prepareRewardClaim(playing.run.runId, playing.start.session, { installId })
    expect(reviewed).toMatchObject({ outcome: 'REVIEW', runId: playing.run.runId })
    const assessed = await client.rpc('get_reward_risk_assessment', {
      p_run_id: playing.run.runId,
      p_run_session_hash: playing.start.session.sessionHash,
    })
    expect(assessed.data).toMatchObject({ ok: true, assessment: { result: 'REVIEW', run_id: playing.run.runId } })
    const after = await liveDayState(client, playing.run.dayKey, playing.wallet)
    expect(after.reservedSlots).toBe(before.reservedSlots)
    expect(after.rewardsReserved).toBe(before.rewardsReserved)
    expect(after.payoutCount).toBe(before.payoutCount)
    const claims = await client.from('reward_claims').select('claim_id,status').eq('run_id', playing.run.runId)
    expect(claims.data).toEqual([])
    const payouts = await client.from('reward_payouts').select('payout_id').eq('run_id', playing.run.runId)
    expect(payouts.data).toEqual([])
    const afterRun = await playing.service.getRun(playing.run.runId)
    expect(afterRun?.checkpointHash).toBe(beforeRun?.checkpointHash)
    expect(afterRun?.terminal).toEqual(beforeRun?.terminal)
    expect(afterRun?.status).toBe('COMPLETED')
    expect(afterRun?.rewardStatus).toBe('ELIGIBLE')
  }, 120_000)

  it('blocks concurrent and impossible-speed runs without consuming a slot', async () => {
    expect(REWARD_BLOCK_TITLE).toBe('REWARD NOT ELIGIBLE')
    expect(minimumPlausibleCompletionMs(1)).toBeNull()
    expect(isImpossibleRunSpeed({
      actionCount: 1,
      startedAt: '2026-09-17T12:00:00.000Z',
      verifiedAt: '2026-09-17T12:00:00.010Z',
    })).toBe(false)
    const client = createSupabaseAdminClient(liveConfig!)
    const service = await createLiveService()

    const fast = await startPlaying('gem-runner', service)
    const completed = await playSequence(
      fast.service,
      fast.start.session,
      fast.run.runId,
      PREVALIDATED_ROOM_01_BOOTSTRAP_WINNING_SEQUENCES['gem-runner'],
    )
    await fast.service.verifyExpedition({
      runId: completed.runId,
      session: fast.start.session,
      checkpointHash: completed.checkpointHash,
    })
    const verified = await fast.service.getRun(completed.runId)
    if (!verified || verified.terminal?.type !== 'VERIFIED') throw new Error('VERIFIED_REQUIRED')
    const verifiedAt = verified.terminal.result.verifiedAt
    const stamp = await client.from('expedition_runs').update({
      started_at: verifiedAt,
      gameplay_started_at: verifiedAt,
    }).eq('id', completed.runId)
    expect(stamp.error, stamp.error?.message).toBeNull()
    const timed = await fast.service.getRun(completed.runId)
    expect(timed).toBeTruthy()
    const bound = minimumPlausibleCompletionMs(timed!.seq)
    expect(bound).toBeGreaterThan(0)
    const fastElapsed = Date.parse(verifiedAt) - Date.parse(timed!.gameplayStartedAt ?? timed!.startedAt)
    expect(fastElapsed).toBeLessThan(bound!)
    const beforeFast = await liveDayState(client, timed!.dayKey, fast.wallet)
    const previousCap = process.env.NIMHUNT_MAX_DAILY_REWARD_LUNA
    process.env.NIMHUNT_MAX_DAILY_REWARD_LUNA = '1'
    try {
      await expect(fast.service.prepareRewardClaim(timed!.runId, fast.start.session)).rejects.toMatchObject({
        code: 'REWARD_UNAVAILABLE',
      })
    } finally {
      if (previousCap === undefined) delete process.env.NIMHUNT_MAX_DAILY_REWARD_LUNA
      else process.env.NIMHUNT_MAX_DAILY_REWARD_LUNA = previousCap
    }
    expect(await liveDayState(client, timed!.dayKey, fast.wallet)).toEqual(beforeFast)
    const blockedSpeed = await fast.service.prepareRewardClaim(timed!.runId, fast.start.session)
    expect(blockedSpeed).toMatchObject({ outcome: 'BLOCK', runId: timed!.runId, reasonCategory: 'TIMING' })
    expect(await liveDayState(client, timed!.dayKey, fast.wallet)).toEqual(beforeFast)
    expect((await client.from('reward_claims').select('claim_id').eq('run_id', timed!.runId)).data).toEqual([])
    expect((await client.from('reward_payouts').select('payout_id').eq('run_id', timed!.runId)).data).toEqual([])
    const afterFast = await fast.service.getRun(timed!.runId)
    expect(afterFast?.checkpointHash).toBe(timed!.checkpointHash)
    expect(afterFast?.terminal).toEqual(timed!.terminal)

    const first = await startPlaying('gem-runner', await createLiveService())
    const secondStart = await signedStart({
      service: first.service,
      keyPair: first.keyPair,
      wallet: first.wallet,
      mission: 'chest-hunter',
    })
    await first.service.markGameplayStarted(secondStart.start.start.runId, secondStart.start.session)
    const secondRun = await playSequence(
      first.service,
      secondStart.start.session,
      secondStart.start.start.runId,
      PREVALIDATED_ROOM_01_BOOTSTRAP_WINNING_SEQUENCES['chest-hunter'],
    )
    await first.service.verifyExpedition({
      runId: secondRun.runId,
      session: secondStart.start.session,
      checkpointHash: secondRun.checkpointHash,
    })
    await backdateHumanTiming(secondRun.runId, secondRun.seq)
    const beforeConcurrent = await liveDayState(client, first.run.dayKey, first.wallet)
    const blockedConcurrent = await first.service.prepareRewardClaim(secondRun.runId, secondStart.start.session)
    expect(blockedConcurrent).toMatchObject({ outcome: 'BLOCK', reasonCategory: 'SESSION' })
    expect(await liveDayState(client, first.run.dayKey, first.wallet)).toEqual(beforeConcurrent)
    expect((await client.from('reward_claims').select('claim_id').eq('run_id', secondRun.runId)).data).toEqual([])
    expect((await first.service.getRun(first.run.runId))?.status).toBe('STARTED')
    expect((await first.service.getRun(secondRun.runId))?.status).toBe('COMPLETED')
  }, 180_000)

  it('rate-limits start, recovery, prepare, and finalize without mutating attempts or payout state', async () => {
    const client = createSupabaseAdminClient(liveConfig!)
    const playing = await completeEligible('gem-runner', await createLiveService())
    const before = await liveDayState(client, playing.run.dayKey, playing.wallet)
    const beforeRun = await playing.service.getRun(playing.run.runId)
    const limiter = createRateLimiter()
    const security = { ...SECURITY, rateLimiter: limiter }
    const cookie = cookieHeader(playing.capability)
    for (let index = 0; index < START_CHALLENGE_WALLET_LIMIT; index += 1) {
      expect(limiter.take(`start-challenge-wallet:${playing.wallet}`, START_CHALLENGE_WALLET_LIMIT, RATE_LIMIT_WINDOW_MS)).toBe(true)
    }
    for (let index = 0; index < RECOVERY_CHALLENGE_WALLET_LIMIT; index += 1) {
      expect(limiter.take(`recovery-challenge-wallet:${playing.wallet}`, RECOVERY_CHALLENGE_WALLET_LIMIT, RATE_LIMIT_WINDOW_MS)).toBe(true)
    }
    for (let index = 0; index < CLAIM_SESSION_LIMIT; index += 1) {
      expect(limiter.take(`claim-prepare-session:${playing.start.session.sessionHash}`, CLAIM_SESSION_LIMIT, RATE_LIMIT_WINDOW_MS)).toBe(true)
      expect(limiter.take(`claim-finalize-session:${playing.start.session.sessionHash}`, CLAIM_SESSION_LIMIT, RATE_LIMIT_WINDOW_MS)).toBe(true)
    }
    const limited = await Promise.all([
      dispatchExpeditionHttp(playing.service, {
        method: 'POST',
        path: '/api/expeditions/start-challenge',
        headers: headers(cookie),
        body: { wallet: playing.wallet, mission: 'gem-runner' },
      }, security),
      dispatchExpeditionHttp(playing.service, {
        method: 'POST',
        path: '/api/wallet/recover-challenge',
        headers: headers(cookie),
        body: { wallet: playing.wallet },
      }, security),
      dispatchExpeditionHttp(playing.service, {
        method: 'POST',
        path: '/api/rewards/claim/prepare',
        headers: headers(cookie),
        body: { runId: playing.run.runId },
      }, security),
      dispatchExpeditionHttp(playing.service, {
        method: 'POST',
        path: '/api/rewards/claim/finalize',
        headers: headers(cookie),
        body: {
          claimId: randomUUID(),
          payload: 'x',
          publicKey: playing.keyPair.publicKey.toHex(),
          signature: '00',
        },
      }, security),
    ])
    for (const response of limited) {
      expect(response.status).toBe(429)
      expect(response.body).toEqual({ ok: false, error: 'RATE_LIMITED' })
    }
    expect(await liveDayState(client, playing.run.dayKey, playing.wallet)).toEqual(before)
    expect((await client.from('reward_claims').select('claim_id').eq('run_id', playing.run.runId)).data).toEqual([])
    expect((await client.from('reward_payouts').select('payout_id').eq('run_id', playing.run.runId)).data).toEqual([])
    const afterRun = await playing.service.getRun(playing.run.runId)
    expect(afterRun?.checkpointHash).toBe(beforeRun?.checkpointHash)
    expect(afterRun?.terminal).toEqual(beforeRun?.terminal)
    expect(afterRun?.seq).toBe(beforeRun?.seq)
  }, 120_000)

  it('leaves the historical reserved claim and confirmed payout untouched', async () => {
    const client = createSupabaseAdminClient(liveConfig!)
    const payout = await client.from('reward_payouts').select('payout_id,claim_id,status,amount_luna,network').eq('payout_id', HISTORICAL_PAYOUT_ID).maybeSingle()
    expect(payout.error, payout.error?.message).toBeNull()
    expect(payout.data).toMatchObject({
      payout_id: HISTORICAL_PAYOUT_ID,
      claim_id: HISTORICAL_CLAIM_ID,
      status: 'CONFIRMED',
      amount_luna: 10000,
    })
    const claim = await client.from('reward_claims').select('claim_id,run_id,status').eq('claim_id', HISTORICAL_CLAIM_ID).maybeSingle()
    expect(claim.error, claim.error?.message).toBeNull()
    expect(claim.data).toMatchObject({
      claim_id: HISTORICAL_CLAIM_ID,
      status: 'RESERVED',
    })
    const runId = String(claim.data?.run_id ?? '')
    const assessments = await client.from('reward_risk_assessments').select('assessment_id,result,updated_at').eq('run_id', runId)
    expect(assessments.error).toBeNull()
    expect(assessments.data).toEqual([])
    const stillPayout = await client.from('reward_payouts').select('payout_id,status,amount_luna').eq('payout_id', HISTORICAL_PAYOUT_ID).maybeSingle()
    expect(stillPayout.data).toMatchObject({ payout_id: HISTORICAL_PAYOUT_ID, status: 'CONFIRMED', amount_luna: 10000 })
    const stillClaim = await client.from('reward_claims').select('claim_id,status').eq('claim_id', HISTORICAL_CLAIM_ID).maybeSingle()
    expect(stillClaim.data).toMatchObject({ claim_id: HISTORICAL_CLAIM_ID, status: 'RESERVED' })
  }, 30_000)
})

describe.skipIf(process.env.NIMHUNT_LIVE_HTTP !== '1' || !liveConfig)('live postgres vite durability', () => {
  it('recovers a signed start after a postgres-backed dev-server restart', async () => {
    const first = await startViteDevServer()
    const started = await (async () => {
      try {
        const created = await httpSignedStart()
        const active = await httpActive(created.runId, created.cookie)
        expect(active.status).toBe(200)
        expect(active.body).toMatchObject({ ok: true, runId: created.runId, status: 'STARTED' })
        return created
      } finally {
        await stopViteDevServer(first)
      }
    })()

    const second = await startViteDevServer()
    try {
      const recovered = await httpActive(started.runId, started.cookie)
      expect(recovered.status).toBe(200)
      expect(recovered.body).toMatchObject({ ok: true, runId: started.runId, status: 'STARTED' })
      const service = await createLiveService({ skipBlueprints: true })
      expect(await service.getRun(started.runId)).toMatchObject({ status: 'STARTED', seq: 0 })
    } finally {
      await stopViteDevServer(second)
    }
  }, 180_000)
})

async function createService(options: { readonly skipBlueprints?: boolean } = {}): Promise<ProofService> {
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
  if (!options.skipBlueprints) {
    for (const mission of ['gem-runner', 'chest-hunter', 'vault-breaker'] as const) {
      if (!(await service.getPublishedBlueprint(dayKey, mission))) {
        await service.registerBlueprint(publishedBlueprint(dayKey, mission, `pg-${mission}`))
      }
    }
  }
  return service
}

async function signedStart(options: {
  readonly service?: ProofService
  readonly keyPair?: KeyPair
  readonly wallet?: string
  readonly mission?: 'gem-runner' | 'chest-hunter' | 'vault-breaker'
} = {}) {
  const service = options.service ?? await createService()
  const keyPair = options.keyPair ?? KeyPair.generate()
  const wallet = options.wallet ?? keyPair.toAddress().toUserFriendlyAddress()
  const mission = options.mission ?? 'gem-runner'
  const challenge = await service.issueStartChallenge(wallet, mission)
  const payload: StartExpeditionPayload = {
    version: 1,
    type: 'NIMHUNT_START_EXPEDITION',
    wallet,
    mission,
    dayKey: challenge.dayKey,
    challenge: challenge.challenge,
    blueprintId: challenge.blueprintId,
    blueprintHash: challenge.blueprintHash,
  }
  const canonicalPayload = serializeStartPayload(payload)
  const request = {
    payload: canonicalPayload,
    publicKey: keyPair.publicKey.toHex(),
    signature: keyPair.sign(nimiqSignedMessageHash(canonicalPayload)).toHex(),
  }
  const start = await service.authorizeStart(request)
  return { service, keyPair, wallet, mission, challenge, request, start, capability: start.sessionCapability }
}

async function createLiveService(options: { readonly skipBlueprints?: boolean } = {}): Promise<ProofService> {
  const client = createSupabaseAdminClient(liveConfig!)
  const dayKey = utcDayKey(new Date())
  const service = await createSupabaseProofService({ client, blueprints: [] })
  if (!options.skipBlueprints) {
    for (const mission of ['gem-runner', 'chest-hunter', 'vault-breaker'] as const) {
      if (!(await service.getPublishedBlueprint(dayKey, mission))) {
        await service.registerBlueprint(publishedBlueprint(dayKey, mission, `bootstrap-${dayKey}-${mission}`))
      }
    }
  }
  return service
}

async function liveSupabaseFetch(path: string, options: {
  readonly method?: string
  readonly apikey?: string
  readonly token: string
  readonly body?: unknown
}) {
  const response = await fetch(`${liveConfig!.url}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      apikey: options.apikey ?? liveConfig!.serviceRoleKey,
      Authorization: `Bearer ${options.token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })
  return { status: response.status, body: await response.json().catch(() => null) }
}

function asLiveId(body: unknown): string | undefined {
  return typeof body === 'object' && body !== null && 'id' in body && typeof body.id === 'string' ? body.id : undefined
}

function asLiveAccessToken(body: unknown): string {
  if (typeof body === 'object' && body !== null && 'access_token' in body && typeof body.access_token === 'string') {
    return body.access_token
  }
  throw new Error('LIVE_AUTH_TOKEN_MISSING')
}

async function prepareUnsigned(service?: ProofService) {
  const resolved = service ?? await createService()
  const keyPair = KeyPair.generate()
  const wallet = keyPair.toAddress().toUserFriendlyAddress()
  const challenge = await resolved.issueStartChallenge(wallet, 'gem-runner')
  const payload: StartExpeditionPayload = {
    version: 1,
    type: 'NIMHUNT_START_EXPEDITION',
    wallet,
    mission: 'gem-runner',
    dayKey: challenge.dayKey,
    challenge: challenge.challenge,
    blueprintId: challenge.blueprintId,
    blueprintHash: challenge.blueprintHash,
  }
  const canonicalPayload = serializeStartPayload(payload)
  return {
    service: resolved,
    wallet,
    request: {
      payload: canonicalPayload,
      publicKey: keyPair.publicKey.toHex(),
      signature: keyPair.sign(nimiqSignedMessageHash(canonicalPayload)).toHex(),
    },
  }
}

async function startPlaying(
  mission: 'gem-runner' | 'chest-hunter' | 'vault-breaker' = 'gem-runner',
  service?: ProofService,
) {
  const started = await signedStart({ mission, service })
  await started.service.markGameplayStarted(started.start.start.runId, started.start.session)
  const run = await started.service.getRun(started.start.start.runId)
  if (!run) throw new Error('RUN_MISSING')
  return { ...started, run }
}

async function completeEligible(
  mission: 'gem-runner' | 'chest-hunter' | 'vault-breaker' = 'gem-runner',
  service?: ProofService,
) {
  const playing = await startPlaying(mission, service)
  const completed = await playSequence(
    playing.service,
    playing.start.session,
    playing.run.runId,
    PREVALIDATED_ROOM_01_BOOTSTRAP_WINNING_SEQUENCES[mission],
  )
  const verified = await playing.service.verifyExpedition({
    runId: completed.runId,
    session: playing.start.session,
    checkpointHash: completed.checkpointHash,
  })
  if (mission === 'vault-breaker') {
    const preparedSeal = await playing.service.prepareVaultSeal(completed.runId, playing.start.session)
    await playing.service.verifyVaultSeal({
      session: playing.start.session,
      payload: preparedSeal.canonicalPayload,
      publicKey: playing.keyPair.publicKey.toHex(),
      signature: playing.keyPair.sign(nimiqSignedMessageHash(preparedSeal.canonicalPayload)).toHex(),
    })
  }
  const run = await playing.service.getRun(completed.runId)
  if (!run) throw new Error('RUN_MISSING')
  await backdateHumanTiming(run.runId, run.seq)
  const timed = await playing.service.getRun(completed.runId)
  if (!timed) throw new Error('RUN_MISSING')
  return { ...playing, run: timed, verified }
}

async function playSequence(
  service: ProofService,
  session: RunSessionRecord,
  runId: string,
  encoded: string,
) {
  const directions = decodeSequence(encoded)
  for (let index = 0; index < directions.length; index += 8) {
    const current = await service.getRun(runId)
    if (!current) throw new Error('RUN_MISSING')
    await service.appendCheckpoint({
      runId,
      session,
      previousCheckpointHash: current.checkpointHash,
      actions: moves(index + 1, ...directions.slice(index, index + 8)),
    })
  }
  const next = await service.getRun(runId)
  if (!next) throw new Error('RUN_MISSING')
  return next
}

function publishedBlueprint(dayKey: string, mission: 'gem-runner' | 'chest-hunter' | 'vault-breaker', blueprintId: string) {
  const source = createRoom01Blueprint(dayKey, mission, blueprintId)
  return { ...source, status: 'PUBLISHED' as const, blueprintHash: hashBlueprint(source) }
}

function moves(start: number, ...directions: Direction[]): MoveAction[] {
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

function headers(cookie: string): Record<string, string | undefined> {
  return {
    origin: SECURITY.expectedOrigin,
    host: SECURITY.expectedHost,
    protocol: SECURITY.expectedProtocol,
    'content-type': 'application/json',
    cookie,
  }
}

function cookieHeader(raw: string): string {
  return `nimhunt_run_session=${encodeURIComponent(raw)}; Path=/api`
}

const LIVE_APP_ORIGIN = 'http://localhost:5173'

async function httpSignedStart() {
  const keyPair = KeyPair.generate()
  const wallet = keyPair.toAddress().toUserFriendlyAddress()
  const challenge = await liveAppFetch('/api/expeditions/start-challenge', {
    method: 'POST',
    body: { wallet, mission: 'gem-runner' },
  })
  expect(challenge.status).toBe(200)
  expect(challenge.body).toMatchObject({ ok: true, wallet })
  const payload = serializeStartPayload({
    version: 1,
    type: 'NIMHUNT_START_EXPEDITION',
    wallet,
    mission: 'gem-runner',
    dayKey: asLiveString(challenge.body, 'dayKey'),
    challenge: asLiveString(challenge.body, 'challenge'),
    blueprintId: asLiveString(challenge.body, 'blueprintId'),
    blueprintHash: asLiveString(challenge.body, 'blueprintHash'),
  })
  const started = await liveAppFetch('/api/expeditions/start', {
    method: 'POST',
    body: {
      payload,
      publicKey: keyPair.publicKey.toHex(),
      signature: keyPair.sign(nimiqSignedMessageHash(payload)).toHex(),
    },
  })
  expect(started.status).toBe(200)
  expect(started.body).toMatchObject({ ok: true, outcome: 'START_CREATED' })
  const cookie = started.setCookie
  expect(cookie).toMatch(/nimhunt_run_session=/)
  return { runId: asLiveString(started.body, 'runId'), cookie: cookieHeader(readSetCookieValue(cookie)) }
}

async function httpActive(runId: string, cookie: string) {
  return liveAppFetch(`/api/expeditions/active?runId=${encodeURIComponent(runId)}`, { cookie })
}

async function liveAppFetch(path: string, options: {
  readonly method?: string
  readonly cookie?: string
  readonly body?: unknown
} = {}) {
  const response = await fetch(`${LIVE_APP_ORIGIN}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      origin: LIVE_APP_ORIGIN,
      'content-type': 'application/json',
      ...(options.cookie ? { cookie: options.cookie } : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })
  return {
    status: response.status,
    body: await response.json().catch(() => null),
    setCookie: response.headers.get('set-cookie') ?? '',
  }
}

function asLiveString(body: unknown, key: string): string {
  if (typeof body === 'object' && body !== null && key in body) {
    const value = (body as Record<string, unknown>)[key]
    if (typeof value === 'string' && value.length > 0) return value
  }
  throw new Error(`LIVE_HTTP_FIELD_MISSING:${key}`)
}

function readSetCookieValue(setCookie: string): string {
  const prefix = 'nimhunt_run_session='
  const part = setCookie.split(';')[0] ?? ''
  if (!part.startsWith(prefix)) throw new Error('LIVE_HTTP_COOKIE_MISSING')
  return decodeURIComponent(part.slice(prefix.length))
}

async function startViteDevServer(): Promise<ChildProcess> {
  const child = spawn('npm', ['run', 'dev'], {
    cwd: process.cwd(),
    env: { ...process.env, NIMHUNT_PROOF_BACKEND: 'postgres' },
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const deadline = Date.now() + 60_000
  let lastError = 'VITE_NOT_READY'
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`VITE_EXITED:${child.exitCode}`)
    try {
      const response = await fetch(LIVE_APP_ORIGIN, { method: 'GET' })
      if (response.ok || response.status === 404) return child
      lastError = `HTTP_${response.status}`
    } catch (error) {
      lastError = error instanceof Error ? error.message : 'VITE_NOT_READY'
    }
    await new Promise(resolve => setTimeout(resolve, 400))
  }
  await stopViteDevServer(child)
  throw new Error(lastError)
}

async function stopViteDevServer(child: ChildProcess): Promise<void> {
  if (child.pid && process.platform === 'win32') {
    await execFileAsync('taskkill', ['/pid', String(child.pid), '/T', '/F']).catch(() => undefined)
    return
  }
  child.kill('SIGTERM')
  await new Promise(resolve => setTimeout(resolve, 300))
  if (child.exitCode === null) child.kill('SIGKILL')
}

async function startPostgres(): Promise<PgHarness> {
  const container = `nimhunt-proof-${process.pid}-${Date.now()}`
  const port = 55000 + (process.pid % 1000)
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
      return { kind: 'docker', host: '127.0.0.1', port, container }
    } catch {
      await new Promise(resolve => setTimeout(resolve, 500))
    }
  }
  throw new Error('POSTGRES_UNAVAILABLE')
}

async function independentPgClient(): Promise<Client> {
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

async function finalizeViaClient(client: Client, input: {
  readonly claimId: string
  readonly runId: string
  readonly sessionHash: string
  readonly wallet: string
  readonly payload: string
  readonly payloadHash: string
  readonly publicKey: string
  readonly signature: string
}): Promise<{ readonly ok?: boolean; readonly outcome?: string; readonly existing?: boolean }> {
  const result = await client.query(
    'select public.finalize_reward_claim($1::uuid, $2::uuid, $3::text, $4::text, $5::text, $6::text, $7::text, $8::text) as result',
    [input.claimId, input.runId, input.sessionHash, input.wallet, input.payload, input.payloadHash, input.publicKey, input.signature],
  )
  return (result.rows[0]?.result ?? {}) as { readonly ok?: boolean; readonly outcome?: string; readonly existing?: boolean }
}

async function syncReservedSlots(dayKey: string): Promise<void> {
  await adminPool!.query(
    `update public.daily_reward_pools p
     set reserved_slots = (
       select count(*)::int from public.reward_claims c
       where c.day_key = p.day_key and c.status = 'RESERVED'
     )
     where p.day_key = $1`,
    [dayKey],
  )
}

async function liveDayState(
  client: ReturnType<typeof createSupabaseAdminClient>,
  dayKey: string,
  wallet: string,
) {
  const pool = await client.from('daily_reward_pools').select('reserved_slots').eq('day_key', dayKey).maybeSingle()
  const walletState = await client.from('daily_wallet_state').select('rewards_reserved,expeditions_started').eq('day_key', dayKey).eq('wallet', wallet).maybeSingle()
  const payouts = await client.from('reward_payouts').select('payout_id').eq('wallet', wallet).eq('day_key', dayKey)
  expect(pool.error, pool.error?.message).toBeNull()
  expect(walletState.error, walletState.error?.message).toBeNull()
  expect(payouts.error, payouts.error?.message).toBeNull()
  return {
    reservedSlots: Number(pool.data?.reserved_slots ?? 0),
    rewardsReserved: Number(walletState.data?.rewards_reserved ?? 0),
    expeditionsStarted: Number(walletState.data?.expeditions_started ?? 0),
    payoutCount: payouts.data?.length ?? 0,
  }
}

async function backdateHumanTiming(runId: string, actionCount: number): Promise<void> {
  const extraMs = (minimumPlausibleCompletionMs(actionCount) ?? 0) + 5_000
  if (adminPool) {
    await adminPool.query(
      `update public.expedition_runs
       set started_at = started_at - make_interval(secs => $2::numeric / 1000.0),
           gameplay_started_at = case
             when gameplay_started_at is null then null
             else gameplay_started_at - make_interval(secs => $2::numeric / 1000.0)
           end
       where id = $1`,
      [runId, extraMs],
    )
    return
  }
  if (!liveConfig) return
  const client = createSupabaseAdminClient(liveConfig)
  const loaded = await client.from('expedition_runs').select('started_at, gameplay_started_at').eq('id', runId).single()
  if (loaded.error || !loaded.data) return
  const shift = extraMs
  const startedAt = new Date(Date.parse(loaded.data.started_at as string) - shift).toISOString()
  const gameplay = loaded.data.gameplay_started_at
    ? new Date(Date.parse(loaded.data.gameplay_started_at as string) - shift).toISOString()
    : null
  await client.from('expedition_runs').update({ started_at: startedAt, gameplay_started_at: gameplay }).eq('id', runId)
}

async function applySql(pool: Pool, sql: string): Promise<void> {
  await pool.query(sql)
}

function roleSetupSql(): string {
  return `
    do $$ begin create role anon login password 'anon'; exception when duplicate_object then null; end $$;
    do $$ begin create role authenticated login password 'authenticated'; exception when duplicate_object then null; end $$;
    do $$ begin create role service_role login password 'service' bypassrls; exception when duplicate_object then null; end $$;
    grant usage on schema public to anon, authenticated, service_role;
  `
}
