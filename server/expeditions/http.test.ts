import { KeyPair } from '@nimiq/core'
import { describe, expect, it } from 'vitest'
import { hashBlueprint } from '../../src/game/replay/canonical.ts'
import { createRoom01Blueprint } from '../../src/game/world/room01.ts'
import { serializeStartPayload, type StartExpeditionPayload } from './canonical.ts'
import { nimiqSignedMessageHash } from './crypto.ts'
import { dispatchExpeditionHttp } from './http.ts'
import { createMemoryProofService } from './memoryProofStore.ts'

function createFixture() {
  let current = new Date('2026-09-09T12:00:00.000Z')
  const source = createRoom01Blueprint('2026-09-09', 'gem-runner', 'http-blueprint')
  const blueprint = { ...source, status: 'PUBLISHED' as const, blueprintHash: hashBlueprint(source) }
  const service = createMemoryProofService({ clock: { now: () => current }, blueprints: [blueprint] })
  const keyPair = KeyPair.generate()
  const wallet = keyPair.toAddress().toUserFriendlyAddress()
  return { service, keyPair, wallet, setNow: (value: string) => { current = new Date(value) } }
}

describe('authenticated expedition HTTP start surface', () => {
  it('creates a challenge without a cookie and sets only a secure session cookie after start', async () => {
    const fixture = createFixture()
    const challengeResponse = await dispatchExpeditionHttp(fixture.service, {
      method: 'POST',
      path: '/api/expeditions/start-challenge',
      body: { wallet: fixture.wallet, mission: 'gem-runner' },
    })
    expect(challengeResponse.status).toBe(200)
    expect(challengeResponse.headers?.['set-cookie']).toBeUndefined()

    const challenge = challengeResponse.body as {
      ok: true
      challenge: string
      dayKey: string
      blueprintId: string
      blueprintHash: string
    }
    const payload: StartExpeditionPayload = {
      version: 1,
      type: 'NIMHUNT_START_EXPEDITION',
      wallet: fixture.wallet,
      mission: 'gem-runner',
      dayKey: challenge.dayKey,
      challenge: challenge.challenge,
      blueprintId: challenge.blueprintId,
      blueprintHash: challenge.blueprintHash,
    }
    const canonicalPayload = serializeStartPayload(payload)
    const response = await dispatchExpeditionHttp(fixture.service, {
      method: 'POST',
      path: '/api/expeditions/start',
      body: {
        payload: canonicalPayload,
        publicKey: fixture.keyPair.publicKey.toHex(),
        signature: fixture.keyPair.sign(nimiqSignedMessageHash(canonicalPayload)).toHex(),
      },
    })

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ ok: true, outcome: 'START_CREATED' })
    expect(response.body).not.toHaveProperty('sessionCapability')
    expect(response.headers?.['set-cookie']).toContain('Secure')
    expect(response.headers?.['set-cookie']).toContain('HttpOnly')
    expect(response.headers?.['set-cookie']).toContain('SameSite=Strict')
  }, 15_000)

  it('returns stable errors and preserves no attempt for invalid signed starts', async () => {
    const fixture = createFixture()
    const challenge = await fixture.service.issueStartChallenge(fixture.wallet, 'gem-runner')
    const invalid = await dispatchExpeditionHttp(fixture.service, {
      method: 'POST',
      path: '/api/expeditions/start',
      body: {
        payload: JSON.stringify({}),
        publicKey: fixture.keyPair.publicKey.toHex(),
        signature: '00'.repeat(64),
      },
    })

    expect(invalid.status).toBe(400)
    expect(invalid.body).toMatchObject({ ok: false, error: 'START_CHALLENGE_INVALID' })
    expect((await fixture.service.issueStartChallenge(fixture.wallet, 'gem-runner')).challenge).not.toBe(challenge.challenge)
    expect(fixture.service.getWalletDailyStatus(fixture.wallet).expeditionsStarted).toBe(0)
  })
})
