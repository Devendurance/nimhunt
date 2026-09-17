import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import { loadEnv } from 'vite'
import { createSupabaseAdminClient, readServerSupabaseConfig } from '../ledger/config.ts'
import { readPayoutExecutionConfig } from './config.ts'
import { createSupabasePayoutRpcClient } from './db.ts'
import { createFakeTreasury } from './fakeTreasury.ts'
import { createPayoutStore } from './store.ts'
import {
  BETA_MAX_DAILY_REWARD_LUNA,
  BETA_REWARD_AMOUNT_LUNA,
} from './types.ts'
import { runPayoutWorker } from './worker.ts'

const env = loadEnv('test', process.cwd(), '')
const liveConfig = readServerSupabaseConfig({
  SUPABASE_URL: env.SUPABASE_URL || process.env.SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY,
  SUPABASE_SECRET_KEY: env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SECRET_KEY,
})
const liveEnabled = Boolean(liveConfig) && (
  env.NIMHUNT_PROOF_INTEGRATION === '1'
  || process.env.NIMHUNT_PROOF_INTEGRATION === '1'
  || env.NIMHUNT_PAYOUT_INTEGRATION === '1'
  || process.env.NIMHUNT_PAYOUT_INTEGRATION === '1'
)
const anonKey = env.SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY

const PAYOUT_COLUMNS = [
  'payout_id',
  'claim_id',
  'run_id',
  'wallet',
  'day_key',
  'execution_day_key',
  'amount_luna',
  'network',
  'status',
  'attempt_count',
  'tx_hash',
  'failure_code',
  'failure_message_safe',
  'created_at',
  'processing_started_at',
  'submitted_at',
  'confirmed_at',
  'updated_at',
] as const

const PROTECTED_RPCS = [
  ['create_reward_payout', {
    p_claim_id: '00000000-0000-0000-0000-000000000000',
    p_payout_id: '00000000-0000-0000-0000-000000000001',
    p_amount_luna: 10000,
    p_network: 'mainnet',
  }],
  ['acquire_reward_payout', {}],
  ['mark_reward_payout_submitted', {
    p_payout_id: '00000000-0000-0000-0000-000000000000',
    p_tx_hash: 'a'.repeat(64),
  }],
  ['mark_reward_payout_confirmed', {
    p_payout_id: '00000000-0000-0000-0000-000000000000',
    p_tx_hash: 'a'.repeat(64),
  }],
  ['mark_reward_payout_failed', {
    p_payout_id: '00000000-0000-0000-0000-000000000000',
    p_status: 'FAILED_RETRYABLE',
    p_failure_code: 'TEST',
    p_failure_message_safe: 'test',
  }],
  ['get_reward_payout', { p_payout_id: '00000000-0000-0000-0000-000000000000' }],
  ['get_reward_payout_by_claim', { p_claim_id: '00000000-0000-0000-0000-000000000000' }],
  ['get_reward_payout_for_session', {
    p_claim_id: '00000000-0000-0000-0000-000000000000',
    p_run_session_hash: 'a'.repeat(64),
  }],
  ['list_unpaid_reserved_claims', { p_limit: 1 }],
  ['list_reward_payouts', { p_status: 'PENDING', p_limit: 1 }],
  ['count_unpaid_reward_risk_skips', {}],
  ['get_payout_automation_control', {}],
  ['set_payout_automation_enabled', { p_enabled: false }],
  ['acquire_automated_reward_payout', {
    p_available_for_rewards_luna: 1_000_000_000,
    p_max_daily_reward_luna: 690_000_000,
    p_fee_luna: 0,
  }],
  ['get_execution_day_payout_spend', { p_execution_day: '2026-09-17' }],
] as const

