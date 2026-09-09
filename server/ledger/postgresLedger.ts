import type { SupabaseClient } from '@supabase/supabase-js'
import {
  DAILY_EXPEDITION_LIMIT,
  DAILY_REWARD_SLOTS,
  type LedgerErrorCode,
} from '../../src/domain/dailyLedger.ts'
import { LedgerError } from './errors.ts'
import { parseMissionType } from './mission.ts'
import type { DailyLedger, ExpeditionRun } from './types.ts'
import { normalizeNimiqWallet } from './wallet.ts'

type RpcMap = Record<string, unknown>

export function createPostgresDailyLedger(client: SupabaseClient): DailyLedger {
  return {
    async startExpedition(wallet, missionType) {
      const normalized = normalizeNimiqWallet(wallet)
      const mission = parseMissionType(missionType)
      const data = await rpc(client, 'start_expedition', {
        p_wallet: normalized,
        p_mission_type: mission,
      })
      const started = asNumber(data.expeditions_started)
      return {
        runId: asString(data.run_id),
        attemptsUsed: started,
        attemptsRemaining: DAILY_EXPEDITION_LIMIT - started,
        dayKey: asDayKey(data.day_key),
        nextResetAt: asIso(data.next_reset_at),
      }
    },

    completeRun(runId, wallet) {
      return transition(client, runId, wallet, 'COMPLETED')
    },

    failRun(runId, wallet) {
      return transition(client, runId, wallet, 'FAILED')
    },

    abandonRun(runId, wallet) {
      return transition(client, runId, wallet, 'ABANDONED')
    },

    async reserveDailyReward(runId, wallet) {
      const data = await rpc(client, 'reserve_daily_reward', {
        p_run_id: runId,
        p_wallet: normalizeNimiqWallet(wallet),
      })
      return {
        reserved: true as const,
        reservationNumber: asNumber(data.reservation_number),
        remainingSlots: asNumber(data.remaining_slots),
        totalSlots: DAILY_REWARD_SLOTS,
      }
    },

    async getDailyHuntStatus() {
      const data = await rpc(client, 'get_daily_hunt_status', {})
      return {
        totalSlots: DAILY_REWARD_SLOTS,
        reservedSlots: asNumber(data.reserved_slots),
        remainingSlots: asNumber(data.remaining_slots),
        dayKey: asDayKey(data.day_key),
        nextResetAt: asIso(data.next_reset_at),
      }
    },

    async getWalletDailyStatus(wallet) {
      const data = await rpc(client, 'get_wallet_daily_status', {
        p_wallet: normalizeNimiqWallet(wallet),
      })
      return {
        dayKey: asDayKey(data.day_key),
        expeditionsStarted: asNumber(data.expeditions_started),
        expeditionsRemaining: asNumber(data.expeditions_remaining),
        rewardAlreadyReserved: Boolean(data.reward_already_reserved),
        nextResetAt: asIso(data.next_reset_at),
      }
    },

    async seedReservedSlots(count) {
      if (count < 0 || count > DAILY_REWARD_SLOTS) throw new LedgerError('MALFORMED_REQUEST')
      const status = await this.getDailyHuntStatus()
      const { error } = await client.from('daily_reward_pools').upsert({
        day_key: status.dayKey,
        total_slots: DAILY_REWARD_SLOTS,
        reserved_slots: count,
      })
      if (error) throw new LedgerError('LEDGER_UNAVAILABLE')
    },
  }
}

async function transition(
  client: SupabaseClient,
  runId: string,
  wallet: string,
  status: 'COMPLETED' | 'FAILED' | 'ABANDONED',
): Promise<ExpeditionRun> {
  const data = await rpc(client, 'transition_expedition_run', {
    p_run_id: runId,
    p_wallet: normalizeNimiqWallet(wallet),
    p_status: status,
  })
  return {
    id: asString(data.id),
    dayKey: asDayKey(data.day_key),
    wallet: asString(data.wallet),
    missionType: parseMissionType(data.mission_type),
    status: data.status as ExpeditionRun['status'],
    startedAt: asIso(data.started_at),
    endedAt: data.ended_at == null ? null : asIso(data.ended_at),
    rewardStatus: data.reward_status as ExpeditionRun['rewardStatus'],
    reservationNumber: data.reservation_number == null ? null : asNumber(data.reservation_number),
  }
}

async function rpc(client: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<RpcMap> {
  const { data, error } = await client.rpc(fn, args)
  if (error) throw new LedgerError('LEDGER_UNAVAILABLE')
  if (typeof data !== 'object' || data === null) throw new LedgerError('LEDGER_UNAVAILABLE')
  const payload = data as RpcMap
  if (payload.ok === false) {
    throw new LedgerError(asErrorCode(payload.error))
  }
  return payload
}

function asErrorCode(value: unknown): LedgerErrorCode {
  if (typeof value === 'string' && value.length > 0) return value as LedgerErrorCode
  return 'MALFORMED_REQUEST'
}

function asString(value: unknown): string {
  if (typeof value === 'string' && value.length > 0) return value
  throw new LedgerError('MALFORMED_REQUEST')
}

function asNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value)
  throw new LedgerError('MALFORMED_REQUEST')
}

function asDayKey(value: unknown): string {
  const text = asString(value)
  return text.slice(0, 10)
}

function asIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString()
  const text = asString(value)
  const parsed = new Date(text)
  if (Number.isNaN(parsed.getTime())) throw new LedgerError('MALFORMED_REQUEST')
  return parsed.toISOString()
}
