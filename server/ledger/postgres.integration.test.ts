import { KeyPair } from '@nimiq/core'
import { describe, expect, it } from 'vitest'
import { loadEnv } from 'vite'
import { createPostgresDailyLedger } from './postgresLedger.ts'
import { createSupabaseAdminClient, readServerSupabaseConfig } from './config.ts'
import { LedgerError } from './errors.ts'

const env = loadEnv('test', process.cwd(), '')
const config = readServerSupabaseConfig({
  SUPABASE_URL: env.SUPABASE_URL || process.env.SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY,
})
const integrationEnabled = env.NIMHUNT_LEDGER_INTEGRATION === '1' || process.env.NIMHUNT_LEDGER_INTEGRATION === '1'

describe.skipIf(!config || !integrationEnabled)('postgres daily ledger integration', () => {
  it('gives exactly one winner for the final reward slot', async () => {
    const ledger = createPostgresDailyLedger(createSupabaseAdminClient(config!))
    await ledger.seedReservedSlots(68)

    const contestants = await Promise.all(
      Array.from({ length: 4 }, async () => {
        const address = KeyPair.generate().toAddress().toUserFriendlyAddress()
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
    expect(soldOut.length).toBeGreaterThanOrEqual(1)
    expect((await ledger.getDailyHuntStatus()).reservedSlots).toBe(69)
  })
})