describe.skipIf(!liveEnabled)('live 005 reward payouts', () => {
  it('exposes the payout table, unique claim binding, lifecycle, and service RPCs', async () => {
    const client = createSupabaseAdminClient(liveConfig!)
    const selected = await client.from('reward_payouts').select(PAYOUT_COLUMNS.join(',')).limit(1)
    expect(selected.error, selected.error?.message).toBeNull()
    expect(Array.isArray(selected.data)).toBe(true)

    const spec = await liveSupabaseFetch('/rest/v1/', {
      token: liveConfig!.serviceRoleKey,
      accept: 'application/openapi+json',
    })
    expect(spec.status).toBe(200)
    const schema = payoutSchema(spec.body)
    expect(schema.required).toEqual(expect.arrayContaining([
      'payout_id',
      'claim_id',
      'run_id',
      'wallet',
      'day_key',
      'amount_luna',
      'network',
      'status',
    ]))
    expect(schema.properties.payout_id?.format).toBe('uuid')
    expect(schema.properties.claim_id?.format).toBe('uuid')
    expect(schema.properties.amount_luna?.type).toBe('integer')
    expect(['bigint', 'int64']).toContain(schema.properties.amount_luna?.format)
    expect(schema.properties.claim_id?.format).toBe('uuid')

    const store = createPayoutStore(createSupabasePayoutRpcClient(client))
    await expect(store.create({
      claimId: '00000000-0000-0000-0000-000000000000',
      payoutId: '00000000-0000-0000-0000-000000000001',
      amountLuna: 10000n,
      network: 'mainnet',
    })).rejects.toMatchObject({ code: 'CLAIM_NOT_FOUND' })

    const invalidAmount = await client.rpc('create_reward_payout', {
      p_claim_id: '00000000-0000-0000-0000-000000000000',
      p_payout_id: '00000000-0000-0000-0000-000000000001',
      p_amount_luna: 0,
      p_network: 'mainnet',
    })
    expect(invalidAmount.error).toBeNull()
    expect(invalidAmount.data).toMatchObject({ ok: false, error: 'PAYOUT_AMOUNT_INVALID' })

    const invalidNetwork = await client.rpc('create_reward_payout', {
      p_claim_id: '00000000-0000-0000-0000-000000000000',
      p_payout_id: '00000000-0000-0000-0000-000000000001',
      p_amount_luna: 10000,
      p_network: 'other',
    })
    expect(invalidNetwork.error).toBeNull()
    expect(invalidNetwork.data).toMatchObject({ ok: false, error: 'PAYOUT_NETWORK_INVALID' })

    const missing = await client.rpc('get_reward_payout', {
      p_payout_id: '00000000-0000-0000-0000-000000000000',
    })
    expect(missing.error).toBeNull()
    expect(missing.data).toMatchObject({ ok: false, error: 'PAYOUT_NOT_FOUND' })

    const listed = await store.listByStatus('PENDING', 1)
    expect(Array.isArray(listed)).toBe(true)
    const unpaid = await store.listUnpaidReservedClaims(1)
    expect(Array.isArray(unpaid)).toBe(true)

    const zeroAmountInsert = await liveSupabaseFetch('/rest/v1/reward_payouts', {
      method: 'POST',
      token: liveConfig!.serviceRoleKey,
      body: {
        payout_id: randomUUID(),
        claim_id: randomUUID(),
        run_id: randomUUID(),
        wallet: 'NQ-TEST',
        day_key: '1970-01-01',
        amount_luna: 0,
        network: 'mainnet',
        status: 'PENDING',
      },
    })
    expect(zeroAmountInsert.status).toBeGreaterThanOrEqual(400)
    expect(JSON.stringify(zeroAmountInsert.body)).toMatch(/check constraint|23514/)

    const badNetworkInsert = await liveSupabaseFetch('/rest/v1/reward_payouts', {
      method: 'POST',
      token: liveConfig!.serviceRoleKey,
      body: {
        payout_id: randomUUID(),
        claim_id: randomUUID(),
        run_id: randomUUID(),
        wallet: 'NQ-TEST',
        day_key: '1970-01-01',
        amount_luna: 10000,
        network: 'other',
        status: 'PENDING',
      },
    })
    expect(badNetworkInsert.status).toBeGreaterThanOrEqual(400)
    expect(JSON.stringify(badNetworkInsert.body)).toMatch(/check constraint|23514|22P02|invalid input/)
  }, 30_000)

  it('rejects anon writes and protected payout RPC execution', async () => {
    expect(anonKey, 'SUPABASE_ANON_KEY is required to actively prove anon payout writes fail').toBeTruthy()
    const unauthenticated = await liveSupabaseFetch('/rest/v1/reward_payouts?select=payout_id&limit=1', {
      apikey: 'invalid',
      token: 'invalid',
    })
    expect(unauthenticated.status).toBe(401)
    const anon = createClient(liveConfig!.url, anonKey!, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const insert = await anon.from('reward_payouts').insert({
      payout_id: randomUUID(),
      claim_id: randomUUID(),
      run_id: randomUUID(),
      wallet: 'NQ-TEST',
      day_key: '1970-01-01',
      amount_luna: 10000,
      network: 'mainnet',
      status: 'PENDING',
    })
    expect(insert.error).toBeTruthy()
    const update = await anon.from('reward_payouts').update({ status: 'PROCESSING' }).neq('payout_id', randomUUID())
    expect(update.error || (update.data ?? []).length === 0).toBeTruthy()
    const rpc = await anon.rpc('acquire_reward_payout')
    expect(rpc.error).toBeTruthy()
    const createRpc = await anon.rpc('create_reward_payout', {
      p_claim_id: '00000000-0000-0000-0000-000000000000',
      p_payout_id: '00000000-0000-0000-0000-000000000001',
      p_amount_luna: 10000,
      p_network: 'mainnet',
    })
    expect(createRpc.error).toBeTruthy()
  }, 30_000)

  it('rejects authenticated writes and protected payout RPC execution', async () => {
    const unauthenticated = await liveSupabaseFetch('/rest/v1/reward_payouts?select=payout_id&limit=1', {
      apikey: 'invalid',
      token: 'invalid',
    })
    expect(unauthenticated.status).toBe(401)

    const email = `nimhunt.payout.rls.${randomUUID().slice(0, 8)}@gmail.com`
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

      const read = await liveSupabaseFetch('/rest/v1/reward_payouts?select=*&limit=5', { token: accessToken })
      expect(read.status).toBe(200)
      expect(read.body).toEqual([])

      const inserted = await liveSupabaseFetch('/rest/v1/reward_payouts', {
        method: 'POST',
        token: accessToken,
        body: {
          payout_id: randomUUID(),
          claim_id: randomUUID(),
          run_id: randomUUID(),
          wallet: 'NQ-AUTH-RLS',
          day_key: '1970-01-01',
          amount_luna: 10000,
          network: 'mainnet',
          status: 'PENDING',
        },
      })
      expect(inserted.status).toBe(403)
      expect(JSON.stringify(inserted.body)).toMatch(/row-level security policy/)

      const updated = await liveSupabaseFetch(`/rest/v1/reward_payouts?payout_id=eq.${randomUUID()}`, {
        method: 'PATCH',
        token: accessToken,
        body: { status: 'PROCESSING' },
      })
      expect(updated.status).toBe(200)
      expect(updated.body).toEqual([])

      const deleted = await liveSupabaseFetch(`/rest/v1/reward_payouts?payout_id=eq.${randomUUID()}`, {
        method: 'DELETE',
        token: accessToken,
      })
      expect(deleted.status).toBe(200)
      expect(deleted.body).toEqual([])

      for (const [name, payload] of PROTECTED_RPCS) {
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
  }, 45_000)
})

async function liveSupabaseFetch(path: string, options: {
  readonly method?: string
  readonly apikey?: string
  readonly token: string
  readonly body?: unknown
  readonly accept?: string
}) {
  const headers: Record<string, string> = {
    apikey: options.apikey ?? liveConfig!.serviceRoleKey,
    Authorization: `Bearer ${options.token}`,
    Accept: options.accept ?? 'application/json',
  }
  if (options.accept !== 'application/openapi+json') headers.Prefer = 'return=representation'
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'
  const response = await fetch(`${liveConfig!.url}${path}`, {
    method: options.method ?? 'GET',
    headers,
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

function payoutSchema(body: unknown): {
  required: string[]
  properties: Record<string, { type?: string; format?: string }>
} {
  const record = asRecord(body)
  const components = asRecord(record.components)
  const schemas = {
    ...asRecord(record.definitions),
    ...asRecord(components.schemas),
  }
  const table = asRecord(schemas.reward_payouts)
  const properties = asRecord(table.properties) as Record<string, { type?: string; format?: string }>
  const required = Array.isArray(table.required) ? table.required.filter(value => typeof value === 'string') : []
  if (required.length > 0 && Object.keys(properties).length > 0) return { required, properties }
  const encoded = JSON.stringify(body)
  const present = PAYOUT_COLUMNS.filter(column => encoded.includes(`"${column}"`))
  return {
    required: present.filter(column => [
      'payout_id',
      'claim_id',
      'run_id',
      'wallet',
      'day_key',
      'amount_luna',
      'network',
      'status',
    ].includes(column)),
    properties: {
      payout_id: { format: encoded.includes('uuid') ? 'uuid' : undefined },
      claim_id: { format: encoded.includes('uuid') ? 'uuid' : undefined },
      amount_luna: {
        type: 'integer',
        format: encoded.includes('bigint') ? 'bigint' : encoded.includes('int64') ? 'int64' : undefined,
      },
    },
  }
}

describe.skipIf(!liveEnabled)('live 006 reserved claim session recovery', () => {
  it('exposes the service-only recovery helper and rejects unauthenticated execute', async () => {
    const client = createSupabaseAdminClient(liveConfig!)
    const missing = await client.rpc('get_reserved_reward_claim_for_session', {
      p_run_session_hash: 'a'.repeat(64),
    })
    expect(missing.error, missing.error?.message).toBeNull()
    expect(missing.data).toMatchObject({ ok: false, error: 'RUN_SESSION_INVALID' })

    const unauthenticated = await liveSupabaseFetch('/rest/v1/rpc/get_reserved_reward_claim_for_session', {
      method: 'POST',
      apikey: 'invalid',
      token: 'invalid',
      body: { p_run_session_hash: 'a'.repeat(64) },
    })
    expect(unauthenticated.status).toBe(401)
  }, 30_000)

  it('rejects authenticated execute and does not leak another wallet claim', async () => {
    const email = `nimhunt.recovery.rls.${randomUUID().slice(0, 8)}@gmail.com`
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
      const rpc = await liveSupabaseFetch('/rest/v1/rpc/get_reserved_reward_claim_for_session', {
        method: 'POST',
        token: accessToken,
        body: { p_run_session_hash: 'a'.repeat(64) },
      })
      expect(rpc.status).toBe(403)
      expect(JSON.stringify(rpc.body)).toMatch(/permission denied for function/)
    } finally {
      if (userId) {
        await liveSupabaseFetch(`/auth/v1/admin/users/${userId}`, {
          method: 'DELETE',
          token: liveConfig!.serviceRoleKey,
        })
      }
    }

    const client = createSupabaseAdminClient(liveConfig!)
    const confirmed = await client.from('reward_payouts').select('payout_id,claim_id,run_id,wallet,status,amount_luna,network,tx_hash').eq('payout_id', 'd19bf406-2b81-4c5a-b271-da8eb7587cbd').maybeSingle()
    expect(confirmed.error, confirmed.error?.message).toBeNull()
    expect(confirmed.data).toMatchObject({
      payout_id: 'd19bf406-2b81-4c5a-b271-da8eb7587cbd',
      status: 'CONFIRMED',
      amount_luna: 10000,
      network: 'mainnet',
    })
    const claimId = String(confirmed.data?.claim_id ?? '')
    const runId = String(confirmed.data?.run_id ?? '')
    expect(claimId).toMatch(/^[0-9a-f-]{36}$/i)

    const own = await client.from('run_sessions').select('run_session_hash,run_id,wallet,expires_at,revoked_at').eq('run_id', runId).limit(1)
    expect(own.error, own.error?.message).toBeNull()
    const ownHash = typeof own.data?.[0]?.run_session_hash === 'string' ? own.data[0].run_session_hash : null
    const other = await client.from('run_sessions').select('run_session_hash,run_id').neq('run_id', runId).limit(1)
    expect(other.error, other.error?.message).toBeNull()
    const otherHash = typeof other.data?.[0]?.run_session_hash === 'string' ? other.data[0].run_session_hash : 'b'.repeat(64)

    const crossed = await client.rpc('get_reserved_reward_claim_for_session', {
      p_run_session_hash: otherHash,
    })
    expect(crossed.error, crossed.error?.message).toBeNull()
    expect(crossed.data).toMatchObject({ ok: false })
    expect(JSON.stringify(crossed.data)).not.toContain(claimId)
    expect(['RUN_SESSION_INVALID', 'CLAIM_NOT_FOUND']).toContain((crossed.data as { error?: string }).error)

    expect(ownHash, 'confirmed payout run session is required for recovery').toBeTruthy()
    const recovered = await client.rpc('get_reserved_reward_claim_for_session', {
      p_run_session_hash: ownHash,
    })
    expect(recovered.error, recovered.error?.message).toBeNull()
    expect(recovered.data).toMatchObject({
      ok: true,
      outcome: 'RESERVED',
      claim: { claim_id: claimId, status: 'RESERVED', run_id: runId },
    })
    expect(JSON.stringify(recovered.data)).not.toContain(otherHash)

    const payout = await client.rpc('get_reward_payout_by_claim', { p_claim_id: claimId })
    expect(payout.error, payout.error?.message).toBeNull()
    expect(payout.data).toMatchObject({
      ok: true,
      payout: {
        payout_id: 'd19bf406-2b81-4c5a-b271-da8eb7587cbd',
        claim_id: claimId,
        status: 'CONFIRMED',
        network: 'mainnet',
        tx_hash: 'c58022f37ed7352f41c29ef9862297a9cfa8c45593456395d7a6eb7a68009ff6',
      },
    })
    expect(String((payout.data as { payout?: { amount_luna?: unknown } }).payout?.amount_luna)).toBe('10000')
    expect(JSON.stringify(payout.data)).not.toMatch(/mnemonic|private_key|treasury/i)
  }, 45_000)
})

describe.skipIf(!liveEnabled)('live 009 automatic payout pipeline', () => {
  const historicalPayoutId = 'd19bf406-2b81-4c5a-b271-da8eb7587cbd'
  const historicalClaimId = '40891624-e2c2-471f-aa9a-9674ca6200a7'
  const historicalTxHash = 'c58022f37ed7352f41c29ef9862297a9cfa8c45593456395d7a6eb7a68009ff6'

  it('exposes the kill switch default-off, PASS-only discovery RPCs, and service-role path', async () => {
    const client = createSupabaseAdminClient(liveConfig!)
    const control = await client.from('payout_automation_control').select('id,automatic_payouts_enabled,updated_at').limit(1)
    expect(control.error, control.error?.message).toBeNull()
    expect(control.data).toEqual([
      expect.objectContaining({ id: true, automatic_payouts_enabled: false }),
    ])

    const store = createPayoutStore(createSupabasePayoutRpcClient(client))
    expect(await store.getAutomationEnabled()).toBe(false)

    const flags = await client.rpc('get_payout_automation_control')
    expect(flags.error, flags.error?.message).toBeNull()
    expect(flags.data).toMatchObject({ ok: true, automatic_payouts_enabled: false })

    const acquired = await client.rpc('acquire_automated_reward_payout', {
      p_available_for_rewards_luna: 1_000_000_000,
      p_max_daily_reward_luna: Number(BETA_MAX_DAILY_REWARD_LUNA),
      p_fee_luna: 0,
    })
    expect(acquired.error, acquired.error?.message).toBeNull()
    expect(acquired.data).toMatchObject({ ok: true, payout: null, reason: 'AUTOMATION_DISABLED' })

    const unpaid = await store.listUnpaidReservedClaims(69)
    const skips = await store.countUnpaidRiskSkips()
    expect(Array.isArray(unpaid)).toBe(true)
    expect(skips.reviewSkipped).toBeGreaterThanOrEqual(0)
    expect(skips.blockSkipped).toBeGreaterThanOrEqual(0)

    const processing = await client.from('reward_payouts').select('payout_id,status').eq('status', 'PROCESSING')
    expect(processing.error, processing.error?.message).toBeNull()
    expect(processing.data).toEqual([])
  }, 30_000)

  it('rejects authenticated writes and protected automation RPC execution', async () => {
    const unauthenticated = await liveSupabaseFetch('/rest/v1/rpc/acquire_automated_reward_payout', {
      method: 'POST',
      apikey: 'invalid',
      token: 'invalid',
      body: {
        p_available_for_rewards_luna: 1_000_000_000,
        p_max_daily_reward_luna: 690_000_000,
        p_fee_luna: 0,
      },
    })
    expect(unauthenticated.status).toBe(401)
    const unauthenticatedTable = await liveSupabaseFetch('/rest/v1/payout_automation_control?select=id&limit=1', {
      apikey: 'invalid',
      token: 'invalid',
    })
    expect(unauthenticatedTable.status).toBe(401)

    const email = `nimhunt.auto.rls.${randomUUID().slice(0, 8)}@gmail.com`
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

      const read = await liveSupabaseFetch('/rest/v1/payout_automation_control?select=*&limit=5', { token: accessToken })
      expect(read.status).toBe(200)
      expect(read.body).toEqual([])

      const inserted = await liveSupabaseFetch('/rest/v1/payout_automation_control', {
        method: 'POST',
        token: accessToken,
        body: { id: true, automatic_payouts_enabled: true },
      })
      expect(inserted.status).toBeGreaterThanOrEqual(400)

      const updated = await liveSupabaseFetch('/rest/v1/payout_automation_control?id=eq.true', {
        method: 'PATCH',
        token: accessToken,
        body: { automatic_payouts_enabled: true },
      })
      expect([200, 403]).toContain(updated.status)
      if (updated.status === 200) expect(updated.body).toEqual([])

      for (const [name, payload] of [
        ['get_payout_automation_control', {}],
        ['set_payout_automation_enabled', { p_enabled: false }],
        ['list_unpaid_reserved_claims', { p_limit: 1 }],
        ['count_unpaid_reward_risk_skips', {}],
        ['acquire_automated_reward_payout', {
          p_available_for_rewards_luna: 1_000_000_000,
          p_max_daily_reward_luna: 690_000_000,
          p_fee_luna: 0,
        }],
      ] as const) {
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

    const stillOff = await createSupabaseAdminClient(liveConfig!).rpc('get_payout_automation_control')
    expect(stillOff.data).toMatchObject({ ok: true, automatic_payouts_enabled: false })
  }, 45_000)

  it('discovers only unpaid RESERVED+PASS claims and skips REVIEW/BLOCK/non-RESERVED/paid rows', async () => {
    const client = createSupabaseAdminClient(liveConfig!)
    const store = createPayoutStore(createSupabasePayoutRpcClient(client))
    const unpaid = await store.listUnpaidReservedClaims(69)
    const unpaidIds = new Set(unpaid.map(row => row.claimId))
    expect(unpaidIds.has(historicalClaimId)).toBe(false)

    for (const row of unpaid) {
      const claim = await client.from('reward_claims').select('claim_id,status,run_id').eq('claim_id', row.claimId).maybeSingle()
      expect(claim.error, claim.error?.message).toBeNull()
      expect(claim.data).toMatchObject({ claim_id: row.claimId, status: 'RESERVED' })
      const assessment = await client.from('reward_risk_assessments').select('result').eq('run_id', row.runId).maybeSingle()
      expect(assessment.data).toMatchObject({ result: 'PASS' })
      const payout = await store.getByClaim(row.claimId)
      expect(payout).toBeNull()
    }

    const prepared = await client.from('reward_claims').select('claim_id,status').eq('status', 'PREPARED')
    expect(prepared.error, prepared.error?.message).toBeNull()
    for (const row of prepared.data ?? []) {
      expect(unpaidIds.has(String(row.claim_id))).toBe(false)
    }

    const skipped = await client.from('reward_risk_assessments').select('run_id,result').in('result', ['REVIEW', 'BLOCK'])
    expect(skipped.error, skipped.error?.message).toBeNull()
    expect((skipped.data ?? []).length).toBeGreaterThan(0)
    for (const row of skipped.data ?? []) {
      expect(unpaid.some(claim => claim.runId === row.run_id)).toBe(false)
    }

    const skips = await store.countUnpaidRiskSkips()
    expect(skips.reviewSkipped).toBe(0)
    expect(skips.blockSkipped).toBe(0)
  }, 30_000)

  it('keeps the env and DB kill switches off, does not acquire, and leaves historical payout unchanged', async () => {
    expect(BETA_REWARD_AMOUNT_LUNA * 69n).toBe(BETA_MAX_DAILY_REWARD_LUNA)
    const config = readPayoutExecutionConfig({
      ...env,
      NIMHUNT_PAYOUT_NETWORK: env.NIMHUNT_PAYOUT_NETWORK || process.env.NIMHUNT_PAYOUT_NETWORK,
      NIMHUNT_ENABLE_MAINNET_PAYOUT: env.NIMHUNT_ENABLE_MAINNET_PAYOUT || process.env.NIMHUNT_ENABLE_MAINNET_PAYOUT,
      NIMHUNT_AUTOMATIC_PAYOUTS_ENABLED: env.NIMHUNT_AUTOMATIC_PAYOUTS_ENABLED || process.env.NIMHUNT_AUTOMATIC_PAYOUTS_ENABLED,
      NIMHUNT_REWARD_AMOUNT_LUNA: env.NIMHUNT_REWARD_AMOUNT_LUNA || process.env.NIMHUNT_REWARD_AMOUNT_LUNA,
      NIMHUNT_MAX_DAILY_REWARD_LUNA: env.NIMHUNT_MAX_DAILY_REWARD_LUNA || process.env.NIMHUNT_MAX_DAILY_REWARD_LUNA,
      NIMHUNT_TREASURY_MIN_RESERVE_LUNA: env.NIMHUNT_TREASURY_MIN_RESERVE_LUNA || process.env.NIMHUNT_TREASURY_MIN_RESERVE_LUNA,
    })
    expect(config.automaticPayoutsEnabled).toBe(false)
    expect(config.amountLuna).toBe(BETA_REWARD_AMOUNT_LUNA)
    expect(config.maxDailyRewardLuna).toBe(BETA_MAX_DAILY_REWARD_LUNA)
    expect(config.treasuryMinReserveLuna).toBe(10_000_000n)

    const client = createSupabaseAdminClient(liveConfig!)
    const store = createPayoutStore(createSupabasePayoutRpcClient(client))
    const before = await client.from('reward_payouts').select('payout_id,status,amount_luna,tx_hash,claim_id').eq('payout_id', historicalPayoutId).maybeSingle()
    expect(before.data).toMatchObject({
      payout_id: historicalPayoutId,
      status: 'CONFIRMED',
      amount_luna: 10000,
      tx_hash: historicalTxHash,
      claim_id: historicalClaimId,
    })
    const beforeClaim = await client.from('reward_claims').select('claim_id,status').eq('claim_id', historicalClaimId).maybeSingle()
    expect(beforeClaim.data).toMatchObject({ claim_id: historicalClaimId, status: 'RESERVED' })

    const [left, right] = await Promise.all([
      store.acquireAutomated({
        availableForRewardsLuna: 1_000_000_000n,
        maxDailyRewardLuna: BETA_MAX_DAILY_REWARD_LUNA,
        feeLuna: 0n,
      }),
      store.acquireAutomated({
        availableForRewardsLuna: 1_000_000_000n,
        maxDailyRewardLuna: BETA_MAX_DAILY_REWARD_LUNA,
        feeLuna: 0n,
      }),
    ])
    expect(left).toEqual({ payout: null, reason: 'AUTOMATION_DISABLED' })
    expect(right).toEqual({ payout: null, reason: 'AUTOMATION_DISABLED' })

    const treasury = createFakeTreasury({ network: 'mainnet', balance: 0n })
    const dry = await runPayoutWorker({
      store,
      treasury,
      config,
      max: 5,
      dryRun: true,
      mockAvailableLuna: 0n,
    })
    expect(dry.dryRun).toBe(true)
    expect(dry.payoutsCreated).toBe(0)
    expect(dry.eligibleClaims).toBeGreaterThanOrEqual(1)
    expect(dry.wouldCreate).toBe(dry.eligibleClaims)
    expect(dry.wouldProcess).toBe(0)
    expect(dry.treasuryLow).toBe(true)
    expect(dry.dailyCapReached).toBe(false)
    expect(treasury.submitted).toHaveLength(0)

    const after = await client.from('reward_payouts').select('payout_id,status,amount_luna,tx_hash,claim_id').eq('payout_id', historicalPayoutId).maybeSingle()
    expect(after.data).toEqual(before.data)
    const afterClaim = await client.from('reward_claims').select('claim_id,status').eq('claim_id', historicalClaimId).maybeSingle()
    expect(afterClaim.data).toEqual(beforeClaim.data)
    const processing = await client.from('reward_payouts').select('payout_id').eq('status', 'PROCESSING')
    expect(processing.data).toEqual([])
    const pending = await client.from('reward_payouts').select('payout_id').eq('status', 'PENDING')
    expect(pending.data).toEqual([])
  }, 45_000)
})

describe.skipIf(!liveEnabled)('live 010 payout execution day', () => {
  const historicalPayoutId = 'd19bf406-2b81-4c5a-b271-da8eb7587cbd'
  const historicalClaimId = '40891624-e2c2-471f-aa9a-9674ca6200a7'
  const historicalTxHash = 'c58022f37ed7352f41c29ef9862297a9cfa8c45593456395d7a6eb7a68009ff6'
  const betaPayoutId = '14d204b5-5ced-477b-b626-05cfdbe29e1c'
  const betaClaimId = 'cd176c93-c9de-4c07-ad96-bcd1f16c14a4'
  const betaTxHash = 'f93d6a1e169182f0b3400daa70e3f9557d11dda1bdfb975541c5747f0d05f4fd'

  it('exposes execution_day_key, backfills historical rows, and reports 100 NIM on execution day', async () => {
    const client = createSupabaseAdminClient(liveConfig!)
    const store = createPayoutStore(createSupabasePayoutRpcClient(client))
    const selected = await client.from('reward_payouts').select(PAYOUT_COLUMNS.join(',')).limit(2)
    expect(selected.error, selected.error?.message).toBeNull()
    expect(JSON.stringify(selected.data)).toMatch(/execution_day_key/)

    const historical = await client.from('reward_payouts').select(PAYOUT_COLUMNS.join(',')).eq('payout_id', historicalPayoutId).maybeSingle()
    expect(historical.error, historical.error?.message).toBeNull()
    expect(historical.data).toMatchObject({
      payout_id: historicalPayoutId,
      claim_id: historicalClaimId,
      day_key: '2026-09-16',
      execution_day_key: '2026-09-16',
      status: 'CONFIRMED',
      amount_luna: 10000,
      tx_hash: historicalTxHash,
    })

    const beta = await client.from('reward_payouts').select(PAYOUT_COLUMNS.join(',')).eq('payout_id', betaPayoutId).maybeSingle()
    expect(beta.error, beta.error?.message).toBeNull()
    expect(beta.data).toMatchObject({
      payout_id: betaPayoutId,
      claim_id: betaClaimId,
      day_key: '2026-09-16',
      execution_day_key: '2026-09-17',
      status: 'CONFIRMED',
      amount_luna: 10_000_000,
      tx_hash: betaTxHash,
    })

    const historicalRpc = await store.get(historicalPayoutId)
    expect(historicalRpc).toMatchObject({
      payoutId: historicalPayoutId,
      dayKey: '2026-09-16',
      executionDayKey: '2026-09-16',
      status: 'CONFIRMED',
      amountLuna: 10_000n,
      txHash: historicalTxHash,
    })
    const betaRpc = await store.get(betaPayoutId)
    expect(betaRpc).toMatchObject({
      payoutId: betaPayoutId,
      dayKey: '2026-09-16',
      executionDayKey: '2026-09-17',
      status: 'CONFIRMED',
      amountLuna: BETA_REWARD_AMOUNT_LUNA,
      txHash: betaTxHash,
    })

    expect(await store.getExecutionDaySpend('2026-09-16')).toBe(10_000n)
    expect(await store.getExecutionDaySpend('2026-09-17')).toBe(BETA_REWARD_AMOUNT_LUNA)

    const historicalClaim = await client.from('reward_claims').select('claim_id,status,day_key').eq('claim_id', historicalClaimId).maybeSingle()
    expect(historicalClaim.data).toMatchObject({ claim_id: historicalClaimId, status: 'RESERVED', day_key: '2026-09-16' })
    const betaClaim = await client.from('reward_claims').select('claim_id,status,day_key').eq('claim_id', betaClaimId).maybeSingle()
    expect(betaClaim.data).toMatchObject({ claim_id: betaClaimId, status: 'RESERVED', day_key: '2026-09-16' })
  }, 30_000)

  it('counts current UTC-day execution commitment from execution_day_key and keeps automation off', async () => {
    const client = createSupabaseAdminClient(liveConfig!)
    const store = createPayoutStore(createSupabasePayoutRpcClient(client))
    const config = readPayoutExecutionConfig({
      ...env,
      NIMHUNT_PAYOUT_NETWORK: env.NIMHUNT_PAYOUT_NETWORK || process.env.NIMHUNT_PAYOUT_NETWORK,
      NIMHUNT_ENABLE_MAINNET_PAYOUT: env.NIMHUNT_ENABLE_MAINNET_PAYOUT || process.env.NIMHUNT_ENABLE_MAINNET_PAYOUT,
      NIMHUNT_AUTOMATIC_PAYOUTS_ENABLED: env.NIMHUNT_AUTOMATIC_PAYOUTS_ENABLED || process.env.NIMHUNT_AUTOMATIC_PAYOUTS_ENABLED,
      NIMHUNT_REWARD_AMOUNT_LUNA: env.NIMHUNT_REWARD_AMOUNT_LUNA || process.env.NIMHUNT_REWARD_AMOUNT_LUNA,
      NIMHUNT_MAX_DAILY_REWARD_LUNA: env.NIMHUNT_MAX_DAILY_REWARD_LUNA || process.env.NIMHUNT_MAX_DAILY_REWARD_LUNA,
      NIMHUNT_TREASURY_MIN_RESERVE_LUNA: env.NIMHUNT_TREASURY_MIN_RESERVE_LUNA || process.env.NIMHUNT_TREASURY_MIN_RESERVE_LUNA,
    })
    expect(config.automaticPayoutsEnabled).toBe(false)
    expect(await store.getAutomationEnabled()).toBe(false)

    const processing = await client.from('reward_payouts').select('payout_id,amount_luna').eq('status', 'PROCESSING')
    expect(processing.error, processing.error?.message).toBeNull()
    expect(processing.data).toEqual([])
    const submitted = await client.from('reward_payouts').select('payout_id,amount_luna').eq('status', 'SUBMITTED')
    expect(submitted.data).toEqual([])
    const failedFinal = await client.from('reward_payouts').select('payout_id,amount_luna,tx_hash').eq('status', 'FAILED_FINAL')
    expect(failedFinal.data).toEqual([])

    const today = new Date().toISOString().slice(0, 10)
    expect(today).toBe('2026-09-17')
    const committed = await store.getExecutionDaySpend(today)
    expect(committed).toBe(BETA_REWARD_AMOUNT_LUNA)
    expect(BETA_MAX_DAILY_REWARD_LUNA - committed).toBe(680_000_000n)

    const [left, right] = await Promise.all([
      store.acquireAutomated({
        availableForRewardsLuna: 1_000_000_000n,
        maxDailyRewardLuna: BETA_MAX_DAILY_REWARD_LUNA,
        feeLuna: 0n,
      }),
      store.acquireAutomated({
        availableForRewardsLuna: 1_000_000_000n,
        maxDailyRewardLuna: BETA_MAX_DAILY_REWARD_LUNA,
        feeLuna: 0n,
      }),
    ])
    expect(left).toEqual({ payout: null, reason: 'AUTOMATION_DISABLED' })
    expect(right).toEqual({ payout: null, reason: 'AUTOMATION_DISABLED' })

    const treasury = createFakeTreasury({ network: 'mainnet', balance: 0n })
    const dry = await runPayoutWorker({
      store,
      treasury,
      config,
      max: 5,
      dryRun: true,
      mockAvailableLuna: 20_000_000n,
    })
    expect(dry.dryRun).toBe(true)
    expect(dry.executionDay).toBe(today)
    expect(dry.executionDayCommittedLuna).toBe(BETA_REWARD_AMOUNT_LUNA.toString())
    expect(dry.executionDayRemainingLuna).toBe('680000000')
    expect(dry.payoutsCreated).toBe(0)
    expect(dry.wouldProcess).toBe(0)
    expect(treasury.submitted).toHaveLength(0)
    expect((await client.from('reward_payouts').select('payout_id').eq('status', 'PROCESSING')).data).toEqual([])
  }, 45_000)

  it('rejects authenticated execute of get_execution_day_payout_spend', async () => {
    const unauthenticated = await liveSupabaseFetch('/rest/v1/rpc/get_execution_day_payout_spend', {
      method: 'POST',
      apikey: 'invalid',
      token: 'invalid',
      body: { p_execution_day: '2026-09-17' },
    })
    expect(unauthenticated.status).toBe(401)

    const email = `nimhunt.execday.rls.${randomUUID().slice(0, 8)}@gmail.com`
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
      const rpc = await liveSupabaseFetch('/rest/v1/rpc/get_execution_day_payout_spend', {
        method: 'POST',
        token: accessToken,
        body: { p_execution_day: '2026-09-17' },
      })
      expect(rpc.status).toBe(403)
      expect(JSON.stringify(rpc.body)).toMatch(/permission denied for function/)
    } finally {
      if (userId) {
        await liveSupabaseFetch(`/auth/v1/admin/users/${userId}`, {
          method: 'DELETE',
          token: liveConfig!.serviceRoleKey,
        })
      }
    }

    const stillOff = await createSupabaseAdminClient(liveConfig!).rpc('get_payout_automation_control')
    expect(stillOff.data).toMatchObject({ ok: true, automatic_payouts_enabled: false })
  }, 45_000)
})

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}
