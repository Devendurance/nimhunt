import { describe, expect, it } from 'vitest'
import { getMissionObjective } from '../../game/domain/mission.ts'
import { playMissions } from '../../data/play.ts'
import { missionPreviews } from '../../data/marketing.ts'
import { payoutStatusCopy, type ProductPayoutView } from './productPayoutStatus.ts'
import {
  ALREADY_REWARDED_DETAIL,
  ALREADY_REWARDED_TITLE,
  PROOF_LOST_DETAIL,
  TODAY_FULL_DETAIL,
  VERIFY_REJECTED_DETAIL,
} from './productCheckpoint.ts'
import { formatGoblinStatus, isWarningNotice } from './hudStatusView.ts'

function payoutView(status: ProductPayoutView['status']): ProductPayoutView {
  return {
    status,
    payoutId: null,
    claimId: 'claim-1',
    amountLuna: null,
    network: null,
    txHashSafe: null,
    submittedAt: null,
    confirmedAt: null,
  }
}

describe('production UX copy regressions', () => {
  it('states each mission objective in short mobile-friendly words', () => {
    expect(getMissionObjective('gem-runner')).toBe('Collect 6 gems and survive.')
    expect(getMissionObjective('chest-hunter')).toBe('Open 4 chests and survive.')
    expect(getMissionObjective('vault-breaker')).toBe('Find the key. Unlock the gate. Reach the vault.')
    for (const mission of playMissions) {
      expect(mission.objective.length).toBeLessThanOrEqual(60)
    }
  })

  it('keeps the landing mission preview consistent with the real targets', () => {
    const gem = missionPreviews.find(mission => mission.name === 'Gem Runner')
    expect(gem?.objective).toContain('6 gems')
  })

  it('explains the daily payout batch on every reserved state', () => {
    for (const status of ['PENDING', 'PROCESSING', 'FAILED_RETRYABLE'] as const) {
      const copy = payoutStatusCopy(payoutView(status))
      expect(copy.title).toBe('TREASURE RESERVED')
      expect(copy.lines.join(' ')).toContain('Daily rewards are paid in the next payout batch.')
    }
  })

  it('never exposes Luna units, SQL, worker, or lifecycle internals in payout copy', () => {
    const texts = (['PENDING', 'PROCESSING', 'SUBMITTED', 'FAILED_RETRYABLE', 'FAILED_FINAL', 'CONFIRMED'] as const)
      .flatMap(status => {
        const copy = payoutStatusCopy(payoutView(status))
        return [copy.title, ...copy.lines]
      })
      .join(' ')
    expect(texts).not.toMatch(/luna/i)
    expect(texts).not.toMatch(/sql|worker|scheduler|row|table/i)
    expect(texts).not.toMatch(/MISSION_COMPLETE|VERIFIED_ELIGIBLE|VAULT_GAMEPLAY_VERIFIED|FAILED_RETRYABLE|FAILED_FINAL|PROOF_LOST|RUN_SESSION_INVALID/)
  })

  it('explains already-rewarded and sold-out states with room to keep playing', () => {
    expect(ALREADY_REWARDED_TITLE).toBeTruthy()
    expect(ALREADY_REWARDED_DETAIL).toContain('remaining expeditions')
    expect(TODAY_FULL_DETAIL).toContain('keep playing')
    expect(PROOF_LOST_DETAIL).toContain('Starting a new expedition is safe.')
    expect(VERIFY_REJECTED_DETAIL).toContain('Starting a new expedition is safe.')
  })

  it('formats goblin status and detects boulder warnings for the HUD', () => {
    expect(formatGoblinStatus('PATROL')).toBe('Patrol')
    expect(formatGoblinStatus('CHASE')).toBe('Close!')
    expect(formatGoblinStatus('STUNNED')).toBe('Stunned')
    expect(formatGoblinStatus('DEFEATED')).toBe('Defeated')
    expect(isWarningNotice('The ruins tremble — get clear of the marked stone!')).toBe(true)
    expect(isWarningNotice('Crushed by collapsing boulder!')).toBe(true)
    expect(isWarningNotice('Temple Key found.')).toBe(false)
    expect(isWarningNotice('')).toBe(false)
  })
})
