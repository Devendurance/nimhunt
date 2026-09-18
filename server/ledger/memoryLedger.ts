import {
  DAILY_EXPEDITION_LIMIT,
  DAILY_REWARD_LIMIT_PER_WALLET,
  DAILY_REWARD_SLOTS,
  type ExpeditionRewardStatus,
} from '../../src/domain/dailyLedger.js'
import { LedgerError } from './errors.js'
import { parseMissionType } from './mission.js'
import type { Clock, DailyLedger, ExpeditionRun } from './types.js'
import { nextUtcResetAt, utcDayKey } from './utcDay.js'
import { normalizeNimiqWallet } from './wallet.js'

type Pool = {
  reservedSlots: number
}

type WalletState = {
  expeditionsStarted: number
  rewardsReserved: number
}

class AsyncMutex {
  private tail: Promise<void> = Promise.resolve()

  run<T>(fn: () => T | Promise<T>): Promise<T> {
    const run = this.tail.then(fn, fn)
    this.tail = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }
}

export function createMemoryDailyLedger(clock: Clock): DailyLedger {
  const mutex = new AsyncMutex()
  const pools = new Map<string, Pool>()
  const wallets = new Map<string, WalletState>()
  const runs = new Map<string, ExpeditionRun>()

  const walletKey = (dayKey: string, wallet: string) => `${dayKey}:${wallet}`

  const ensurePool = (dayKey: string): Pool => {
    const existing = pools.get(dayKey)
    if (existing) return existing
    const created = { reservedSlots: 0 }
    pools.set(dayKey, created)
    return created
  }

  const ensureWallet = (dayKey: string, wallet: string): WalletState => {
    const key = walletKey(dayKey, wallet)
    const existing = wallets.get(key)
    if (existing) return existing
    const created = { expeditionsStarted: 0, rewardsReserved: 0 }
    wallets.set(key, created)
    return created
  }

  const readRun = (runId: string, wallet: string): ExpeditionRun => {
    const run = runs.get(runId)
    if (!run) throw new LedgerError('RUN_NOT_FOUND')
    if (run.wallet !== wallet) throw new LedgerError('WALLET_MISMATCH')
    return run
  }

  const transition = (runId: string, wallet: string, status: 'COMPLETED' | 'FAILED' | 'ABANDONED'): ExpeditionRun => {
    const run = readRun(runId, wallet)
    if (run.status === status) return run
    if (run.status !== 'STARTED') throw new LedgerError('INVALID_RUN_TRANSITION')
    run.status = status
    run.endedAt = clock.now().toISOString()
    if (status === 'COMPLETED' && run.rewardStatus === 'NONE') {
      // Accounting-only eligibility. See LEDGER_TRUST_BOUNDARY.
      run.rewardStatus = 'ELIGIBLE'
    }
    return { ...run }
  }

  return {
    startExpedition(wallet, missionType) {
      return mutex.run(() => {
        const normalized = normalizeNimiqWallet(wallet)
        const mission = parseMissionType(missionType)
        const now = clock.now()
        const dayKey = utcDayKey(now)
        const state = ensureWallet(dayKey, normalized)
        ensurePool(dayKey)
        if (state.expeditionsStarted >= DAILY_EXPEDITION_LIMIT) {
          throw new LedgerError('DAILY_EXPEDITION_LIMIT_REACHED')
        }
        state.expeditionsStarted += 1
        const run: ExpeditionRun = {
          id: crypto.randomUUID(),
          dayKey,
          wallet: normalized,
          missionType: mission,
          status: 'STARTED',
          startedAt: now.toISOString(),
          endedAt: null,
          rewardStatus: 'NONE',
          reservationNumber: null,
        }
        runs.set(run.id, run)
        return {
          runId: run.id,
          attemptsUsed: state.expeditionsStarted,
          attemptsRemaining: DAILY_EXPEDITION_LIMIT - state.expeditionsStarted,
          dayKey,
          nextResetAt: nextUtcResetAt(dayKey),
        }
      })
    },

    completeRun(runId, wallet) {
      // COMPLETED is accounting-only. Do not treat this as payout-grade task proof.
      return mutex.run(() => transition(runId, normalizeNimiqWallet(wallet), 'COMPLETED'))
    },

    failRun(runId, wallet) {
      return mutex.run(() => transition(runId, normalizeNimiqWallet(wallet), 'FAILED'))
    },

    abandonRun(runId, wallet) {
      return mutex.run(() => transition(runId, normalizeNimiqWallet(wallet), 'ABANDONED'))
    },

    reserveDailyReward(runId, wallet) {
      return mutex.run(() => {
        const normalized = normalizeNimiqWallet(wallet)
        const run = readRun(runId, normalized)
        if (run.status !== 'COMPLETED') throw new LedgerError('RUN_NOT_COMPLETED')

        const state = ensureWallet(run.dayKey, normalized)
        if (run.rewardStatus === 'RESERVED' || state.rewardsReserved >= DAILY_REWARD_LIMIT_PER_WALLET) {
          throw new LedgerError('ALREADY_REWARDED')
        }

        const pool = ensurePool(run.dayKey)
        if (pool.reservedSlots >= DAILY_REWARD_SLOTS) {
          run.rewardStatus = 'SOLD_OUT'
          throw new LedgerError('SOLD_OUT')
        }

        pool.reservedSlots += 1
        state.rewardsReserved = 1
        run.rewardStatus = 'RESERVED' satisfies ExpeditionRewardStatus
        run.reservationNumber = pool.reservedSlots
        return {
          reserved: true as const,
          reservationNumber: pool.reservedSlots,
          remainingSlots: DAILY_REWARD_SLOTS - pool.reservedSlots,
          totalSlots: DAILY_REWARD_SLOTS,
        }
      })
    },

    getDailyHuntStatus() {
      return mutex.run(() => {
        const dayKey = utcDayKey(clock.now())
        const reservedSlots = pools.get(dayKey)?.reservedSlots ?? 0
        return {
          totalSlots: DAILY_REWARD_SLOTS,
          reservedSlots,
          remainingSlots: DAILY_REWARD_SLOTS - reservedSlots,
          dayKey,
          nextResetAt: nextUtcResetAt(dayKey),
        }
      })
    },

    getWalletDailyStatus(wallet) {
      return mutex.run(() => {
        const normalized = normalizeNimiqWallet(wallet)
        const dayKey = utcDayKey(clock.now())
        const state = wallets.get(walletKey(dayKey, normalized))
        const expeditionsStarted = state?.expeditionsStarted ?? 0
        return {
          dayKey,
          expeditionsStarted,
          expeditionsRemaining: DAILY_EXPEDITION_LIMIT - expeditionsStarted,
          rewardAlreadyReserved: (state?.rewardsReserved ?? 0) >= DAILY_REWARD_LIMIT_PER_WALLET,
          nextResetAt: nextUtcResetAt(dayKey),
        }
      })
    },

    seedReservedSlots(count) {
      return mutex.run(() => {
        if (count < 0 || count > DAILY_REWARD_SLOTS) throw new LedgerError('MALFORMED_REQUEST')
        const dayKey = utcDayKey(clock.now())
        ensurePool(dayKey).reservedSlots = count
      })
    },
  }
}
