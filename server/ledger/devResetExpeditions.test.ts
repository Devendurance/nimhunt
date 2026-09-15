import { KeyPair } from '@nimiq/core'
import { describe, expect, it } from 'vitest'
import {
  DevResetError,
  parseDevResetWalletArg,
  redactWallet,
  resetDevExpeditionAttempts,
  type DevResetSnapshot,
  type DevResetStore,
  type WalletDayRow,
} from './devResetExpeditions.ts'

function wallet(): string {
  return KeyPair.generate().toAddress().toUserFriendlyAddress()
}

function memoryStore(seed: {
  readonly dayKey: string
  readonly rows?: WalletDayRow[]
  readonly runs?: { runId: string; wallet: string; dayKey: string; playable?: boolean }[]
  readonly batches?: number
  readonly seals?: number
  readonly poolReservedSlots?: number | null
} ): DevResetStore & { rows: WalletDayRow[]; runs: { runId: string; wallet: string; dayKey: string; playable?: boolean }[] } {
  const rows = [...(seed.rows ?? [])]
  const runs = [...(seed.runs ?? [])]
  const poolReservedSlots = seed.poolReservedSlots ?? 0
  const snapshotFor = (dayKey: string, target: string): DevResetSnapshot => ({
    runCount: runs.filter(run => run.dayKey === dayKey && run.wallet === target).length,
    batchCount: seed.batches ?? 0,
    sealCount: seed.seals ?? 0,
    poolReservedSlots,
    otherWalletsOnDay: new Set(rows.filter(row => row.dayKey === dayKey && row.wallet !== target).map(row => row.wallet)).size,
  })
  return {
    rows,
    runs,
    async getWalletDay(dayKey, target) {
      return rows.filter(row => row.dayKey === dayKey && row.wallet === target)
    },
    async setExpeditionsStarted(dayKey, target, value) {
      const matches = rows.filter(row => row.dayKey === dayKey && row.wallet === target)
      if (matches.length !== 1) throw new Error('MULTIPLE_ROWS')
      const next = { ...matches[0]!, expeditionsStarted: value }
      const index = rows.indexOf(matches[0]!)
      rows[index] = next
      return next
    },
    async listPlayableStartedRuns(dayKey, target) {
      return runs
        .filter(run => run.dayKey === dayKey && run.wallet === target && run.playable)
        .map(run => ({ runId: run.runId, mission: 'vault-breaker' }))
    },
    async snapshot(dayKey, target) {
      return snapshotFor(dayKey, target)
    },
  }
}

