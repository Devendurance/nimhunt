import { randomBytes } from 'node:crypto'
import { normalizeNimiqWallet } from '../ledger/wallet.js'
import { verifyNimiqSignedCanonicalMessage } from '../expeditions/crypto.js'
import {
  fingerprintAdventurerAuthorization,
  hashAdventurerChallenge,
  parseAdventurerSessionPayload,
  parseCreateAdventurerPayload,
  type SignedAdventurerRequest,
} from './canonical.js'
import { AdventurerError } from './errors.js'
import { validateDisplayName } from './names.js'
import {
  createAdventurerSessionCapability,
  hashAdventurerSessionCapability,
  requireAdventurerSession,
  toAdventurerSession,
} from './session.js'
import { deriveAdventurerStats } from './stats.js'
import type {
  AdventurerIdentityStore,
  AdventurerService,
  AdventurerStatsSource,
  StoredAdventurerProfile,
} from './types.js'
import type {
  AdventurerChallenge,
  AdventurerProfile,
  NameAvailability,
  PublicAdventurerProfile,
} from '../../src/domain/adventurer.js'
import {
  ADVENTURER_SESSION_MAX_AGE_SECONDS,
  isStarterAdventurerAvatar,
} from '../../src/domain/adventurer.js'

export function createAdventurerService(options: {
  readonly store: AdventurerIdentityStore
  readonly stats: AdventurerStatsSource
  readonly now?: () => Date
}): AdventurerService {
  const now = options.now ?? (() => new Date())
  const store = options.store
  const stats = options.stats

  const service: AdventurerService = {
    async issueCreationChallenge(wallet) {
      const normalizedWallet = normalizeWallet(wallet)
      const challenge = await issueChallenge(store, normalizedWallet, 'CREATE')
      return { ...challenge, purpose: 'CREATE' }
    },

    async createProfile(input) {
      const parsed = parseCreateAdventurerPayload(input.payload)
      if (!parsed) throw new AdventurerError('CHALLENGE_INVALID')
      const display = validateDisplayName(parsed.displayName)
      if (!display.ok) throw new AdventurerError(display.error)
      if (!isSupportedAvatar(parsed.avatarId)) throw new AdventurerError('AVATAR_UNAVAILABLE')
      verifyWalletSignature(input, parsed.wallet, parsed.wallet)
      const capability = createAdventurerSessionCapability()
      const stored = await store.createProfile({
        challengeHash: hashAdventurerChallenge(parsed.challenge),
        authorizationFingerprint: fingerprintAdventurerAuthorization(input),
        wallet: parsed.wallet,
        issuedAt: parsed.issuedAt,
        expiresAt: parsed.expiresAt,
        displayName: display.value.displayName,
        normalizedName: display.value.normalizedName,
        avatarId: parsed.avatarId,
        sessionHash: hashAdventurerSessionCapability(capability),
        sessionExpiresAt: sessionExpiry(now()),
      })
      const profile = await withStats(stored.profile, stats)
      return { profile, session: toAdventurerSession(stored.session), sessionCapability: capability }
    },

    async issueSessionChallenge(wallet) {
      const normalizedWallet = normalizeWallet(wallet)
      const challenge = await issueChallenge(store, normalizedWallet, 'SESSION')
      return { ...challenge, purpose: 'SESSION' }
    },

    async createSession(input) {
      const parsed = parseAdventurerSessionPayload(input.payload)
      if (!parsed) throw new AdventurerError('CHALLENGE_INVALID')
      verifyWalletSignature(input, parsed.wallet, parsed.wallet)
      const capability = createAdventurerSessionCapability()
      const stored = await store.createSession({
        challengeHash: hashAdventurerChallenge(parsed.challenge),
        authorizationFingerprint: fingerprintAdventurerAuthorization(input),
        wallet: parsed.wallet,
        issuedAt: parsed.issuedAt,
        expiresAt: parsed.expiresAt,
        sessionHash: hashAdventurerSessionCapability(capability),
        sessionExpiresAt: sessionExpiry(now()),
      })
      const profile = await withStats(stored.profile, stats)
      return { profile, session: toAdventurerSession(stored.session), sessionCapability: capability }
    },

    async authenticateSession(raw) {
      const sessionHash = hashAdventurerSessionCapability(raw)
      const stored = await store.getSession(sessionHash)
      return requireAdventurerSession(raw, stored, now())
    },

    async getOwnProfile(session) {
      const profile = await store.getProfileByPlayerId(session.playerId)
      if (!profile || profile.wallet !== session.wallet) throw new AdventurerError('PROFILE_NOT_FOUND')
      return withStats(profile, stats)
    },

    async updateAvatar(session, avatarId) {
      if (!isSupportedAvatar(avatarId)) throw new AdventurerError('AVATAR_UNAVAILABLE')
      const profile = await store.updateAvatar({ playerId: session.playerId, wallet: session.wallet, avatarId })
      return withStats(profile, stats)
    },

    async getPublicProfile(playerId) {
      if (!isUuid(playerId)) throw new AdventurerError('PROFILE_NOT_FOUND')
      const profile = await store.getProfileByPlayerId(playerId)
      if (!profile) throw new AdventurerError('PROFILE_NOT_FOUND')
      const withDerivedStats = await withStats(profile, stats)
      return toPublicProfile(withDerivedStats)
    },

    async checkNameAvailability(name): Promise<NameAvailability> {
      const validation = validateDisplayName(name)
      if (!validation.ok) {
        return { available: false, normalizedName: null, error: validation.error }
      }
      const available = await store.checkNameAvailability(validation.value.normalizedName)
      return {
        available,
        normalizedName: validation.value.normalizedName,
        error: available ? null : 'DISPLAY_NAME_TAKEN',
      }
    },

    async getProfileForWallet(wallet) {
      const normalizedWallet = normalizeWallet(wallet)
      const profile = await store.getProfileByWallet(normalizedWallet)
      return profile ? withStats(profile, stats) : null
    },
  }
  return service
}

