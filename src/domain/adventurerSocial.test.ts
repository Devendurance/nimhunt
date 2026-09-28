import { describe, expect, it } from 'vitest'
import {
  parseAdventurerRelationship,
  parseAdventurerSocialOverview,
} from './adventurerSocial.ts'

describe('P4 social domain contract', () => {
  it('accepts only compact player identity fields and the approved relationship states', () => {
    const overview = parseAdventurerSocialOverview({
      allyCount: 1,
      incomingPendingCount: 1,
      outgoingPendingCount: 0,
      incomingRequests: [{
        requestId: '00000000-0000-4000-8000-000000000010',
        playerId: '00000000-0000-4000-8000-000000000011',
        displayName: 'Endy',
        avatarId: 'common-01',
        createdAt: '2026-09-29T12:00:00.000Z',
      }],
      allies: [{ playerId: '00000000-0000-4000-8000-000000000012', displayName: 'Ruin Fox', avatarId: 'common-02' }],
    })
    expect(overview?.allyCount).toBe(1)
    expect(JSON.stringify(overview)).not.toMatch(/wallet|session|challenge|reward|payout|blocker|blocked/i)
    expect(parseAdventurerRelationship({ state: 'INCOMING_PENDING', requestId: '00000000-0000-4000-8000-000000000010' })).toEqual({ state: 'INCOMING_PENDING', requestId: '00000000-0000-4000-8000-000000000010' })
    expect(parseAdventurerRelationship({ state: 'UNAVAILABLE', requestId: null })).toEqual({ state: 'UNAVAILABLE', requestId: null })
  })

  it('rejects malformed social responses and unknown relationship states', () => {
    expect(parseAdventurerSocialOverview({ allyCount: 101, incomingPendingCount: 0, outgoingPendingCount: 0, incomingRequests: [], allies: [], wallet: 'NQ' })).toBeNull()
    expect(parseAdventurerRelationship({ state: 'BLOCKED_BY_THEM', requestId: null })).toBeNull()
  })
})
