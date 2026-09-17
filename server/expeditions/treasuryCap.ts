import { DAILY_REWARD_SLOTS } from '../../src/domain/dailyLedger.ts'
import { ProofError } from './errors.ts'

export function assertRewardTreasuryCap(
  env: Record<string, string | undefined> = process.env,
): void {
  const amount = parseLuna(env.NIMHUNT_REWARD_AMOUNT_LUNA)
  const maxDaily = parseLuna(env.NIMHUNT_MAX_DAILY_REWARD_LUNA)
  if (maxDaily === null) return
  if (amount === null) throw new ProofError('REWARD_UNAVAILABLE')
  if (amount * BigInt(DAILY_REWARD_SLOTS) > maxDaily) throw new ProofError('REWARD_UNAVAILABLE')
}

function parseLuna(value: string | undefined): bigint | null {
  const raw = value?.trim()
  if (!raw) return null
  if (!/^[0-9]+$/.test(raw)) throw new ProofError('REWARD_UNAVAILABLE')
  const amount = BigInt(raw)
  if (amount <= 0n) throw new ProofError('REWARD_UNAVAILABLE')
  return amount
}
