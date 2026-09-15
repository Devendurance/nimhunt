import type { SupabaseClient } from '@supabase/supabase-js'
import { LedgerError } from './errors.ts'
import { utcDayKey } from './utcDay.ts'
import { normalizeNimiqWallet } from './wallet.ts'

export const DEV_RESET_ENABLE_FLAG = 'NIMHUNT_ENABLE_DEV_RESET'

export type DevResetErrorCode =
  | 'DEV_RESET_DISABLED'
  | 'INVALID_WALLET'
  | 'PROOF_UNAVAILABLE'
  | 'ACTIVE_RUN_EXISTS'
  | 'MULTIPLE_ROWS'
  | 'MALFORMED_REQUEST'

export class DevResetError extends Error {
  readonly code: DevResetErrorCode

  constructor(code: DevResetErrorCode, message?: string) {
    super(message ?? code)
    this.name = 'DevResetError'
    this.code = code
  }
}

export type WalletDayRow = {
  readonly dayKey: string
  readonly wallet: string
  readonly expeditionsStarted: number
  readonly rewardsReserved: number
}

export type DevResetSnapshot = {
  readonly runCount: number
  readonly batchCount: number
  readonly sealCount: number
  readonly poolReservedSlots: number | null
  readonly otherWalletsOnDay: number
}

export type DevResetStore = {
  getWalletDay(dayKey: string, wallet: string): Promise<readonly WalletDayRow[]>
  setExpeditionsStarted(dayKey: string, wallet: string, value: 0): Promise<WalletDayRow>
  listPlayableStartedRuns(dayKey: string, wallet: string): Promise<readonly { readonly runId: string; readonly mission: string }[]>
  snapshot(dayKey: string, wallet: string): Promise<DevResetSnapshot>
}

export type DevResetResult = {
  readonly dayKey: string
  readonly wallet: string
  readonly beforeStarted: number
  readonly afterStarted: number
  readonly beforeRemaining: number
  readonly afterRemaining: number
  readonly rowsChanged: number
  readonly rewardsReserved: number
  readonly createdRow: boolean
  readonly before: DevResetSnapshot
  readonly after: DevResetSnapshot
}

export function assertDevResetEnabled(env: Record<string, string | undefined>): void {
  if (env[DEV_RESET_ENABLE_FLAG] !== 'true') {
    throw new DevResetError('DEV_RESET_DISABLED')
  }
}

export function parseDevResetWalletArg(argv: readonly string[]): string {
  if (argv.some(argument => argument === '--all' || argument.startsWith('--all='))) {
    throw new DevResetError('MALFORMED_REQUEST', 'WILDCARD_RESET_FORBIDDEN')
  }
  const assigned = argv.find(argument => argument.startsWith('--wallet='))
  if (assigned) {
    const value = assigned.slice('--wallet='.length).trim()
    if (!value) throw new DevResetError('INVALID_WALLET')
    return value
  }
  const index = argv.indexOf('--wallet')
  const value = index >= 0 ? argv[index + 1]?.trim() : undefined
  if (index >= 0 && value && !value.startsWith('--')) return value
  throw new DevResetError('MALFORMED_REQUEST', 'WALLET_REQUIRED')
}

export function redactWallet(wallet: string): string {
  const parts = wallet.split(/\s+/).filter(Boolean)
  if (parts.length >= 3) return `${parts[0]} ${parts[1]} … ${parts[parts.length - 1]}`
  if (wallet.length <= 8) return `${wallet.slice(0, 2)}…`
  return `${wallet.slice(0, 4)}…${wallet.slice(-4)}`
}

export async function resetDevExpeditionAttempts(input: {
  readonly env: Record<string, string | undefined>
  readonly wallet: string
  readonly store: DevResetStore
  readonly now?: Date
}): Promise<DevResetResult> {
  assertDevResetEnabled(input.env)
  let wallet: string
  try {
    wallet = normalizeNimiqWallet(input.wallet)
  } catch (error) {
    if (error instanceof LedgerError && error.code === 'INVALID_WALLET') {
      throw new DevResetError('INVALID_WALLET')
    }
    throw error
  }

  const dayKey = utcDayKey(input.now ?? new Date())
  const playable = await input.store.listPlayableStartedRuns(dayKey, wallet)
  if (playable.length > 0) {
    throw new DevResetError(
      'ACTIVE_RUN_EXISTS',
      `ACTIVE_RUN_EXISTS:${playable.map(run => run.mission).join(',')}`,
    )
  }

  const rows = await input.store.getWalletDay(dayKey, wallet)
  if (rows.length > 1) throw new DevResetError('MULTIPLE_ROWS')
  const before = await input.store.snapshot(dayKey, wallet)
  const existing = rows[0]
  const beforeStarted = existing?.expeditionsStarted ?? 0
  let afterRow = existing
  let rowsChanged = 0
  if (existing && existing.expeditionsStarted !== 0) {
    afterRow = await input.store.setExpeditionsStarted(dayKey, wallet, 0)
    rowsChanged = 1
  }
  const after = await input.store.snapshot(dayKey, wallet)
  if (after.runCount !== before.runCount
    || after.batchCount !== before.batchCount
    || after.sealCount !== before.sealCount
    || after.poolReservedSlots !== before.poolReservedSlots
    || after.otherWalletsOnDay !== before.otherWalletsOnDay) {
    throw new DevResetError('PROOF_UNAVAILABLE', 'PROOF_HISTORY_MUTATED')
  }

  const afterStarted = afterRow?.expeditionsStarted ?? 0
  return {
    dayKey,
    wallet,
    beforeStarted,
    afterStarted,
    beforeRemaining: 3 - beforeStarted,
    afterRemaining: 3 - afterStarted,
    rowsChanged,
    rewardsReserved: afterRow?.rewardsReserved ?? 0,
    createdRow: false,
    before,
    after,
  }
}

