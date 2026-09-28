import { KeyPair } from '@nimiq/core'
import { describe, expect, it } from 'vitest'
import {
  ADVENTURER_CREATE_CHALLENGE_PATH,
  ADVENTURER_CREATE_PATH,
  ADVENTURER_ME_PATH,
  ADVENTURER_NAME_AVAILABILITY_PATH,
  ADVENTURER_PUBLIC_PATH,
  NIMHUNT_CREATE_ADVENTURER_V1,
  serializeCreateAdventurerPayload,
} from '../../src/domain/adventurer.ts'
import { nimiqSignedMessageHash } from '../expeditions/crypto.ts'
import { dispatchAdventurerHttp } from './http.ts'
import { createAdventurerService } from './identity.ts'
import { createMemoryAdventurerIdentityStore } from './store.ts'
import { createMemoryAdventurerStatsSource } from './stats.ts'
import type { AdventurerService } from './types.ts'
import type { ExpeditionHttpSecurity } from '../expeditions/http.ts'

const SECURITY: ExpeditionHttpSecurity = {
  expectedOrigin: 'https://hunt.example',
  expectedHost: 'hunt.example',
  expectedProtocol: 'https',
  secureCookie: true,
}

function createService(): { service: AdventurerService; keyPair: KeyPair; wallet: string } {
  const keyPair = KeyPair.generate()
  const wallet = keyPair.toAddress().toUserFriendlyAddress()
  const store = createMemoryAdventurerIdentityStore({ now: () => new Date('2026-09-24T12:00:00.000Z') })
  return {
    service: createAdventurerService({
      store,
      stats: createMemoryAdventurerStatsSource(),
      now: () => new Date('2026-09-24T12:00:00.000Z'),
    }),
    keyPair,
    wallet,
  }
}

function headers(overrides: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    origin: SECURITY.expectedOrigin,
    host: SECURITY.expectedHost,
    protocol: SECURITY.expectedProtocol,
    'content-type': 'application/json',
    ...overrides,
  }
}

async function createViaHttp(fixture: ReturnType<typeof createService>) {
  const challengeResponse = await dispatchAdventurerHttp(fixture.service, {
    method: 'POST',
    path: ADVENTURER_CREATE_CHALLENGE_PATH,
    headers: headers(),
    body: { wallet: fixture.wallet },
  }, SECURITY)
  expect(challengeResponse.status).toBe(200)
  expect(JSON.stringify(challengeResponse.body)).not.toContain(fixture.wallet)
  const challenge = challengeResponse.body as { challenge: string; issuedAt: string; expiresAt: string }
  const payload = serializeCreateAdventurerPayload({
    version: NIMHUNT_CREATE_ADVENTURER_V1,
    type: 'CREATE_ADVENTURER',
    wallet: fixture.wallet,
    displayName: 'Endy',
    avatarId: 'adventurer-01',
    challenge: challenge.challenge,
    issuedAt: challenge.issuedAt,
    expiresAt: challenge.expiresAt,
  })
  const created = await dispatchAdventurerHttp(fixture.service, {
    method: 'POST',
    path: ADVENTURER_CREATE_PATH,
    headers: headers(),
    body: {
      payload,
      publicKey: fixture.keyPair.publicKey.toHex(),
      signature: fixture.keyPair.sign(nimiqSignedMessageHash(payload)).toHex(),
    },
  }, SECURITY)
  expect(created.status).toBe(200)
  return created
}

describe('P1 Adventurer HTTP boundary', () => {
  it('creates and restores own profile with a dedicated secure cookie', async () => {
    const fixture = createService()
    const created = await createViaHttp(fixture)
    const cookie = created.headers?.['set-cookie'] ?? ''
    expect(cookie).toContain('nimhunt_adventurer_session=')
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Strict')
    expect(cookie).toContain('Path=/api')
    expect(cookie).toContain('Secure')
    expect(cookie).not.toContain('nimhunt_run_session')
    expect(cookie).not.toContain('nimhunt_wallet_session')

    const own = await dispatchAdventurerHttp(fixture.service, {
      method: 'GET',
      path: ADVENTURER_ME_PATH,
      headers: headers({ origin: undefined, cookie }),
    }, SECURITY)
    expect(own.status).toBe(200)
    expect(own.body).toMatchObject({ ok: true, profile: { displayName: 'Endy', avatarId: 'adventurer-01' } })

    const updated = await dispatchAdventurerHttp(fixture.service, {
      method: 'PATCH',
      path: ADVENTURER_ME_PATH,
      headers: headers({ origin: SECURITY.expectedOrigin, cookie }),
      body: { avatarId: 'adventurer-12' },
    }, SECURITY)
    expect(updated.status).toBe(200)
    expect(updated.body).toMatchObject({ ok: true, profile: { displayName: 'Endy', avatarId: 'adventurer-12' } })
  })

  it('exposes only approved public identity/stat fields and never a wallet', async () => {
    const fixture = createService()
    const created = await createViaHttp(fixture)
    const playerId = ((created.body as { profile: { playerId: string } }).profile).playerId
    const publicResponse = await dispatchAdventurerHttp(fixture.service, {
      method: 'GET',
      path: `${ADVENTURER_PUBLIC_PATH}?playerId=${playerId}`,
      headers: headers({ origin: undefined }),
    }, SECURITY)
    expect(publicResponse.status).toBe(200)
    const publicBody = publicResponse.body as { profile: Record<string, unknown> }
    expect(Object.keys(publicBody.profile).sort()).toEqual(['avatarId', 'bestStreak', 'displayName', 'expeditionsCompleted', 'lifetimeGems', 'playerId'])
    expect(JSON.stringify(publicResponse.body)).not.toContain(fixture.wallet)
    expect(JSON.stringify(publicResponse.body)).not.toMatch(/wallet|session|challenge|reward|payout|treasury|nimEarned/i)
  })

  it('returns advisory name results and rejects invalid/expired sessions', async () => {
    const fixture = createService()
    const availability = await dispatchAdventurerHttp(fixture.service, {
      method: 'GET',
      path: `${ADVENTURER_NAME_AVAILABILITY_PATH}?name=Endy`,
      headers: headers({ origin: undefined }),
    }, SECURITY)
    expect(availability.status).toBe(200)
    expect(availability.body).toMatchObject({ ok: true, available: true, normalizedName: 'endy' })

    const invalid = await dispatchAdventurerHttp(fixture.service, {
      method: 'GET',
      path: `${ADVENTURER_ME_PATH}?wallet=${encodeURIComponent(fixture.wallet)}`,
      headers: headers({ origin: undefined }),
    }, SECURITY)
    expect(invalid.status).toBe(400)
    expect(invalid.body).toEqual({ ok: false, error: 'MALFORMED_REQUEST' })

    const noCookie = await dispatchAdventurerHttp(fixture.service, {
      method: 'GET',
      path: ADVENTURER_ME_PATH,
      headers: headers({ origin: undefined }),
    }, SECURITY)
    expect(noCookie.status).toBe(401)
    expect(noCookie.body).toEqual({ ok: false, error: 'ADVENTURER_SESSION_INVALID' })
  })

  it('fails closed for wrong origin on every mutating identity route', async () => {
    const fixture = createService()
    const response = await dispatchAdventurerHttp(fixture.service, {
      method: 'POST',
      path: ADVENTURER_CREATE_CHALLENGE_PATH,
      headers: headers({ origin: 'https://evil.example' }),
      body: { wallet: fixture.wallet },
    }, SECURITY)
    expect(response.status).toBe(400)
    expect(response.body).toEqual({ ok: false, error: 'MALFORMED_REQUEST' })
  })
})