describe('dev expedition attempt reset', () => {
  const now = new Date('2026-09-15T18:00:00.000Z')
  const dayKey = '2026-09-15'

  it('refuses to run unless explicitly enabled', async () => {
    const target = wallet()
    await expect(resetDevExpeditionAttempts({
      env: {},
      wallet: target,
      now,
      store: memoryStore({ dayKey }),
    })).rejects.toMatchObject({ code: 'DEV_RESET_DISABLED' })
    await expect(resetDevExpeditionAttempts({
      env: { NIMHUNT_ENABLE_DEV_RESET: '1' },
      wallet: target,
      now,
      store: memoryStore({ dayKey }),
    })).rejects.toMatchObject({ code: 'DEV_RESET_DISABLED' })
  })

  it('refuses a malformed wallet', async () => {
    await expect(resetDevExpeditionAttempts({
      env: { NIMHUNT_ENABLE_DEV_RESET: 'true' },
      wallet: 'not-a-wallet',
      now,
      store: memoryStore({ dayKey }),
    })).rejects.toMatchObject({ code: 'INVALID_WALLET' })
  })

  it('requires an explicit wallet and forbids wildcard reset', () => {
    expect(() => parseDevResetWalletArg([])).toThrowError(DevResetError)
    expect(() => parseDevResetWalletArg(['--all'])).toThrowError(/WILDCARD/)
    expect(parseDevResetWalletArg(['--wallet=NQ07 ABC'])).toBe('NQ07 ABC')
    expect(parseDevResetWalletArg(['--wallet', 'NQ07 ABC'])).toBe('NQ07 ABC')
  })

  it('is a no-op when the wallet/day row does not exist', async () => {
    const target = wallet()
    const store = memoryStore({ dayKey, rows: [], runs: [] })
    const result = await resetDevExpeditionAttempts({
      env: { NIMHUNT_ENABLE_DEV_RESET: 'true' },
      wallet: target,
      now,
      store,
    })
    expect(result).toMatchObject({
      dayKey,
      beforeStarted: 0,
      afterStarted: 0,
      rowsChanged: 0,
      createdRow: false,
    })
    expect(store.rows).toEqual([])
  })

  it('resets only the requested wallet/current day attempt counter', async () => {
    const target = wallet()
    const other = wallet()
    const store = memoryStore({
      dayKey,
      rows: [
        { dayKey, wallet: target, expeditionsStarted: 3, rewardsReserved: 0 },
        { dayKey, wallet: other, expeditionsStarted: 2, rewardsReserved: 1 },
        { dayKey: '2026-09-14', wallet: target, expeditionsStarted: 3, rewardsReserved: 0 },
      ],
      runs: [
        { runId: 'run-1', wallet: target, dayKey, playable: false },
        { runId: 'run-2', wallet: target, dayKey, playable: false },
      ],
      batches: 4,
      seals: 1,
      poolReservedSlots: 0,
    })
    const result = await resetDevExpeditionAttempts({
      env: { NIMHUNT_ENABLE_DEV_RESET: 'true' },
      wallet: target,
      now,
      store,
    })
    expect(result).toMatchObject({
      dayKey,
      wallet: target,
      beforeStarted: 3,
      afterStarted: 0,
      beforeRemaining: 0,
      afterRemaining: 3,
      rowsChanged: 1,
      rewardsReserved: 0,
    })
    expect(store.rows).toEqual([
      { dayKey, wallet: target, expeditionsStarted: 0, rewardsReserved: 0 },
      { dayKey, wallet: other, expeditionsStarted: 2, rewardsReserved: 1 },
      { dayKey: '2026-09-14', wallet: target, expeditionsStarted: 3, rewardsReserved: 0 },
    ])
    expect(store.runs).toHaveLength(2)
    expect(result.after).toEqual(result.before)
    expect(result.after).toMatchObject({
      runCount: 2,
      batchCount: 4,
      sealCount: 1,
      poolReservedSlots: 0,
      otherWalletsOnDay: 1,
    })
  })

  it('fails if more than one wallet/day row would change', async () => {
    const target = wallet()
    const store = memoryStore({
      dayKey,
      rows: [
        { dayKey, wallet: target, expeditionsStarted: 3, rewardsReserved: 0 },
        { dayKey, wallet: target, expeditionsStarted: 1, rewardsReserved: 0 },
      ],
    })
    await expect(resetDevExpeditionAttempts({
      env: { NIMHUNT_ENABLE_DEV_RESET: 'true' },
      wallet: target,
      now,
      store,
    })).rejects.toMatchObject({ code: 'MULTIPLE_ROWS' })
    expect(store.rows.every(row => row.expeditionsStarted !== 0)).toBe(true)
  })

  it('allows leftover gameplay-started STARTED history without destroying it', async () => {
    const target = wallet()
    const store = memoryStore({
      dayKey,
      rows: [{ dayKey, wallet: target, expeditionsStarted: 3, rewardsReserved: 0 }],
      runs: [{ runId: 'run-stuck', wallet: target, dayKey, playable: false }],
    })
    const result = await resetDevExpeditionAttempts({
      env: { NIMHUNT_ENABLE_DEV_RESET: 'true' },
      wallet: target,
      now,
      store,
    })
    expect(result.afterStarted).toBe(0)
    expect(store.runs).toEqual([{ runId: 'run-stuck', wallet: target, dayKey, playable: false }])
  })

  it('fails if a playable STARTED run still exists', async () => {
    const target = wallet()
    const store = memoryStore({
      dayKey,
      rows: [{ dayKey, wallet: target, expeditionsStarted: 3, rewardsReserved: 0 }],
      runs: [{ runId: 'run-live', wallet: target, dayKey, playable: true }],
    })
    await expect(resetDevExpeditionAttempts({
      env: { NIMHUNT_ENABLE_DEV_RESET: 'true' },
      wallet: target,
      now,
      store,
    })).rejects.toMatchObject({ code: 'ACTIVE_RUN_EXISTS' })
    expect(store.rows[0]?.expeditionsStarted).toBe(3)
  })

  it('redacts wallet output', () => {
    expect(redactWallet('NQ07 33E4 6T32 24Y7 X4BA 7SP2 27TX 32PL 54JG')).toBe('NQ07 33E4 … 54JG')
  })
})
