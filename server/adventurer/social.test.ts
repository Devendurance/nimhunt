import { describe, expect, it } from 'vitest'
import { createAdventurerSocialService } from './social.ts'
import { createMemoryAdventurerIdentityStore } from './store.ts'
import { createMemoryAdventurerSocialStore } from './socialStore.ts'
import type { StoredAdventurerSession } from './types.ts'

const NOW = '2026-09-29T12:00:00.000Z'

type Fixture = ReturnType<typeof createFixture>

function createFixture(count = 4) {
  const identity = createMemoryAdventurerIdentityStore({ now: () => new Date(NOW) })
  const profiles = Array.from({ length: count }, (_, index) => identity.seedProfile({
    playerId: id(index + 1),
    wallet: `NQ32 PLAYER ${index + 1}`,
    displayName: `Player${String(index + 1).padStart(2, '0')}`,
    avatarId: 'common-01',
  }))
  const store = createMemoryAdventurerSocialStore(async playerId => {
    const profile = await identity.getProfileByPlayerId(playerId)
    return profile ? { playerId: profile.playerId, displayName: profile.displayName, avatarId: profile.avatarId } : null
  })
  return { identity, store, social: createAdventurerSocialService(store), profiles, session: (playerId: string): StoredAdventurerSession => ({
    sessionHash: `hash-${playerId}`,
    playerId,
    wallet: `NQ32 ${playerId}`,
    createdAt: NOW,
    expiresAt: '2026-10-29T12:00:00.000Z',
    revokedAt: null,
  }) }
}

function id(value: number): string {
  return `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`
}

async function becomeAllies(fixture: Fixture, sender: string, receiver: string) {
  const request = await fixture.social.request(fixture.session(sender), receiver)
  await fixture.social.accept(fixture.session(receiver), request.requestId)
  return request.requestId
}

