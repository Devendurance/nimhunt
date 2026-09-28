import { KeyPair } from '@nimiq/core'
import { describe, expect, it } from 'vitest'
import {
  NIMHUNT_ADVENTURER_SESSION_V1,
  NIMHUNT_CREATE_ADVENTURER_V1,
  serializeAdventurerSessionPayload,
  serializeCreateAdventurerPayload,
  type CreateAdventurerPayload,
} from '../../src/domain/adventurer.ts'
import { nimiqSignedMessageHash } from '../expeditions/crypto.ts'
import { AdventurerError } from './errors.ts'
import { createAdventurerService } from './identity.ts'
import { createMemoryAdventurerIdentityStore } from './store.ts'
import { createMemoryAdventurerStatsSource } from './stats.ts'
import type { AdventurerService } from './types.ts'

const AVATAR = 'adventurer-01'
const NOW = new Date('2026-09-24T12:00:00.000Z')

type Fixture = {
  readonly service: AdventurerService
  readonly keyPair: KeyPair
  readonly wallet: string
  readonly stats: ReturnType<typeof createMemoryAdventurerStatsSource>
  readonly setNow: (value: Date) => void
}

function createFixture(): Fixture {
  let current = NOW
  const keyPair = KeyPair.generate()
  const wallet = keyPair.toAddress().toUserFriendlyAddress()
  const store = createMemoryAdventurerIdentityStore({ now: () => current })
  const stats = createMemoryAdventurerStatsSource()
  return {
    service: createAdventurerService({ store, stats, now: () => current }),
    stats,
    keyPair,
    wallet,
    setNow(value) {
      current = value
    },
  }
}

async function signedCreate(fixture: Fixture, displayName = 'Endy', avatarId = AVATAR) {
  const challenge = await fixture.service.issueCreationChallenge(fixture.wallet)
  const payload: CreateAdventurerPayload = {
    version: NIMHUNT_CREATE_ADVENTURER_V1,
    type: 'CREATE_ADVENTURER',
    wallet: fixture.wallet,
    displayName,
    avatarId,
    challenge: challenge.challenge,
    issuedAt: challenge.issuedAt,
    expiresAt: challenge.expiresAt,
  }
  const canonical = serializeCreateAdventurerPayload(payload)
  return {
    challenge,
    payload: canonical,
    publicKey: fixture.keyPair.publicKey.toHex(),
    signature: fixture.keyPair.sign(nimiqSignedMessageHash(canonical)).toHex(),
  }
}

async function createProfile(fixture: Fixture, displayName = 'Endy') {
  return fixture.service.createProfile(await signedCreate(fixture, displayName))
}

async function expectCode(action: () => Promise<unknown>, code: AdventurerError['code']) {
  await expect(action()).rejects.toMatchObject({ code })
}

