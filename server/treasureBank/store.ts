import type { SupabaseClient } from '@supabase/supabase-js'
import { TreasureBankError } from './service.js'
import type { TreasureBankAssessmentRow, TreasureBankClaimRow, TreasureBankPayoutRow } from './service.js'

export type WalletTreasureRows = {
  readonly claims: readonly TreasureBankClaimRow[]
  readonly payouts: readonly TreasureBankPayoutRow[]
  readonly assessments: readonly TreasureBankAssessmentRow[]
}

export type TreasureBankSource = {
  loadWalletTreasure(wallet: string): Promise<WalletTreasureRows>
}

const MAX_WALLET_REWARDS = 365

export function createMemoryTreasureBankSource(seed: WalletTreasureRows = { claims: [], payouts: [], assessments: [] }): TreasureBankSource & {
  seedClaim(claim: TreasureBankClaimRow): void
  seedPayout(payout: TreasureBankPayoutRow): void
  seedAssessment(assessment: TreasureBankAssessmentRow): void
} {
  const claims: TreasureBankClaimRow[] = [...seed.claims]
  const payouts: TreasureBankPayoutRow[] = [...seed.payouts]
  const assessments: TreasureBankAssessmentRow[] = [...seed.assessments]
  return {
    seedClaim(claim) {
      claims.push(claim)
    },
    seedPayout(payout) {
      payouts.push(payout)
    },
    seedAssessment(assessment) {
      assessments.push(assessment)
    },
    async loadWalletTreasure(wallet) {
      const walletClaims = claims.filter(claim => claim.wallet === wallet)
      const claimIds = new Set(walletClaims.map(claim => claim.claimId))
      const runIds = new Set(walletClaims.map(claim => claim.runId))
      return {
        claims: walletClaims,
        payouts: payouts.filter(payout => claimIds.has(payout.claimId)),
        assessments: assessments.filter(assessment => runIds.has(assessment.runId)),
      }
    },
  }
}

export function createSupabaseTreasureBankSource(client: SupabaseClient): TreasureBankSource {
  return {
    async loadWalletTreasure(wallet: string): Promise<WalletTreasureRows> {
      if (!wallet || wallet.length > 80) throw new TreasureBankError('TREASURE_UNAVAILABLE')
      const { data: claimRows, error: claimError } = await client
        .from('reward_claims')
        .select('claim_id,run_id,wallet,mission,day_key,status,finalized_at,created_at')
        .eq('wallet', wallet)
        .eq('status', 'RESERVED')
        .order('day_key', { ascending: false })
        .limit(MAX_WALLET_REWARDS)
      if (claimError) throw new TreasureBankError('TREASURE_UNAVAILABLE')
      const claims: TreasureBankClaimRow[] = (Array.isArray(claimRows) ? claimRows : []).map(row => ({
        claimId: String((row as Record<string, unknown>).claim_id ?? ''),
        runId: String((row as Record<string, unknown>).run_id ?? ''),
        wallet: String((row as Record<string, unknown>).wallet ?? ''),
        mission: String((row as Record<string, unknown>).mission ?? ''),
        dayKey: String((row as Record<string, unknown>).day_key ?? '').slice(0, 10),
        status: String((row as Record<string, unknown>).status ?? ''),
        finalizedAt: (row as Record<string, unknown>).finalized_at == null
          ? null
          : new Date(String((row as Record<string, unknown>).finalized_at)).toISOString(),
        createdAt: new Date(String((row as Record<string, unknown>).created_at ?? new Date().toISOString())).toISOString(),
      })).filter(claim => claim.claimId && claim.runId && claim.wallet === wallet)

      const { data: payoutRows, error: payoutError } = await client
        .from('reward_payouts')
        .select('claim_id,status,amount_luna,tx_hash')
        .eq('wallet', wallet)
        .limit(MAX_WALLET_REWARDS)
      if (payoutError) throw new TreasureBankError('TREASURE_UNAVAILABLE')
      const claimIds = new Set(claims.map(claim => claim.claimId))
      const payouts: TreasureBankPayoutRow[] = (Array.isArray(payoutRows) ? payoutRows : [])
        .map(row => ({
          claimId: String((row as Record<string, unknown>).claim_id ?? ''),
          status: String((row as Record<string, unknown>).status ?? ''),
          amountLuna: String((row as Record<string, unknown>).amount_luna ?? '0'),
          txHash: (row as Record<string, unknown>).tx_hash == null ? null : String((row as Record<string, unknown>).tx_hash),
        }))
        .filter(payout => claimIds.has(payout.claimId))

      const runIds = [...new Set(claims.map(claim => claim.runId))]
      let assessments: TreasureBankAssessmentRow[] = []
      if (runIds.length > 0) {
        const { data: assessmentRows, error: assessmentError } = await client
          .from('reward_risk_assessments')
          .select('run_id,result')
          .in('run_id', runIds)
        if (assessmentError) throw new TreasureBankError('TREASURE_UNAVAILABLE')
        assessments = (Array.isArray(assessmentRows) ? assessmentRows : []).map(row => ({
          runId: String((row as Record<string, unknown>).run_id ?? ''),
          result: String((row as Record<string, unknown>).result ?? ''),
        })).filter(assessment => runIds.includes(assessment.runId))
      }

      return { claims, payouts, assessments }
    },
  }
}

export async function createDefaultTreasureBankSource(
  runtime: { readonly backend: 'memory' | 'postgres' | 'unavailable' },
  env: Record<string, string | undefined> = process.env,
): Promise<TreasureBankSource | null> {
  if (runtime.backend === 'memory') return createMemoryTreasureBankSource()
  if (runtime.backend !== 'postgres') return null
  const { readServerSupabaseConfig, createSupabaseAdminClient } = await import('../ledger/config.js')
  const config = readServerSupabaseConfig(env)
  if (!config) return null
  return createSupabaseTreasureBankSource(createSupabaseAdminClient(config))
}
