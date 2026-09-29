import { KeyPair } from '@nimiq/core'
import { describe, expect, it } from 'vitest'
import {
  NIMHUNT_CREATE_ADVENTURER_V1,
  NIMHUNT_RENAME_ADVENTURER_V1,
  serializeCreateAdventurerPayload,
  serializeRenameAdventurerPayload,
  type CreateAdventurerPayload,
  type RenameAdventurerPayload,
} from '../../src/domain/adventurer.ts'
import { nimiqSignedMessageHash } from '../expeditions/crypto.ts'
import { createAdventurerService } from './identity.ts'
import { createMemoryAdventurerIdentityStore } from './store.ts'
import { createMemoryAdventurerStatsSource } from './stats.ts'
import type { AdventurerService, StoredAdventurerSession } from './types.ts'

const NOW = new Date('2026-09-24T12:00:00.000Z')
const COOLDOWN = 30 * 24 * 60 * 60 * 1_000

type Fixture = {
  readonly service: AdventurerService
  readonly keyPair: KeyPair
  readonly wallet: string
  readonly store: ReturnType<typeof createMemoryAdventurerIdentityStore>
  readonly setNow: (now: Date) => void
}

type Clock = { current: Date }

function fixture(sharedStore?: ReturnType<typeof createMemoryAdventurerIdentityStore>, sharedClock?: Clock): Fixture {
  const clock = sharedClock ?? { current: NOW }
  const keyPair = KeyPair.generate()
  const wallet = keyPair.toAddress().toUserFriendlyAddress()
  const store = sharedStore ?? createMemoryAdventurerIdentityStore({ now: () => clock.current })
  return {
    service: createAdventurerService({ store, stats: createMemoryAdventurerStatsSource(), now: () => clock.current }),
    keyPair,
    wallet,
    store,
    setNow: value => { clock.current = value },
  }
}

async function create(fixture: Fixture, displayName: string) {
  const challenge = await fixture.service.issueCreationChallenge(fixture.wallet)
  const payload = serializeCreateAdventurerPayload({
    version: NIMHUNT_CREATE_ADVENTURER_V1,
    type: 'CREATE_ADVENTURER',
    wallet: fixture.wallet,
    displayName,
    avatarId: 'common-01',
    challenge: challenge.challenge,
    issuedAt: challenge.issuedAt,
    expiresAt: challenge.expiresAt,
  } satisfies CreateAdventurerPayload)
  return fixture.service.createProfile({
    payload,
    publicKey: fixture.keyPair.publicKey.toHex(),
    signature: fixture.keyPair.sign(nimiqSignedMessageHash(payload)).toHex(),
  })
}

async function signedRename(
  fixture: Fixture,
  session: StoredAdventurerSession,
  newName: string,
  keyPair = fixture.keyPair,
  currentName = 'Endy',
) {
  const challenge = await fixture.service.issueRenameChallenge(session)
  const payload = serializeRenameAdventurerPayload({
    version: NIMHUNT_RENAME_ADVENTURER_V1,
    type: 'RENAME_ADVENTURER',
    playerId: session.playerId,
    currentName,
    newName,
    challenge: challenge.challenge,
    issuedAt: challenge.issuedAt,
    expiresAt: challenge.expiresAt,
  } satisfies RenameAdventurerPayload)
  return {
    payload,
    publicKey: keyPair.publicKey.toHex(),
    signature: keyPair.sign(nimiqSignedMessageHash(payload)).toHex(),
  }
}

async function expectCode(action: () => Promise<unknown>, code: string) {
  await expect(action()).rejects.toMatchObject({ code })
}

