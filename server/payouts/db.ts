import type { SupabaseClient } from '@supabase/supabase-js'
import { PayoutError, type PayoutErrorCode } from './errors.js'

const PAYOUT_RPCS = new Set([
  'create_reward_payout',
  'acquire_reward_payout',
  'acquire_automated_reward_payout',
  'mark_reward_payout_submitted',
  'mark_reward_payout_confirmed',
  'mark_reward_payout_failed',
  'get_reward_payout',
  'get_reward_payout_by_claim',
  'get_reward_payout_for_session',
  'list_unpaid_reserved_claims',
  'list_reward_payouts',
  'count_unpaid_reward_risk_skips',
  'get_payout_automation_control',
  'set_payout_automation_enabled',
  'get_execution_day_payout_spend',
  'get_payout_operations_status',
  'record_payout_cycle_result',
])

const PAYOUT_ERROR_CODES = new Set<PayoutErrorCode>([
  'MALFORMED_REQUEST',
  'CLAIM_NOT_FOUND',
  'CLAIM_NOT_ELIGIBLE',
  'RUN_SESSION_INVALID',
  'PAYOUT_NOT_FOUND',
  'PAYOUT_AMOUNT_INVALID',
  'PAYOUT_AMOUNT_UNCONFIGURED',
  'PAYOUT_NETWORK_INVALID',
  'PAYOUT_MAINNET_DISABLED',
  'PAYOUT_AUTOMATION_DISABLED',
  'PAYOUT_DAILY_CAP_INVALID',
  'PAYOUT_STATUS_INVALID',
  'PAYOUT_TX_INVALID',
  'PAYOUT_TX_MISMATCH',
  'PAYOUT_RESEND_UNSAFE',
  'PAYOUT_TREASURY_UNAVAILABLE',
  'PAYOUT_TREASURY_LOW',
  'PAYOUT_CYCLE_LIMIT_INVALID',
  'PAYOUT_SCHEDULER_SECRET_INVALID',
  'PAYOUT_SCHEDULER_SECRET_UNAVAILABLE',
  'PAYOUT_UNAVAILABLE',
  'WALLET_MISMATCH',
])

export type PayoutRpcClient = {
  rpc(fn: string, args?: Record<string, unknown>): Promise<unknown>
}

export function createSupabasePayoutRpcClient(client: SupabaseClient): PayoutRpcClient {
  return {
    async rpc(fn, args = {}) {
      if (!PAYOUT_RPCS.has(fn)) throw new PayoutError('PAYOUT_UNAVAILABLE')
      const { data, error } = await client.rpc(fn, args)
      if (error) throw mapClientError(error)
      return data
    },
  }
}

export function createPgPayoutRpcClient(
  query: (sql: string, params: unknown[]) => Promise<unknown>,
): PayoutRpcClient {
  return {
    async rpc(fn, args = {}) {
      if (!PAYOUT_RPCS.has(fn)) throw new PayoutError('PAYOUT_UNAVAILABLE')
      const keys = Object.keys(args)
      if (keys.some(key => !/^p_[a-z0-9_]+$/.test(key))) throw new PayoutError('PAYOUT_UNAVAILABLE')
      const params = keys.map(key => encodePgValue(args[key]))
      const sql = keys.length === 0
        ? `select public.${fn}() as result`
        : `select public.${fn}(${keys.map((key, index) => `${key} := $${index + 1}${pgCast(key, args[key])}`).join(', ')}) as result`
      try {
        return await query(sql, params)
      } catch (error) {
        throw mapClientError(error)
      }
    },
  }
}

export function readPayoutRpc(data: unknown): Record<string, unknown> {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) throw new PayoutError('PAYOUT_UNAVAILABLE')
  const payload = data as Record<string, unknown>
  if (payload.ok === false) throw new PayoutError(asPayoutErrorCode(payload.error))
  if (payload.ok !== true) throw new PayoutError('PAYOUT_UNAVAILABLE')
  return payload
}

function asPayoutErrorCode(value: unknown): PayoutErrorCode {
  if (typeof value === 'string' && PAYOUT_ERROR_CODES.has(value as PayoutErrorCode)) {
    return value as PayoutErrorCode
  }
  return 'PAYOUT_UNAVAILABLE'
}

function encodePgValue(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString()
  if (value instanceof Date) return value.toISOString()
  if (value !== null && typeof value === 'object') return JSON.stringify(value)
  return value
}

function pgCast(key: string, value: unknown): string {
  if (key === 'p_amount_luna' || key.endsWith('_luna') || typeof value === 'bigint') return '::bigint'
  if (key === 'p_execution_day' || key.endsWith('_day')) return '::date'
  if (key === 'p_cycle_id') return '::uuid'
  if (key === 'p_cycle_at') return '::timestamptz'
  if (value !== null && typeof value === 'object' && !(value instanceof Date)) return '::jsonb'
  return ''
}

function mapClientError(error: unknown): PayoutError {
  const message = errorMessage(error)
  if (message.includes('PAYOUT_IMMUTABLE')) return new PayoutError('PAYOUT_STATUS_INVALID')
  if (message.includes('PAYOUT_RESEND_UNSAFE')) return new PayoutError('PAYOUT_RESEND_UNSAFE')
  return new PayoutError('PAYOUT_UNAVAILABLE')
}

function errorMessage(error: unknown): string {
  if (typeof error === 'string') return error
  if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string') {
    return error.message
  }
  return ''
}
