import { useEffect, useState } from 'react'
import { ExpeditionProofApiError, fetchRewardPayoutStatus } from '../../api/expeditionProof.ts'
import type { RewardPayoutStatus, RewardPayoutStatusResult } from '../../domain/expeditionProof.ts'
import { persistReservedRewardClaim } from './productRunSession.ts'
import { PAYOUT_POLL_MS, type ProductPayoutView } from './productPayoutStatus.ts'

const OPEN_STATUSES = new Set<RewardPayoutStatus | 'PENDING'>([
  'PENDING',
  'PROCESSING',
  'SUBMITTED',
  'FAILED_RETRYABLE',
])

export function useProductPayoutStatus(options: {
  readonly enabled: boolean
  readonly claimId: string | null
  readonly recoverFromSession?: boolean
  readonly unavailableAs?: 'pending' | 'hidden'
}): ProductPayoutView | null {
  const recoverFromSession = options.recoverFromSession === true
  const unavailableAs = options.unavailableAs ?? 'pending'
  const claimId = options.enabled ? options.claimId : null
  const enabled = options.enabled && (Boolean(claimId) || recoverFromSession)
  const [view, setView] = useState<{ readonly key: string; readonly value: ProductPayoutView | null } | null>(null)
  const key = `${claimId ?? ''}:${recoverFromSession ? '1' : '0'}`

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    let timer: ReturnType<typeof setInterval> | null = null

    const stop = () => {
      if (timer) {
        clearInterval(timer)
        timer = null
      }
    }

    const load = async (): Promise<RewardPayoutStatus | 'PENDING' | 'HIDDEN'> => {
      try {
        const result = await readPayout(claimId, recoverFromSession)
        if (cancelled) return 'HIDDEN'
        persistReservedRewardClaim(result.claimId)
        const next = toView(result)
        setView({ key, value: next })
        return next.status
      } catch (error) {
        if (cancelled) return 'HIDDEN'
        if (unavailableAs === 'hidden' || isUnavailable(error)) {
          setView({ key, value: null })
          return 'HIDDEN'
        }
        setView({ key, value: pendingView(claimId) })
        return 'PENDING'
      }
    }

    void load().then(status => {
      if (cancelled || !OPEN_STATUSES.has(status as RewardPayoutStatus)) return
      timer = setInterval(() => {
        void load().then(next => {
          if (next === 'CONFIRMED' || next === 'FAILED_FINAL' || next === 'HIDDEN') stop()
        })
      }, PAYOUT_POLL_MS)
    })

    return () => {
      cancelled = true
      stop()
    }
  }, [claimId, enabled, key, recoverFromSession, unavailableAs])

  if (!enabled) return null
  if (view?.key === key) return view.value
  return unavailableAs === 'hidden' ? null : pendingView(claimId)
}

async function readPayout(claimId: string | null, recoverFromSession: boolean): Promise<RewardPayoutStatusResult> {
  if (claimId) {
    try {
      return await fetchRewardPayoutStatus(claimId)
    } catch (error) {
      if (recoverFromSession && isUnavailable(error)) return fetchRewardPayoutStatus(null)
      throw error
    }
  }
  return fetchRewardPayoutStatus(null)
}

function toView(result: RewardPayoutStatusResult): ProductPayoutView {
  return {
    status: result.payout?.status ?? 'PENDING',
    payoutId: result.payout?.payoutId ?? null,
    claimId: result.claimId,
    amountLuna: result.payout?.amountLuna ?? null,
    network: result.payout?.network ?? null,
    txHashSafe: result.payout?.txHashSafe ?? null,
    submittedAt: result.payout?.submittedAt ?? null,
    confirmedAt: result.payout?.confirmedAt ?? null,
  }
}

function pendingView(claimId: string | null): ProductPayoutView {
  return {
    status: 'PENDING',
    payoutId: null,
    claimId,
    amountLuna: null,
    network: null,
    txHashSafe: null,
    submittedAt: null,
    confirmedAt: null,
  }
}

function isUnavailable(error: unknown): boolean {
  return error instanceof ExpeditionProofApiError
    && (error.code === 'CLAIM_NOT_FOUND' || error.code === 'RUN_SESSION_INVALID' || error.code === 'CLAIM_NOT_ELIGIBLE')
}
