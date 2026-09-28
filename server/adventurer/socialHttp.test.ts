import { describe, expect, it } from 'vitest'
import { dispatchAdventurerHttp } from './http.ts'
import { AdventurerError } from './errors.ts'
import type { AdventurerService } from './types.ts'
import type { AdventurerSocialService } from './socialTypes.ts'
import type { ExpeditionHttpSecurity } from '../expeditions/http.ts'
import type { AdventurerProfile } from '../../src/domain/adventurer.ts'
import { ADVENTURER_PUBLIC_PATH } from '../../src/domain/adventurer.ts'
import { ADVENTURER_SOCIAL_PATH, ADVENTURER_SOCIAL_REQUEST_PATH } from '../../src/domain/adventurerSocial.ts'

const SECURITY: ExpeditionHttpSecurity = {
  expectedOrigin: 'https://hunt.example',
  expectedHost: 'hunt.example',
  expectedProtocol: 'https',
  secureCookie: true,
}
const viewerId = '00000000-0000-4000-8000-000000000001'
const targetId = '00000000-0000-4000-8000-000000000002'
const session = {
  sessionHash: 'hash', playerId: viewerId, wallet: 'NQ32 PRIVATE',
  createdAt: '2026-09-29T12:00:00.000Z', expiresAt: '2026-10-29T12:00:00.000Z', revokedAt: null,
}
const profile: AdventurerProfile = {
  playerId: targetId,
  displayName: 'Ruin Fox',
  avatarId: 'common-02',
  displayNameChangedAt: '2026-09-29T12:00:00.000Z',
  createdAt: '2026-09-29T12:00:00.000Z',
  updatedAt: '2026-09-29T12:00:00.000Z',
  stats: { lifetimeGems: 8, expeditionsCompleted: 2, bestStreak: 1 },
}

function headers(cookie?: string): Record<string, string | undefined> {
  return { host: SECURITY.expectedHost, protocol: SECURITY.expectedProtocol, origin: SECURITY.expectedOrigin, ...(cookie ? { cookie } : {}) }
}

function identity(): AdventurerService {
  return {
    getPublicProfile: async () => ({ playerId: profile.playerId, displayName: profile.displayName, avatarId: profile.avatarId, lifetimeGems: 8, expeditionsCompleted: 2, bestStreak: 1, allyCount: 0 }),
    authenticateSession: async (raw: string) => {
      if (raw !== 'valid-session') throw new AdventurerError('ADVENTURER_SESSION_INVALID')
      return session
    },
  } as unknown as AdventurerService
}

function social(): AdventurerSocialService {
  return {
    getAllyCount: async () => 3,
    getRelationship: async () => ({ state: 'NONE', requestId: null }),
    getOverview: async () => ({ allyCount: 3, incomingPendingCount: 1, outgoingPendingCount: 0, incomingRequests: [], allies: [] }),
    request: async () => ({ requestId: '00000000-0000-4000-8000-000000000003' }),
    accept: async () => {}, decline: async () => {}, cancel: async () => {}, remove: async () => {}, block: async () => {}, unblock: async () => {},
  }
}

describe('P4 social HTTP boundary', () => {
  it('adds only allyCount and a generic viewer relationship to public profiles', async () => {
    const response = await dispatchAdventurerHttp(identity(), {
      method: 'GET', path: `${ADVENTURER_PUBLIC_PATH}?playerId=${targetId}`, headers: headers('nimhunt_adventurer_session=valid-session'),
    }, SECURITY, social())
    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ profile: { allyCount: 3 }, relationship: { state: 'NONE', requestId: null } })
    expect(JSON.stringify(response.body)).not.toMatch(/wallet|session|challenge|reward|payout|block/i)
  })

  it('requires the existing Adventurer session for social reads and mutations', async () => {
    const overview = await dispatchAdventurerHttp(identity(), { method: 'GET', path: ADVENTURER_SOCIAL_PATH, headers: headers() }, SECURITY, social())
    expect(overview.status).toBe(401)
    const request = await dispatchAdventurerHttp(identity(), { method: 'POST', path: ADVENTURER_SOCIAL_REQUEST_PATH, headers: { ...headers(), 'content-type': 'application/json' }, body: { targetPlayerId: targetId } }, SECURITY, social())
    expect(request.status).toBe(401)
  })

  it('does not reveal an expired social session from public profile reads', async () => {
    const response = await dispatchAdventurerHttp(identity(), { method: 'GET', path: `${ADVENTURER_PUBLIC_PATH}?playerId=${targetId}`, headers: headers('nimhunt_adventurer_session=expired') }, SECURITY, social())
    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ profile: { allyCount: 3 } })
    expect(response.body).not.toHaveProperty('relationship')
  })
})
