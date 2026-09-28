import { describe, expect, it } from 'vitest'
import {
  createAdventurerProfile,
  fetchAdventurerNameAvailability,
  fetchPublicAdventurerProfile,
  requestAdventurerCreationChallenge,
  updateAdventurerAvatar,
} from './adventurer.ts'
import { ADVENTURER_CREATE_CHALLENGE_PATH, ADVENTURER_ME_PATH, ADVENTURER_PUBLIC_PATH } from '../domain/adventurer.ts'

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response
}

const profile = {
  playerId: '00000000-0000-4000-8000-000000000001',
  displayName: 'Endy',
  avatarId: 'common-01',
  displayNameChangedAt: '2026-09-24T12:00:00.000Z',
  createdAt: '2026-09-24T12:00:00.000Z',
  updatedAt: '2026-09-24T12:00:00.000Z',
  stats: { lifetimeGems: 4, expeditionsCompleted: 1, bestStreak: 1 },
}

describe('Adventurer client boundary', () => {
  it('parses wrapped challenge responses without weakening the exact challenge contract', async () => {
    const challenge = await requestAdventurerCreationChallenge('NQTEST', (async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe(ADVENTURER_CREATE_CHALLENGE_PATH)
      expect(init?.credentials).toBe('same-origin')
      return jsonResponse({ ok: true, purpose: 'CREATE', challenge: 'abc', issuedAt: '2026-09-24T12:00:00.000Z', expiresAt: '2026-09-24T12:05:00.000Z' })
    }) as typeof fetch)
    expect(challenge.purpose).toBe('CREATE')
    expect(challenge.challenge).toBe('abc')
  })

  it('keeps profile creation signing payloads and avatar edits server-shaped', async () => {
    const requests: Array<{ path: string; method: string; body: string | undefined }> = []
    const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({ path: String(input), method: init?.method ?? 'GET', body: init?.body as string | undefined })
      if (init?.method === 'PATCH') return jsonResponse({ ok: true, profile: { ...profile, avatarId: 'common-05' } })
      return jsonResponse({ ok: true, profile, session: { playerId: profile.playerId, createdAt: profile.createdAt, expiresAt: '2026-10-24T12:00:00.000Z' } })
    }) as typeof fetch

    const created = await createAdventurerProfile({ payload: '{"type":"CREATE_ADVENTURER"}', publicKey: 'key', signature: 'sig' }, fetcher)
    const updated = await updateAdventurerAvatar('common-05', fetcher)
    expect(created.profile.displayName).toBe('Endy')
    expect(updated.avatarId).toBe('common-05')
    expect(requests.map(request => [request.path, request.method])).toEqual([
      [ADVENTURER_CREATE_CHALLENGE_PATH.replace('/challenge', ''), 'POST'],
      [ADVENTURER_ME_PATH, 'PATCH'],
    ])
  })

  it('loads only the approved public Adventurer profile fields', async () => {
    const publicProfile = await fetchPublicAdventurerProfile(profile.playerId, (async (input: string | URL | Request) => {
      expect(String(input)).toBe(`${ADVENTURER_PUBLIC_PATH}?playerId=${profile.playerId}`)
      return jsonResponse({ ok: true, profile: {
        playerId: profile.playerId,
        displayName: profile.displayName,
        avatarId: profile.avatarId,
        lifetimeGems: 42,
        expeditionsCompleted: 7,
        bestStreak: 3,
      } })
    }) as typeof fetch)
    expect(publicProfile).toEqual({
      playerId: profile.playerId,
      displayName: 'Endy',
      avatarId: 'common-01',
      lifetimeGems: 42,
      expeditionsCompleted: 7,
      bestStreak: 3,
    })
    expect(JSON.stringify(publicProfile)).not.toMatch(/wallet|reward|claim|payout|session|challenge|nim/i)
  })

  it('fails safely for an unknown public player', async () => {
    await expect(fetchPublicAdventurerProfile('00000000-0000-4000-8000-000000000099', (async () => jsonResponse({ ok: false, error: 'PROFILE_NOT_FOUND' }, 404)) as typeof fetch))
      .rejects.toMatchObject({ code: 'PROFILE_NOT_FOUND' })
  })

  it('maps advisory name availability and preserves server errors', async () => {
    await expect(fetchAdventurerNameAvailability('Endy', (async () => jsonResponse({ ok: false, error: 'DISPLAY_NAME_RESERVED' }, 400)) as typeof fetch))
      .rejects.toMatchObject({ code: 'DISPLAY_NAME_RESERVED' })
  })
})
