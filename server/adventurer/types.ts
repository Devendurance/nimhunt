import type {
  AdventurerChallenge,
  AdventurerChallengePurpose,
  AdventurerProfile,
  AdventurerSession,
  NameAvailability,
  PublicAdventurerProfile,
} from '../../src/domain/adventurer.js'
import type { MonthlyRunFacts } from '../monthlyHeroes/service.js'

export type StoredAdventurerProfile = AdventurerProfile & {
  readonly wallet: string
}

export type StoredAdventurerSession = {
  readonly sessionHash: string
  readonly playerId: string
  readonly wallet: string
  readonly createdAt: string
  readonly expiresAt: string
  readonly revokedAt: string | null
}

export type AdventurerChallengeRecord = {
  readonly challengeHash: string
  readonly purpose: AdventurerChallengePurpose
  readonly wallet: string
  readonly issuedAt: string
  readonly expiresAt: string
  readonly consumedAt: string | null
  readonly authorizationFingerprint: string | null
  readonly playerId: string | null
}

export type CreateStoredAdventurerInput = {
  readonly challengeHash: string
  readonly authorizationFingerprint: string
  readonly wallet: string
  readonly issuedAt: string
  readonly expiresAt: string
  readonly displayName: string
  readonly normalizedName: string
  readonly avatarId: string
  readonly sessionHash: string
  readonly sessionExpiresAt: string
}

export type CreateStoredAdventurerResult = {
  readonly profile: StoredAdventurerProfile
  readonly session: StoredAdventurerSession
}

export type CreateStoredSessionInput = {
  readonly challengeHash: string
  readonly authorizationFingerprint: string
  readonly wallet: string
  readonly issuedAt: string
  readonly expiresAt: string
  readonly sessionHash: string
  readonly sessionExpiresAt: string
}

export type CreateStoredSessionResult = {
  readonly profile: StoredAdventurerProfile
  readonly session: StoredAdventurerSession
}

export type AdventurerIdentityStore = {
  issueChallenge(input: {
    readonly wallet: string
    readonly purpose: AdventurerChallengePurpose
    readonly challengeHash: string
  }): Promise<AdventurerChallengeRecord>
  createProfile(input: CreateStoredAdventurerInput): Promise<CreateStoredAdventurerResult>
  createSession(input: CreateStoredSessionInput): Promise<CreateStoredSessionResult>
  getSession(sessionHash: string): Promise<StoredAdventurerSession | null>
  getProfileByWallet(wallet: string): Promise<StoredAdventurerProfile | null>
  getProfileByPlayerId(playerId: string): Promise<StoredAdventurerProfile | null>
  checkNameAvailability(normalizedName: string): Promise<boolean>
}

export type AdventurerStatsSource = {
  loadWalletRuns(wallet: string): Promise<readonly MonthlyRunFacts[]>
}

export type AdventurerService = {
  issueCreationChallenge(wallet: string): Promise<AdventurerChallenge>
  createProfile(input: {
    readonly payload: string
    readonly publicKey: string
    readonly signature: string
  }): Promise<{ readonly profile: AdventurerProfile; readonly session: AdventurerSession; readonly sessionCapability: string }>
  issueSessionChallenge(wallet: string): Promise<AdventurerChallenge>
  createSession(input: {
    readonly payload: string
    readonly publicKey: string
    readonly signature: string
  }): Promise<{ readonly profile: AdventurerProfile; readonly session: AdventurerSession; readonly sessionCapability: string }>
  authenticateSession(raw: string): Promise<StoredAdventurerSession>
  getOwnProfile(session: StoredAdventurerSession): Promise<AdventurerProfile>
  getPublicProfile(playerId: string): Promise<PublicAdventurerProfile>
  checkNameAvailability(name: string): Promise<NameAvailability>
  /** P1 capability for a future real-expedition gate; intentionally unused. */
  getProfileForWallet(wallet: string): Promise<AdventurerProfile | null>
}