export function createSupabaseDevResetStore(client: SupabaseClient): DevResetStore {
  return {
    async getWalletDay(dayKey, wallet) {
      const { data, error } = await client
        .from('daily_wallet_state')
        .select('day_key,wallet,expeditions_started,rewards_reserved')
        .eq('day_key', dayKey)
        .eq('wallet', wallet)
      if (error) throw new DevResetError('PROOF_UNAVAILABLE', error.message)
      return (data ?? []).map(asWalletDayRow)
    },

    async setExpeditionsStarted(dayKey, wallet, value) {
      const { data, error } = await client
        .from('daily_wallet_state')
        .update({ expeditions_started: value })
        .eq('day_key', dayKey)
        .eq('wallet', wallet)
        .select('day_key,wallet,expeditions_started,rewards_reserved')
      if (error) throw new DevResetError('PROOF_UNAVAILABLE', error.message)
      if (!data || data.length !== 1) throw new DevResetError('MULTIPLE_ROWS')
      return asWalletDayRow(data[0])
    },

    async listPlayableStartedRuns(dayKey, wallet) {
      const { data, error } = await client
        .from('expedition_runs')
        .select('id,mission_type,status,terminal,gameplay_started_at')
        .eq('day_key', dayKey)
        .eq('wallet', wallet)
        .eq('status', 'STARTED')
      if (error) throw new DevResetError('PROOF_UNAVAILABLE', error.message)
      return (data ?? [])
        .filter(row => row.terminal == null && row.gameplay_started_at == null)
        .map(row => ({ runId: String(row.id), mission: String(row.mission_type) }))
    },

    async snapshot(dayKey, wallet) {
      const runs = await client
        .from('expedition_runs')
        .select('id')
        .eq('day_key', dayKey)
        .eq('wallet', wallet)
      if (runs.error) throw new DevResetError('PROOF_UNAVAILABLE', runs.error.message)
      const runIds = (runs.data ?? []).map(row => String(row.id))
      const batches = runIds.length === 0
        ? { data: [], error: null }
        : await client.from('expedition_checkpoint_batches').select('run_id').in('run_id', runIds)
      if (batches.error) throw new DevResetError('PROOF_UNAVAILABLE', batches.error.message)
      const seals = runIds.length === 0
        ? { data: [], error: null }
        : await client.from('expedition_vault_seals').select('run_id').in('run_id', runIds)
      if (seals.error) throw new DevResetError('PROOF_UNAVAILABLE', seals.error.message)
      const pool = await client
        .from('daily_reward_pools')
        .select('reserved_slots')
        .eq('day_key', dayKey)
        .maybeSingle()
      if (pool.error) throw new DevResetError('PROOF_UNAVAILABLE', pool.error.message)
      const others = await client
        .from('daily_wallet_state')
        .select('wallet')
        .eq('day_key', dayKey)
        .neq('wallet', wallet)
      if (others.error) throw new DevResetError('PROOF_UNAVAILABLE', others.error.message)
      return {
        runCount: runIds.length,
        batchCount: batches.data?.length ?? 0,
        sealCount: seals.data?.length ?? 0,
        poolReservedSlots: pool.data == null ? null : Number(pool.data.reserved_slots),
        otherWalletsOnDay: others.data?.length ?? 0,
      }
    },
  }
}

function asWalletDayRow(row: Record<string, unknown> | null | undefined): WalletDayRow {
  if (!row) throw new DevResetError('PROOF_UNAVAILABLE')
  const dayKey = String(row.day_key).slice(0, 10)
  const wallet = String(row.wallet)
  const expeditionsStarted = Number(row.expeditions_started)
  const rewardsReserved = Number(row.rewards_reserved)
  if (!dayKey || !wallet || !Number.isInteger(expeditionsStarted) || !Number.isInteger(rewardsReserved)) {
    throw new DevResetError('PROOF_UNAVAILABLE')
  }
  return { dayKey, wallet, expeditionsStarted, rewardsReserved }
}
