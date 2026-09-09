import { KeyPair } from '@nimiq/core'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { DAILY_EXPEDITION_LIMIT, DAILY_REWARD_SLOTS } from '../../src/domain/dailyLedger.ts'
import { LedgerError } from './errors.ts'
import { dispatchLedgerHttp } from './http.ts'
import { createMemoryDailyLedger } from './memoryLedger.ts'

function wallet(): string {
  return KeyPair.generate().toAddress().toUserFriendlyAddress()
}

function createLedger(now = new Date('2026-09-08T12:00:00.000Z')) {
  let current = now
  const ledger = createMemoryDailyLedger({ now: () => current })
  return {
    ledger,
    setNow(next: Date) {
      current = next
    },
  }
}

describe('daily expedition ledger', () => {
  it('creates daily wallet state on the first expedition start', async () => {
    const { ledger } = createLedger()
    const address = wallet()
    const started = await ledger.startExpedition(address, 'gem-runner')

    expect(started.attemptsUsed).toBe(1)
    expect(started.attemptsRemaining).toBe(2)
    expect(started.dayKey).toBe('2026-09-08')
    expect(started.nextResetAt).toBe('2026-09-09T00:00:00.000Z')
    expect(started.runId).toMatch(/^[0-9a-f-]{36}$/i)

    const status = await ledger.getWalletDailyStatus(address)
    expect(status).toEqual({
      dayKey: '2026-09-08',
      expeditionsStarted: 1,
      expeditionsRemaining: 2,
      rewardAlreadyReserved: false,
      nextResetAt: '2026-09-09T00:00:00.000Z',
    })
  })

  it('allows three starts and rejects the fourth with DAILY_EXPEDITION_LIMIT_REACHED', async () => {
    const { ledger } = createLedger()
    const address = wallet()

    expect((await ledger.startExpedition(address, 'gem-runner')).attemptsUsed).toBe(1)
    expect((await ledger.startExpedition(address, 'chest-hunter')).attemptsUsed).toBe(2)
    expect((await ledger.startExpedition(address, 'vault-breaker')).attemptsUsed).toBe(3)

    await expect(ledger.startExpedition(address, 'gem-runner')).rejects.toMatchObject({
      code: 'DAILY_EXPEDITION_LIMIT_REACHED',
    })

    const status = await ledger.getWalletDailyStatus(address)
    expect(status.expeditionsStarted).toBe(3)
    expect(status.expeditionsRemaining).toBe(0)
  })

  it('does not accept a client-supplied attempts count', async () => {
    const { ledger } = createLedger()
    const address = wallet()
    const started = await ledger.startExpedition(address, 'gem-runner', {
      attemptsUsed: 0,
      dayKey: '1999-01-01',
    } as never)

    expect(started.attemptsUsed).toBe(1)
    expect(started.dayKey).toBe('2026-09-08')
  })

  it('uses a fresh UTC day after midnight and does not trust a previous day_key', async () => {
    const { ledger, setNow } = createLedger(new Date('2026-09-08T23:59:59.000Z'))
    const address = wallet()

    await ledger.startExpedition(address, 'gem-runner')
    await ledger.startExpedition(address, 'gem-runner')
    await ledger.startExpedition(address, 'gem-runner')

    setNow(new Date('2026-09-09T00:00:00.000Z'))
    const nextDay = await ledger.startExpedition(address, 'chest-hunter')

    expect(nextDay.dayKey).toBe('2026-09-09')
    expect(nextDay.attemptsUsed).toBe(1)
    expect(nextDay.attemptsRemaining).toBe(2)
    expect(nextDay.nextResetAt).toBe('2026-09-10T00:00:00.000Z')
  })

  it('consumes the daily attempt when a run fails or is abandoned', async () => {
    const { ledger } = createLedger()
    const address = wallet()

    const failed = await ledger.startExpedition(address, 'gem-runner')
    await ledger.failRun(failed.runId, address)
    const abandoned = await ledger.startExpedition(address, 'chest-hunter')
    await ledger.abandonRun(abandoned.runId, address)

    const status = await ledger.getWalletDailyStatus(address)
    expect(status.expeditionsStarted).toBe(2)
    expect(status.expeditionsRemaining).toBe(1)
  })

  it('applies valid terminal transitions idempotently and never returns to STARTED', async () => {
    const { ledger } = createLedger()
    const address = wallet()
    const started = await ledger.startExpedition(address, 'vault-breaker')

    const first = await ledger.completeRun(started.runId, address)
    const second = await ledger.completeRun(started.runId, address)
    expect(second.status).toBe('COMPLETED')
    expect(second.endedAt).toBe(first.endedAt)

    await expect(ledger.failRun(started.runId, address)).rejects.toMatchObject({
      code: 'INVALID_RUN_TRANSITION',
    })
    await expect(ledger.abandonRun(started.runId, address)).rejects.toMatchObject({
      code: 'INVALID_RUN_TRANSITION',
    })
  })

  it('reserves the first completed run and rejects a second reservation for the same run', async () => {
    const { ledger } = createLedger()
    const address = wallet()
    const started = await ledger.startExpedition(address, 'gem-runner')
    await ledger.completeRun(started.runId, address)

    const first = await ledger.reserveDailyReward(started.runId, address)
    expect(first).toEqual({
      reserved: true,
      reservationNumber: 1,
      remainingSlots: 68,
      totalSlots: 69,
    })

    await expect(ledger.reserveDailyReward(started.runId, address)).rejects.toMatchObject({
      code: 'ALREADY_REWARDED',
    })

    const hunt = await ledger.getDailyHuntStatus()
    expect(hunt.reservedSlots).toBe(1)
  })

  it('allows only one reserved reward per wallet per UTC day', async () => {
    const { ledger } = createLedger()
    const address = wallet()
    const first = await ledger.startExpedition(address, 'gem-runner')
    const second = await ledger.startExpedition(address, 'chest-hunter')
    await ledger.completeRun(first.runId, address)
    await ledger.completeRun(second.runId, address)

    await ledger.reserveDailyReward(first.runId, address)
    await expect(ledger.reserveDailyReward(second.runId, address)).rejects.toMatchObject({
      code: 'ALREADY_REWARDED',
    })

    const status = await ledger.getWalletDailyStatus(address)
    expect(status.rewardAlreadyReserved).toBe(true)
    expect((await ledger.getDailyHuntStatus()).reservedSlots).toBe(1)
  })

  it('assigns reservation 69 then rejects slot 70 as SOLD_OUT', async () => {
    const { ledger } = createLedger()
    await ledger.seedReservedSlots(68)

    const winner = wallet()
    const extra = wallet()
    const winningRun = await ledger.startExpedition(winner, 'gem-runner')
    const extraRun = await ledger.startExpedition(extra, 'gem-runner')
    await ledger.completeRun(winningRun.runId, winner)
    await ledger.completeRun(extraRun.runId, extra)

    const reserved = await ledger.reserveDailyReward(winningRun.runId, winner)
    expect(reserved.reservationNumber).toBe(69)
    expect(reserved.remainingSlots).toBe(0)

    await expect(ledger.reserveDailyReward(extraRun.runId, extra)).rejects.toMatchObject({
      code: 'SOLD_OUT',
    })

    const hunt = await ledger.getDailyHuntStatus()
    expect(hunt.reservedSlots).toBe(69)
    expect(hunt.remainingSlots).toBe(0)
    expect(hunt.totalSlots).toBe(DAILY_REWARD_SLOTS)
  })

  it('lets exactly one concurrent final-slot request win', async () => {
    const { ledger } = createLedger()
    await ledger.seedReservedSlots(68)

    const contestants = await Promise.all(
      Array.from({ length: 8 }, async () => {
        const address = wallet()
        const started = await ledger.startExpedition(address, 'gem-runner')
        await ledger.completeRun(started.runId, address)
        return { address, runId: started.runId }
      }),
    )

    const results = await Promise.allSettled(
      contestants.map(contestant => ledger.reserveDailyReward(contestant.runId, contestant.address)),
    )

    const wins = results.filter(result => result.status === 'fulfilled')
    const soldOut = results.filter(
      result => result.status === 'rejected' && result.reason instanceof LedgerError && result.reason.code === 'SOLD_OUT',
    )

    expect(wins).toHaveLength(1)
    const winner = wins[0]
    if (winner.status !== 'fulfilled') throw new Error('expected a fulfilled reservation')
    expect(winner.value.reservationNumber).toBe(69)
    expect(soldOut).toHaveLength(7)
    expect((await ledger.getDailyHuntStatus()).reservedSlots).toBe(69)
  })

  it('never lets expeditions or reserved slots exceed their limits', async () => {
    const { ledger } = createLedger()
    const address = wallet()
    await ledger.startExpedition(address, 'gem-runner')
    await ledger.startExpedition(address, 'gem-runner')
    await ledger.startExpedition(address, 'gem-runner')
    await expect(ledger.startExpedition(address, 'gem-runner')).rejects.toMatchObject({
      code: 'DAILY_EXPEDITION_LIMIT_REACHED',
    })
    expect((await ledger.getWalletDailyStatus(address)).expeditionsStarted).toBe(DAILY_EXPEDITION_LIMIT)

    await ledger.seedReservedSlots(69)
    const other = wallet()
    const run = await ledger.startExpedition(other, 'chest-hunter')
    await ledger.completeRun(run.runId, other)
    await expect(ledger.reserveDailyReward(run.runId, other)).rejects.toMatchObject({ code: 'SOLD_OUT' })
    expect((await ledger.getDailyHuntStatus()).reservedSlots).toBe(DAILY_REWARD_SLOTS)
  })

  it('rejects unknown and malformed mission types', async () => {
    const { ledger } = createLedger()
    const address = wallet()

    await expect(ledger.startExpedition(address, 'relic-keeper')).rejects.toMatchObject({
      code: 'UNKNOWN_MISSION_TYPE',
    })
    await expect(ledger.startExpedition(address, '')).rejects.toMatchObject({
      code: 'UNKNOWN_MISSION_TYPE',
    })
    await expect(ledger.startExpedition('not-a-wallet', 'gem-runner')).rejects.toMatchObject({
      code: 'INVALID_WALLET',
    })
  })

  it('normalizes Nimiq addresses before persistence', async () => {
    const { ledger } = createLedger()
    const address = wallet()
    const compact = address.replaceAll(' ', '')

    await ledger.startExpedition(compact, 'gem-runner')
    const second = await ledger.startExpedition(address, 'chest-hunter')

    expect(second.attemptsUsed).toBe(2)
    expect((await ledger.getWalletDailyStatus(address)).expeditionsStarted).toBe(2)
  })
})

