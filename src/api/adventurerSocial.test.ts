import { describe, expect, it } from 'vitest'
import {
  acceptAdventurerRequest,
  fetchAdventurerSocialOverview,
  fetchPublicAdventurerProfileView,
  requestAdventurer,
} from './adventurer.ts'
import {
  ADVENTURER_SOCIAL_ACCEPT_PATH,
  ADVENTURER_SOCIAL_PATH,
  ADVENTURER_SOCIAL_REQUEST_PATH,
} from '../domain/adventurerSocial.ts'

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response
}

const playerId = '00000000-0000-4000-8000-000000000001'
const targetId = '00000000-0000-4000-8000-000000000002'
const requestId = '00000000-0000-4000-8000-000000000003'

const overview = {
  allyCount: 1,
  incomingPendingCount: 1,
  outgoingPendingCount: 0,
  incomingRequests: [{ requestId, playerId: targetId, displayName: 'Ruin Fox', avatarId: 'common-02', createdAt: '2026-09-29T12:00:00.000Z' }],
  allies: [{ playerId: targetId, displayName: 'Ruin Fox', avatarId: 'common-02' }],
}

describe('P4 social client boundary', () => {
  it('parses ally count and authenticated relationship without accepting wallet/private fields', async () => {
    const view = await fetchPublicAdventurerProfileView(playerId, (async () => jsonResponse({
      ok: true,
      profile: { playerId, displayName: 'Endy', avatarId: 'common-01', lifetimeGems: 10, expeditionsCompleted: 2, bestStreak: 2, allyCount: 1 },
      relationship: { state: 'ALLY', requestId: null },
      wallet: 'must-not-be-read',
    })) as typeof fetch)
    expect(view.relationship).toEqual({ state: 'ALLY', requestId: null })
    expect(view.profile.allyCount).toBe(1)
    expect(JSON.stringify(view)).not.toMatch(/wallet|session|challenge|reward|payout/i)
  })

  it('uses the frozen social paths and parses incoming requests first', async () => {
    const paths: string[] = []
    const fetcher = (async (input: string | URL | Request) => {
      paths.push(String(input))
      if (String(input) === ADVENTURER_SOCIAL_PATH) return jsonResponse({ ok: true, overview })
      if (String(input) === ADVENTURER_SOCIAL_REQUEST_PATH) return jsonResponse({ ok: true, requestId })
      return jsonResponse({ ok: true })
    }) as typeof fetch
    await expect(fetchAdventurerSocialOverview(fetcher)).resolves.toEqual(overview)
    await expect(requestAdventurer(targetId, fetcher)).resolves.toBe(requestId)
    await expect(acceptAdventurerRequest(requestId, fetcher)).resolves.toBeUndefined()
    expect(paths).toEqual([ADVENTURER_SOCIAL_PATH, ADVENTURER_SOCIAL_REQUEST_PATH, ADVENTURER_SOCIAL_ACCEPT_PATH])
  })
})