describe('P5 signed Adventurer rename lifecycle', () => {
  it('rejects before 30 days, then renames without changing identity or stats', async () => {
    const f = fixture()
    const created = await create(f, 'Endy')
    const session = await f.service.authenticateSession(created.sessionCapability)
    const before = created.profile
    await expectCode(async () => f.service.renameProfile(session, await signedRename(f, session, 'Rover')), 'DISPLAY_NAME_COOLDOWN')

    f.setNow(new Date(NOW.getTime() + COOLDOWN + 1_000))
    const renamed = await f.service.renameProfile(session, await signedRename(f, session, 'Rover'))
    expect(renamed.displayName).toBe('Rover')
    expect(renamed.playerId).toBe(before.playerId)
    expect(renamed.avatarId).toBe(before.avatarId)
    expect(renamed.stats).toEqual(before.stats)
    expect(renamed.nextRenameAt).toBe(new Date(NOW.getTime() + COOLDOWN + 1_000 + COOLDOWN).toISOString())
    await expect(f.service.checkNameAvailability('Endy')).resolves.toMatchObject({ available: true })
    await expect(f.service.checkNameAvailability('rover')).resolves.toMatchObject({ available: false })
    await expect(f.service.getPublicProfile(created.profile.playerId)).resolves.toMatchObject({ playerId: created.profile.playerId, displayName: 'Rover' })
  })

  it('rejects same normalized, reserved, invalid, and taken names', async () => {
    const f = fixture()
    const created = await create(f, 'Endy')
    const session = await f.service.authenticateSession(created.sessionCapability)
    f.setNow(new Date(NOW.getTime() + COOLDOWN + 1_000))
    await expectCode(async () => f.service.renameProfile(session, await signedRename(f, session, 'ENDY')), 'DISPLAY_NAME_INVALID')
    await expectCode(async () => f.service.renameProfile(session, await signedRename(f, session, 'NimHunt')), 'DISPLAY_NAME_RESERVED')
    await expectCode(async () => f.service.renameProfile(session, await signedRename(f, session, 'bad  name')), 'DISPLAY_NAME_INVALID')

    const other = KeyPair.generate()
    f.store.seedProfile({ wallet: other.toAddress().toUserFriendlyAddress(), displayName: 'Rover', avatarId: 'common-01' })
    await expectCode(async () => f.service.renameProfile(session, await signedRename(f, session, 'Rover')), 'DISPLAY_NAME_TAKEN')
  })

  it('rejects wrong wallet, altered payload, expired challenge, and replay', async () => {
    const f = fixture()
    const created = await create(f, 'Endy')
    const session = await f.service.authenticateSession(created.sessionCapability)
    f.setNow(new Date(NOW.getTime() + COOLDOWN + 1_000))

    const wrongWallet = KeyPair.generate()
    await expectCode(async () => f.service.renameProfile(session, await signedRename(f, session, 'Rover', wrongWallet)), 'SIGNATURE_INVALID')

    const altered = await signedRename(f, session, 'Rover')
    await expectCode(() => f.service.renameProfile(session, { ...altered, payload: altered.payload.replace('Rover', 'Other') }), 'SIGNATURE_INVALID')

    const expiring = await signedRename(f, session, 'Rover')
    f.setNow(new Date(NOW.getTime() + COOLDOWN + 1_000 + 6 * 60 * 1_000))
    await expectCode(() => f.service.renameProfile(session, expiring), 'CHALLENGE_EXPIRED')

    f.setNow(new Date(NOW.getTime() + COOLDOWN + 1_000))
    const valid = await signedRename(f, session, 'Rover')
    await f.service.renameProfile(session, valid)
    await expectCode(() => f.service.renameProfile(session, valid), 'CHALLENGE_INVALID')
  })

  it('allows exactly one concurrent claimant for a globally unique name', async () => {
    const clock = { current: NOW }
    const store = createMemoryAdventurerIdentityStore({ now: () => clock.current })
    const left = fixture(store, clock)
    const right = fixture(store, clock)
    const leftCreated = await create(left, 'Lefty')
    const rightCreated = await create(right, 'Righty')
    const leftSession = await left.service.authenticateSession(leftCreated.sessionCapability)
    const rightSession = await right.service.authenticateSession(rightCreated.sessionCapability)
    const now = new Date(NOW.getTime() + COOLDOWN + 1_000)
    left.setNow(now)
    const [a, b] = await Promise.allSettled([
      left.service.renameProfile(leftSession, await signedRename(left, leftSession, 'Winner', left.keyPair, 'Lefty')),
      right.service.renameProfile(rightSession, await signedRename(right, rightSession, 'winner', right.keyPair, 'Righty')),
    ])
    expect([a, b].filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect([a, b].filter(result => result.status === 'rejected')).toHaveLength(1)
    expect([a, b].find(result => result.status === 'rejected')).toMatchObject({ reason: { code: 'DISPLAY_NAME_TAKEN' } })
    expect((await left.service.getProfileForWallet(left.wallet))?.playerId === (await right.service.getProfileForWallet(right.wallet))?.playerId).toBe(false)
  })
})