describe('daily ledger HTTP surface', () => {
  it('returns public hunt status without a wallet', async () => {
    const { ledger } = createLedger()
    await ledger.seedReservedSlots(10)
    const response = await dispatchLedgerHttp(ledger, {
      method: 'GET',
      path: '/api/daily-hunt-status',
    })

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({
      ok: true,
      totalSlots: 69,
      reservedSlots: 10,
      remainingSlots: 59,
      nextResetAt: '2026-09-09T00:00:00.000Z',
      dayKey: '2026-09-08',
    })
  })

  it('rejects unknown missions and oversized bodies', async () => {
    const { ledger } = createLedger()
    const unknown = await dispatchLedgerHttp(ledger, {
      method: 'POST',
      path: '/api/expeditions/start',
      body: { wallet: wallet(), missionType: 'not-real' },
    })
    expect(unknown.status).toBe(400)
    expect(unknown.body).toMatchObject({ ok: false, error: 'UNKNOWN_MISSION_TYPE' })

    const huge = await dispatchLedgerHttp(ledger, {
      method: 'POST',
      path: '/api/expeditions/start',
      rawBody: 'x'.repeat(13_000),
    })
    expect(huge.status).toBe(413)
  })

  it('ignores client-supplied dayKey and reservationNumber', async () => {
    const { ledger } = createLedger()
    const address = wallet()
    const start = await dispatchLedgerHttp(ledger, {
      method: 'POST',
      path: '/api/expeditions/start',
      body: {
        wallet: address,
        missionType: 'gem-runner',
        dayKey: '1999-01-01',
        attemptsUsed: 0,
      },
    })
    expect(start.body).toMatchObject({ ok: true, dayKey: '2026-09-08', attemptsUsed: 1 })

    const runId = (start.body as { runId: string }).runId
    await dispatchLedgerHttp(ledger, {
      method: 'POST',
      path: '/api/expeditions/complete',
      body: { runId, wallet: address },
    })
    const reserved = await dispatchLedgerHttp(ledger, {
      method: 'POST',
      path: '/api/rewards/reserve',
      body: { runId, wallet: address, reservationNumber: 69 },
    })
    expect(reserved.body).toMatchObject({
      ok: true,
      reserved: true,
      reservationNumber: 1,
    })
  })

  it('returns LEDGER_UNAVAILABLE when the backend is not configured', async () => {
    const response = await dispatchLedgerHttp(null, {
      method: 'GET',
      path: '/api/daily-hunt-status',
    })
    expect(response.status).toBe(503)
    expect(response.body).toMatchObject({ ok: false, error: 'LEDGER_UNAVAILABLE' })
  })
})

describe('atomic reservation SQL', () => {
  it('increments reserved_slots in Postgres, never in an unlocked JavaScript read/write', () => {
    const sqlPath = join(dirname(fileURLToPath(import.meta.url)), 'sql', '001_daily_ledger.sql')
    const sql = readFileSync(sqlPath, 'utf8')

    const executable = sql.replace(/--.*$/gm, '')
    expect(executable).toMatch(/reserved_slots\s*=\s*reserved_slots\s*\+\s*1/)
    expect(executable).toMatch(/reserved_slots\s*<\s*69/)
    expect(executable).toMatch(/for update/i)
    expect(executable).toMatch(/enable row level security/i)
    expect(executable).not.toMatch(/payout|treasury|private_key|luna|transfer/i)
  })
})