async function issueChallenge(
  store: AdventurerIdentityStore,
  wallet: string,
  purpose: 'CREATE' | 'SESSION',
): Promise<Omit<AdventurerChallenge, 'purpose'> & { readonly purpose: 'CREATE' | 'SESSION' }> {
  const challenge = randomBytes(32).toString('base64url')
  const stored = await store.issueChallenge({ wallet, purpose, challengeHash: hashAdventurerChallenge(challenge) })
  return {
    purpose: stored.purpose,
    challenge,
    issuedAt: stored.issuedAt,
    expiresAt: stored.expiresAt,
  }
}

function verifyWalletSignature(input: SignedAdventurerRequest, wallet: string, payloadWallet: string): void {
  const verification = verifyNimiqSignedCanonicalMessage({
    payload: input.payload,
    wallet,
    payloadWallet,
    publicKey: input.publicKey,
    signature: input.signature,
  })
  if (!verification.valid) throw new AdventurerError('SIGNATURE_INVALID')
}

async function withStats(profile: StoredAdventurerProfile, source: AdventurerStatsSource): Promise<AdventurerProfile> {
  const runs = await source.loadWalletRuns(profile.wallet)
  return {
    playerId: profile.playerId,
    displayName: profile.displayName,
    avatarId: profile.avatarId,
    displayNameChangedAt: profile.displayNameChangedAt,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
    stats: deriveAdventurerStats(runs),
  }
}

function toPublicProfile(profile: AdventurerProfile): PublicAdventurerProfile {
  return {
    playerId: profile.playerId,
    displayName: profile.displayName,
    avatarId: profile.avatarId,
    lifetimeGems: profile.stats.lifetimeGems,
    expeditionsCompleted: profile.stats.expeditionsCompleted,
    bestStreak: profile.stats.bestStreak,
    allyCount: 0,
  }
}

function normalizeWallet(wallet: unknown): string {
  try {
    return normalizeNimiqWallet(wallet)
  } catch {
    throw new AdventurerError('CHALLENGE_INVALID')
  }
}

function isSupportedAvatar(avatarId: string): boolean {
  return isStarterAdventurerAvatar(avatarId)
}

function sessionExpiry(now: Date): string {
  return new Date(now.getTime() + ADVENTURER_SESSION_MAX_AGE_SECONDS * 1_000).toISOString()
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}