describe('P4 Adventurer social safety', () => {
  it('uses player IDs, rejects self/unknown targets, and does not duplicate crossed requests', async () => {
    const fixture = createFixture()
    await expect(fixture.social.request(fixture.session(fixture.profiles[0].playerId), fixture.profiles[0].playerId)).rejects.toMatchObject({ code: 'SOCIAL_SELF_ACTION' })
    await expect(fixture.social.request(fixture.session(fixture.profiles[0].playerId), id(999))).rejects.toMatchObject({ code: 'SOCIAL_TARGET_UNAVAILABLE' })
    const first = await fixture.social.request(fixture.session(fixture.profiles[0].playerId), fixture.profiles[1].playerId)
    await expect(fixture.social.request(fixture.session(fixture.profiles[0].playerId), fixture.profiles[1].playerId)).rejects.toMatchObject({ code: 'SOCIAL_REQUEST_PENDING' })
    await expect(fixture.social.request(fixture.session(fixture.profiles[1].playerId), fixture.profiles[0].playerId)).rejects.toMatchObject({ code: 'SOCIAL_INCOMING_REQUEST_EXISTS' })
    expect(fixture.store.requests.filter(request => request.status === 'PENDING')).toHaveLength(1)
    expect((await fixture.social.getRelationship(fixture.session(fixture.profiles[1].playerId), fixture.profiles[0].playerId))).toMatchObject({ state: 'INCOMING_PENDING', requestId: first.requestId })
  })

  it('enforces the 25 outgoing and 25 incoming pending limits', async () => {
    const outgoing = createFixture(27)
    const sender = outgoing.profiles[0].playerId
    for (const target of outgoing.profiles.slice(1, 26)) await outgoing.social.request(outgoing.session(sender), target.playerId)
    await expect(outgoing.social.request(outgoing.session(sender), outgoing.profiles[26].playerId)).rejects.toMatchObject({ code: 'SOCIAL_OUTGOING_CAP_REACHED' })

    const incoming = createFixture(27)
    const receiver = incoming.profiles[0].playerId
    for (const senderProfile of incoming.profiles.slice(1, 26)) await incoming.social.request(incoming.session(senderProfile.playerId), receiver)
    await expect(incoming.social.request(incoming.session(incoming.profiles[26].playerId), receiver)).rejects.toMatchObject({ code: 'SOCIAL_INCOMING_CAP_REACHED' })
    expect((await incoming.social.getOverview(incoming.session(receiver))).incomingPendingCount).toBe(25)

    const concurrent = createFixture(31)
    const concurrentSender = concurrent.profiles[0].playerId
    await Promise.allSettled(concurrent.profiles.slice(1).map(target => concurrent.social.request(concurrent.session(concurrentSender), target.playerId)))
    expect((await concurrent.social.getOverview(concurrent.session(concurrentSender))).outgoingPendingCount).toBe(25)
  })

  it('accepts only by the receiver and concurrent duplicate accepts create one Ally', async () => {
    const fixture = createFixture()
    const sender = fixture.profiles[0].playerId
    const receiver = fixture.profiles[1].playerId
    const request = await fixture.social.request(fixture.session(sender), receiver)
    await expect(fixture.social.accept(fixture.session(sender), request.requestId)).rejects.toMatchObject({ code: 'SOCIAL_UNAUTHORIZED_ACTION' })
    const results = await Promise.allSettled([
      fixture.social.accept(fixture.session(receiver), request.requestId),
      fixture.social.accept(fixture.session(receiver), request.requestId),
    ])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1)
    expect(fixture.store.allies).toEqual([[sender < receiver ? sender : receiver, sender < receiver ? receiver : sender]])
    await expect(fixture.social.decline(fixture.session(receiver), request.requestId)).rejects.toMatchObject({ code: 'SOCIAL_REQUEST_STALE' })
  })

  it('enforces the 100 Ally boundary before accepting the 101st relationship', async () => {
    const fixture = createFixture(103)
    const anchor = fixture.profiles[0].playerId
    for (const other of fixture.profiles.slice(1, 101)) await becomeAllies(fixture, anchor, other.playerId)
    expect((await fixture.social.getOverview(fixture.session(anchor))).allyCount).toBe(100)
    const final = fixture.profiles[101].playerId
    const request = await fixture.social.request(fixture.session(final), anchor)
    await expect(fixture.social.accept(fixture.session(anchor), request.requestId)).rejects.toMatchObject({ code: 'SOCIAL_ALLY_CAP_REACHED' })
    expect((await fixture.social.getOverview(fixture.session(anchor))).allyCount).toBe(100)
  })

  it('declines, cancels, removes, blocks, and unblocks without restoring history', async () => {
    const fixture = createFixture()
    const [a, b, c] = fixture.profiles.map(profile => profile.playerId)
    const declined = await fixture.social.request(fixture.session(a), b)
    await fixture.social.decline(fixture.session(b), declined.requestId)
    const cancelled = await fixture.social.request(fixture.session(a), c)
    await fixture.social.cancel(fixture.session(a), cancelled.requestId)
    await expect(fixture.social.accept(fixture.session(c), cancelled.requestId)).rejects.toMatchObject({ code: 'SOCIAL_REQUEST_STALE' })

    await becomeAllies(fixture, a, b)
    await fixture.social.remove(fixture.session(b), a)
    await expect(fixture.social.remove(fixture.session(a), b)).rejects.toMatchObject({ code: 'SOCIAL_NOT_ALLY' })
    await becomeAllies(fixture, a, b)
    await fixture.social.block(fixture.session(a), b)
    expect((await fixture.social.getRelationship(fixture.session(a), b))).toMatchObject({ state: 'BLOCKED_BY_ME' })
    expect((await fixture.social.getOverview(fixture.session(a))).allyCount).toBe(0)
    await expect(fixture.social.request(fixture.session(b), a)).rejects.toMatchObject({ code: 'SOCIAL_TARGET_UNAVAILABLE' })
    await expect(fixture.social.getBlocked(fixture.session(a))).resolves.toMatchObject([{ playerId: b, displayName: 'Player02', avatarId: 'common-01' }])
    await expect(fixture.social.getBlocked(fixture.session(b))).resolves.toEqual([])
    await fixture.social.unblock(fixture.session(a), b)
    expect((await fixture.social.getRelationship(fixture.session(a), b))).toMatchObject({ state: 'NONE' })
    await becomeAllies(fixture, b, a)
    expect((await fixture.social.getOverview(fixture.session(a))).allyCount).toBe(1)
  })

  it('cancels both-direction pending state on block and rejects stale/unauthorized actions', async () => {
    const fixture = createFixture()
    const [a, b] = fixture.profiles.map(profile => profile.playerId)
    const request = await fixture.social.request(fixture.session(a), b)
    await expect(fixture.social.cancel(fixture.session(b), request.requestId)).rejects.toMatchObject({ code: 'SOCIAL_UNAUTHORIZED_ACTION' })
    await fixture.social.block(fixture.session(b), a)
    expect((await fixture.social.getRelationship(fixture.session(a), b))).toMatchObject({ state: 'UNAVAILABLE' })
    expect(fixture.store.requests.find(row => row.requestId === request.requestId)?.status).toBe('CANCELLED')
    await expect(fixture.social.accept(fixture.session(b), request.requestId)).rejects.toMatchObject({ code: 'SOCIAL_REQUEST_STALE' })
    await expect(fixture.social.unblock(fixture.session(a), b)).rejects.toMatchObject({ code: 'SOCIAL_NOT_BLOCKER' })
  })
})
