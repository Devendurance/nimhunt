import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import { loadEnv } from 'vite'
import { createSupabaseAdminClient, readServerSupabaseConfig } from '../ledger/config.ts'
import { createSupabasePayoutRpcClient } from './db.ts'
import { createPayoutStore } from './store.ts'

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

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}
