import type { SupabaseClient } from '@supabase/supabase-js'
import { ProofError } from './errors.ts'
import type { ExpeditionProofErrorCode } from '../../src/domain/expeditionProof.ts'

const PROOF_RPCS = new Set([
  'create_start_challenge',
  'start_expedition_authorized',
  'bind_run_session',
  'get_run_session',
  'get_published_blueprint',
  'register_published_blueprint',
  'mark_gameplay_started',
  'append_checkpoint_batch',
  'persist_run_terminal',
  'persist_vault_seal',
  'prepare_reward_claim',
  'finalize_reward_claim',
  'get_reward_claim',
  'load_expedition_run',
  'load_proof_snapshot',
  'get_wallet_daily_status',
])

const PROOF_ERROR_CODES = new Set<ExpeditionProofErrorCode>([
  'MALFORMED_TRANSCRIPT',
  'ACTION_LIMIT_EXCEEDED',
  'INVALID_SEQUENCE',
  'INVALID_ACTION',
  'UNSUPPORTED_RULES_VERSION',
  'UNSUPPORTED_ROOM_VERSION',
  'UNSUPPORTED_BLUEPRINT_VERSION',
  'CHECKPOINT_MISMATCH',
  'PROOF_LOST',
  'DAILY_BLUEPRINT_UNAVAILABLE',
  'INVALID_WALLET',
  'MALFORMED_REQUEST',
  'START_CHALLENGE_EXPIRED',
  'START_CHALLENGE_DAY_EXPIRED',
  'START_CHALLENGE_INVALID',
  'START_ALREADY_CREATED',
  'INVALID_SESSION',
  'SESSION_EXPIRED',
  'SESSION_REVOKED',
  'RUN_NOT_FOUND',
  'RUN_MISMATCH',
  'WALLET_MISMATCH',
  'RUN_NOT_ACTIVE',
  'INVALID_SIGNATURE',
  'ADDRESS_MISMATCH',
  'VAULT_SEAL_REQUIRED',
  'VAULT_SEAL_MISMATCH',
  'CLAIM_NOT_FOUND',
  'CLAIM_MISMATCH',
  'CLAIM_NOT_ELIGIBLE',
  'CLAIM_WINDOW_EXPIRED',
  'CLAIM_ALREADY_FINALIZED',
  'DAILY_EXPEDITION_LIMIT_REACHED',
  'BLUEPRINT_INVALID',
  'BLUEPRINT_IMMUTABLE',
  'BLUEPRINT_ALREADY_PUBLISHED',
  'BLUEPRINT_LIFECYCLE_INVALID',
  'PROOF_UNAVAILABLE',
  'SOLD_OUT',
  'ALREADY_REWARDED',
  'RUN_SESSION_INVALID',
  'ACTIVE_RUN_UNAVAILABLE',
  'RUN_INCOMPLETE',
])

export type ProofRpcClient = {
  rpc(fn: string, args?: Record<string, unknown>): Promise<unknown>
}

export type ProofRpcResult = Record<string, unknown>

export function createSupabaseProofRpcClient(client: SupabaseClient): ProofRpcClient {
  return {
    async rpc(fn, args = {}) {
      if (!PROOF_RPCS.has(fn)) throw new ProofError('PROOF_UNAVAILABLE')
      const { data, error } = await client.rpc(fn, args)
      if (error) throw mapClientError(error)
      return data
    },
  }
}

export function createPgProofRpcClient(
  query: (sql: string, params: unknown[]) => Promise<unknown>,
): ProofRpcClient {
  return {
    async rpc(fn, args = {}) {
      if (!PROOF_RPCS.has(fn)) throw new ProofError('PROOF_UNAVAILABLE')
      const keys = Object.keys(args)
      if (keys.some(key => !/^p_[a-z0-9_]+$/.test(key))) throw new ProofError('PROOF_UNAVAILABLE')
      const params = keys.map(key => encodePgValue(args[key]))
      const sql = keys.length === 0
        ? `select public.${fn}() as result`
        : `select public.${fn}(${keys.map((key, index) => `${key} := $${index + 1}${pgCast(args[key])}`).join(', ')}) as result`
      try {
        return await query(sql, params)
      } catch (error) {
        throw mapClientError(error)
      }
    },
  }
}

export function readProofRpc(data: unknown): ProofRpcResult {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new ProofError('PROOF_UNAVAILABLE')
  }
  const payload = data as ProofRpcResult
  if (payload.ok === false) throw new ProofError(asProofErrorCode(payload.error))
  if (payload.ok !== true) throw new ProofError('PROOF_UNAVAILABLE')
  return payload
}

export function asProofErrorCode(value: unknown): ExpeditionProofErrorCode {
  if (typeof value === 'string' && PROOF_ERROR_CODES.has(value as ExpeditionProofErrorCode)) {
    return value as ExpeditionProofErrorCode
  }
  return 'PROOF_UNAVAILABLE'
}

function encodePgValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString()
  if (value !== null && typeof value === 'object') return JSON.stringify(value)
  return value
}

function pgCast(value: unknown): string {
  if (value !== null && typeof value === 'object' && !(value instanceof Date)) return '::jsonb'
  return ''
}

function mapClientError(error: unknown): ProofError {
  const message = errorMessage(error)
  if (message.includes('BLUEPRINT_IMMUTABLE') || message.includes('PUBLISHED_BLUEPRINT_IMMUTABLE')) {
    return new ProofError('BLUEPRINT_IMMUTABLE')
  }
  if (message.includes('BLUEPRINT_ALREADY_PUBLISHED')) return new ProofError('BLUEPRINT_ALREADY_PUBLISHED')
  if (message.includes('PROOF_LOST')) return new ProofError('PROOF_LOST')
  return new ProofError('PROOF_UNAVAILABLE')
}

function errorMessage(error: unknown): string {
  if (typeof error === 'string') return error
  if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string') {
    return error.message
  }
  return ''
}
