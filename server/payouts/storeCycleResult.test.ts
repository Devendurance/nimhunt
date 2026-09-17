import { describe, expect, it } from 'vitest'
import { PayoutError } from './errors.ts'
import { createPayoutStore } from './store.ts'
import type { PayoutRpcClient } from './db.ts'

function snapshotRpc(lastCycleResult: unknown): PayoutRpcClient {
  return {
    async rpc(fn) {
      if (fn !== 'get_payout_operations_status') throw new PayoutError('PAYOUT_UNAVAILABLE')
      return {
        ok: true,
        automation_enabled: false,
        pending_count: 0,
        processing_count: 0,
        submitted_count: 0,
        confirmed_today_count: 0,
        review_count: 0,
        block_count: 0,
        execution_day: '2026-09-17',
        execution_day_committed_luna: '0',
        last_cycle_at: null,
        last_cycle_id: null,
        last_cycle_result: lastCycleResult,
        last_cycle_errors: [],
      }
    },
  }
}

describe('payout operations snapshot cycle result', () => {
  it.each(['COMPLETED', 'DISABLED', 'FAILED'] as const)('accepts %s', async (result) => {
    const store = createPayoutStore(snapshotRpc(result))
    await expect(store.getOperationsSnapshot()).resolves.toMatchObject({ lastCycleResult: result })
  })

  it.each([null, undefined] as const)('normalizes %s to null', async (result) => {
    const store = createPayoutStore(snapshotRpc(result))
    await expect(store.getOperationsSnapshot()).resolves.toMatchObject({ lastCycleResult: null })
  })

  it.each(['PENDING', 'completed', '', 42, {}, []] as const)('fails safely for %s', async (result) => {
    const store = createPayoutStore(snapshotRpc(result))
    await expect(store.getOperationsSnapshot()).rejects.toThrowError(PayoutError)
  })
})