describe('P1 Adventurer identity auth', () => {
  it('creates a profile, derives a stable player ID, and issues a 30-day opaque session', async () => {
    const fixture = createFixture()
    const created = await createProfile(fixture)
    expect(created.profile).toMatchObject({ displayName: 'Endy', avatarId: AVATAR })
    expect(created.profile.playerId).toMatch(/^[0-9a-f-]{36}$/)
    expect(created.profile.stats).toEqual({ lifetimeGems: 0, expeditionsCompleted: 0, bestStreak: 0 })
    expect(created.session.playerId).toBe(created.profile.playerId)
    expect(Date.parse(created.session.expiresAt) - Date.parse(created.session.createdAt)).toBe(30 * 24 * 60 * 60 * 1_000)
    expect(created.sessionCapability).not.toBe(created.session.playerId)
  })

  it('recovers historical verified stats immediately when a legacy wallet claims a profile', async () => {
    const fixture = createFixture()
    fixture.stats.seedRun({
      runId: 'legacy-completed',
      wallet: fixture.wallet,
      mission: 'gem-runner',
      dayKey: '2026-09-20',
      startedAt: '2026-09-20T10:00:00.000Z',
      endedAt: '2026-09-20T10:05:00.000Z',
      gameplayStartedAt: '2026-09-20T10:00:01.000Z',
      verified: {
        outcome: 'VERIFIED_ELIGIBLE',
        gemsCollected: 7,
        chestsOpened: 0,
        objectiveReached: false,
        missionSatisfied: true,
        finalHp: 10,
      },
      vaultSealed: false,
    })
    const created = await createProfile(fixture, 'Legacy')
    expect(created.profile.stats).toEqual({ lifetimeGems: 7, expeditionsCompleted: 1, bestStreak: 1 })
  })

  it('rejects wrong-wallet signatures and altered payloads without consuming the challenge', async () => {
    const fixture = createFixture()
    const signed = await signedCreate(fixture)
    const other = KeyPair.generate()
    await expectCode(() => fixture.service.createProfile({ ...signed, publicKey: other.publicKey.toHex(), signature: other.sign(nimiqSignedMessageHash(signed.payload)).toHex() }), 'SIGNATURE_INVALID')
    await expectCode(() => fixture.service.createProfile({ ...signed, payload: signed.payload.replace('Endy', 'Other') }), 'SIGNATURE_INVALID')
    const created = await fixture.service.createProfile(signed)
    expect(created.profile.displayName).toBe('Endy')
  })

  it('rejects expired and replayed challenges', async () => {
    const fixture = createFixture()
    const signed = await signedCreate(fixture)
    fixture.setNow(new Date('2026-09-24T12:06:00.000Z'))
    await expectCode(() => fixture.service.createProfile(signed), 'CHALLENGE_EXPIRED')

    const second = createFixture()
    const valid = await signedCreate(second)
    await second.service.createProfile(valid)
    await expectCode(() => second.service.createProfile(valid), 'CHALLENGE_INVALID')
  })

  it('enforces reserved, abusive, malformed, and unavailable avatar names server-side', async () => {
    const names = [
      ['NimHunt', 'DISPLAY_NAME_RESERVED'],
      ['bad  name', 'DISPLAY_NAME_INVALID'],
      [' Endy', 'DISPLAY_NAME_INVALID'],
      ['ab', 'DISPLAY_NAME_INVALID'],
      ['shitcoin', 'DISPLAY_NAME_INVALID'],
    ] as const
    for (const [name, code] of names) {
      const fixture = createFixture()
      await expectCode(() => createProfile(fixture, name), code)
    }
    const fixture = createFixture()
    const invalidAvatar = await signedCreate(fixture, 'Endy', 'unknown-avatar')
    await expectCode(() => fixture.service.createProfile(invalidAvatar), 'AVATAR_UNAVAILABLE')
  })

  it('makes Endy, endy, and ENDY one database-equivalent name and has one winner under concurrency', async () => {
    let current = NOW
    const store = createMemoryAdventurerIdentityStore({ now: () => current })
    const stats = createMemoryAdventurerStatsSource()
    const service = createAdventurerService({ store, stats, now: () => current })
    const firstKeyPair = KeyPair.generate()
    const secondKeyPair = KeyPair.generate()
    const first = { service, stats, keyPair: firstKeyPair, wallet: firstKeyPair.toAddress().toUserFriendlyAddress(), setNow: (value: Date) => { current = value } }
    const second = { service, stats, keyPair: secondKeyPair, wallet: secondKeyPair.toAddress().toUserFriendlyAddress(), setNow: (value: Date) => { current = value } }
    const [left, right] = await Promise.allSettled([
      createProfile(first, 'Endy'),
      createProfile(second, 'endy'),
    ])
    const fulfilled = [left, right].filter(result => result.status === 'fulfilled')
    const rejected = [left, right].filter(result => result.status === 'rejected')
    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({ code: 'DISPLAY_NAME_TAKEN' })

    const firstOwns = (await first.service.getProfileForWallet(first.wallet)) !== null
    const secondOwns = (await second.service.getProfileForWallet(second.wallet)) !== null
    expect(firstOwns !== secondOwns).toBe(true)
  })

  it('prevents a second Adventurer for an already-owned wallet', async () => {
    const fixture = createFixture()
    await createProfile(fixture)
    await expectCode(() => fixture.service.issueCreationChallenge(fixture.wallet), 'PROFILE_ALREADY_EXISTS')
  })

  it('restores a returning Adventurer session without repurposing another session type', async () => {
    const fixture = createFixture()
    const created = await createProfile(fixture)
    const challenge = await fixture.service.issueSessionChallenge(fixture.wallet)
    const payload = serializeAdventurerSessionPayload({
      version: NIMHUNT_ADVENTURER_SESSION_V1,
      type: 'ADVENTURER_SESSION',
      wallet: fixture.wallet,
      challenge: challenge.challenge,
      issuedAt: challenge.issuedAt,
      expiresAt: challenge.expiresAt,
    })
    const restored = await fixture.service.createSession({
      payload,
      publicKey: fixture.keyPair.publicKey.toHex(),
      signature: fixture.keyPair.sign(nimiqSignedMessageHash(payload)).toHex(),
    })
    expect(restored.profile.playerId).toBe(created.profile.playerId)
    expect((await fixture.service.authenticateSession(restored.sessionCapability)).playerId).toBe(created.profile.playerId)
    fixture.setNow(new Date('2026-10-25T12:00:00.000Z'))
    await expectCode(() => fixture.service.authenticateSession(restored.sessionCapability), 'ADVENTURER_SESSION_INVALID')
    await expectCode(() => fixture.service.authenticateSession('not-a-session'), 'ADVENTURER_SESSION_INVALID')
  })
})
