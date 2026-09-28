import { randomUUID } from 'node:crypto'
import {
  ADVENTURER_SESSION_MAX_AGE_SECONDS,
  isLegacyAdventurerAvatar,
  isStarterAdventurerAvatar,
  type AdventurerChallengePurpose,
} from '../../src/domain/adventurer.js'
import { AdventurerError } from './errors.js'
import { isReservedDisplayName, validateDisplayName } from './names.js'
import type {
  AdventurerChallengeRecord,
  AdventurerIdentityStore,
  CreateStoredAdventurerResult,
  CreateStoredSessionResult,
  StoredAdventurerProfile,
  StoredAdventurerSession,
} from './types.js'

export function createMemoryAdventurerIdentityStore(options: {
  readonly now?: () => Date
} = {}): AdventurerIdentityStore & {
  readonly profiles: readonly StoredAdventurerProfile[]
  seedProfile(input: Partial<StoredAdventurerProfile> & { readonly wallet: string; readonly displayName: string; readonly avatarId: string }): StoredAdventurerProfile
} {
  const now = options.now ?? (() => new Date())
  const profilesById = new Map<string, StoredAdventurerProfile>()
  const challenges = new Map<string, AdventurerChallengeRecord>()
  const sessions = new Map<string, StoredAdventurerSession>()

  const findByWallet = (wallet: string) => [...profilesById.values()].find(profile => profile.wallet === wallet) ?? null
  const findByName = (normalizedName: string) => [...profilesById.values()].find(profile => profile.displayName.toLocaleLowerCase('en-US') === normalizedName) ?? null

  const store: AdventurerIdentityStore & {
    readonly profiles: readonly StoredAdventurerProfile[]
    seedProfile(input: Partial<StoredAdventurerProfile> & { readonly wallet: string; readonly displayName: string; readonly avatarId: string }): StoredAdventurerProfile
  } = {
    get profiles() {
      return [...profilesById.values()]
    },

    seedProfile(input) {
      const validation = validateDisplayName(input.displayName)
      if (!validation.ok) throw new AdventurerError(validation.error)
      const profile: StoredAdventurerProfile = {
        playerId: input.playerId ?? randomUUID(),
        wallet: input.wallet,
        displayName: validation.value.displayName,
        avatarId: input.avatarId,
        displayNameChangedAt: input.displayNameChangedAt ?? now().toISOString(),
        createdAt: input.createdAt ?? now().toISOString(),
        updatedAt: input.updatedAt ?? now().toISOString(),
        stats: input.stats ?? { lifetimeGems: 0, expeditionsCompleted: 0, bestStreak: 0 },
      }
      if (!isStarterAdventurerAvatar(profile.avatarId) && !isLegacyAdventurerAvatar(profile.avatarId)) throw new AdventurerError('AVATAR_UNAVAILABLE')
      if (findByWallet(profile.wallet)) throw new AdventurerError('PROFILE_ALREADY_EXISTS')
      if (findByName(validation.value.normalizedName)) throw new AdventurerError('DISPLAY_NAME_TAKEN')
      profilesById.set(profile.playerId, profile)
      return profile
    },

    async issueChallenge(input) {
      const existing = findByWallet(input.wallet)
      if (input.purpose === 'CREATE' && existing) throw new AdventurerError('PROFILE_ALREADY_EXISTS')
      if (input.purpose === 'SESSION' && !existing) throw new AdventurerError('PROFILE_NOT_FOUND')
      const issuedAt = now().toISOString()
      const expiresAt = new Date(now().getTime() + 5 * 60 * 1_000).toISOString()
      const record: AdventurerChallengeRecord = {
        challengeHash: input.challengeHash,
        purpose: input.purpose,
        wallet: input.wallet,
        issuedAt,
        expiresAt,
        consumedAt: null,
        authorizationFingerprint: null,
        playerId: existing?.playerId ?? null,
      }
      challenges.set(input.challengeHash, record)
      return record
    },

    async createProfile(input) {
      const challenge = requireChallenge(challenges, input.challengeHash, 'CREATE', input.wallet, input.issuedAt, input.expiresAt, now())
      const validation = validateDisplayName(input.displayName)
      if (!validation.ok) throw new AdventurerError(validation.error)
      if (validation.value.normalizedName !== input.normalizedName) throw new AdventurerError('DISPLAY_NAME_INVALID')
      if (!isStarterAdventurerAvatar(input.avatarId)) throw new AdventurerError('AVATAR_UNAVAILABLE')
      if (findByWallet(input.wallet)) throw new AdventurerError('PROFILE_ALREADY_EXISTS')
      if (findByName(input.normalizedName)) throw new AdventurerError(isReservedDisplayName(input.displayName) ? 'DISPLAY_NAME_RESERVED' : 'DISPLAY_NAME_TAKEN')
      const createdAt = now().toISOString()
      const profile: StoredAdventurerProfile = {
        playerId: randomUUID(),
        wallet: input.wallet,
        displayName: input.displayName,
        avatarId: input.avatarId,
        displayNameChangedAt: createdAt,
        createdAt,
        updatedAt: createdAt,
        stats: { lifetimeGems: 0, expeditionsCompleted: 0, bestStreak: 0 },
      }
      const session: StoredAdventurerSession = {
        sessionHash: input.sessionHash,
        playerId: profile.playerId,
        wallet: profile.wallet,
        createdAt,
        expiresAt: capSessionExpiry(input.sessionExpiresAt, createdAt),
        revokedAt: null,
      }
      profilesById.set(profile.playerId, profile)
      sessions.set(session.sessionHash, session)
      challenges.set(input.challengeHash, { ...challenge, consumedAt: createdAt, authorizationFingerprint: input.authorizationFingerprint, playerId: profile.playerId })
      return { profile, session } satisfies CreateStoredAdventurerResult
    },

    async createSession(input) {
      const challenge = requireChallenge(challenges, input.challengeHash, 'SESSION', input.wallet, input.issuedAt, input.expiresAt, now())
      const profile = findByWallet(input.wallet)
      if (!profile) throw new AdventurerError('PROFILE_NOT_FOUND')
      const createdAt = now().toISOString()
      const session: StoredAdventurerSession = {
        sessionHash: input.sessionHash,
        playerId: profile.playerId,
        wallet: profile.wallet,
        createdAt,
        expiresAt: capSessionExpiry(input.sessionExpiresAt, createdAt),
        revokedAt: null,
      }
      sessions.set(session.sessionHash, session)
      challenges.set(input.challengeHash, { ...challenge, consumedAt: createdAt, authorizationFingerprint: input.authorizationFingerprint, playerId: profile.playerId })
      return { profile, session } satisfies CreateStoredSessionResult
    },

    async getSession(sessionHash) {
      return sessions.get(sessionHash) ?? null
    },

    async getProfileByWallet(wallet) {
      return findByWallet(wallet)
    },

    async getProfileByPlayerId(playerId) {
      return profilesById.get(playerId) ?? null
    },

    async checkNameAvailability(normalizedName) {
      return !findByName(normalizedName)
    },

    async updateAvatar(input) {
      const profile = profilesById.get(input.playerId)
      if (!profile || profile.wallet !== input.wallet) throw new AdventurerError('PROFILE_NOT_FOUND')
      if (!isStarterAdventurerAvatar(input.avatarId)) throw new AdventurerError('AVATAR_UNAVAILABLE')
      const updated: StoredAdventurerProfile = {
        ...profile,
        avatarId: input.avatarId,
        updatedAt: now().toISOString(),
      }
      profilesById.set(updated.playerId, updated)
      return updated
    },
  }
  return store
}

function requireChallenge(
  challenges: ReadonlyMap<string, AdventurerChallengeRecord>,
  challengeHash: string,
  purpose: AdventurerChallengePurpose,
  wallet: string,
  issuedAt: string,
  expiresAt: string,
  now: Date,
): AdventurerChallengeRecord {
  const challenge = challenges.get(challengeHash)
  if (!challenge || challenge.purpose !== purpose || challenge.wallet !== wallet || challenge.issuedAt !== issuedAt || challenge.expiresAt !== expiresAt || challenge.consumedAt) {
    throw new AdventurerError('CHALLENGE_INVALID')
  }
  if (now.getTime() >= new Date(challenge.expiresAt).getTime()) throw new AdventurerError('CHALLENGE_EXPIRED')
  return challenge
}

function capSessionExpiry(value: string, createdAt: string): string {
  const created = new Date(createdAt).getTime()
  const requested = new Date(value).getTime()
  const maximum = created + ADVENTURER_SESSION_MAX_AGE_SECONDS * 1_000
  if (!Number.isFinite(requested) || requested <= created) throw new AdventurerError('CHALLENGE_INVALID')
  return new Date(Math.min(requested, maximum)).toISOString()
}
