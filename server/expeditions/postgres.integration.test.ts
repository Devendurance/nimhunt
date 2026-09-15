import { randomUUID } from 'node:crypto'
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { KeyPair } from '@nimiq/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { loadEnv } from 'vite'
import { Pool } from 'pg'
import { hashBlueprint } from '../../src/game/replay/canonical.ts'
import { createRoom01Blueprint } from '../../src/game/world/room01.ts'
import { createSupabaseAdminClient, readServerSupabaseConfig } from '../ledger/config.ts'
import { serializeStartPayload, type StartExpeditionPayload } from './canonical.ts'
import { nimiqSignedMessageHash } from './crypto.ts'
import { ProofError } from './errors.ts'
import { dispatchExpeditionHttp, type ExpeditionHttpSecurity } from './http.ts'
import { createPgProofRpcClient } from './proofDb.ts'
import { createPostgresProofService, createSupabaseProofService } from './postgresProofStore.ts'
import { PREVALIDATED_ROOM_01_BOOTSTRAP_WINNING_SEQUENCES } from './room01BootstrapPrevalidation.ts'
import type { RunSessionRecord } from './session.ts'
import type { ProofService } from './types.ts'
import type { Direction, MoveAction } from '../../src/game/replay/types.ts'
import { utcDayKey } from '../ledger/utcDay.ts'

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
})

describe.skipIf(!liveEnabled)('configured supabase proof adapter', () => {
  it('exposes the live 001/002/003 schema to the service role', async () => {
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
      const rpc = await anon.rpc('append_checkpoint_batch', {})
      expect(rpc.error).toBeTruthy()
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
