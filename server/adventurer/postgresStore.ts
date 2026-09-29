import type { SupabaseClient } from '@supabase/supabase-js'
import { AdventurerError, AdventurerUnavailableError } from './errors.js'
import type {
  AdventurerIdentityStore,
  CreateStoredAdventurerResult,
  CreateStoredSessionResult,
  StoredAdventurerProfile,
  StoredAdventurerSession,
} from './types.js'

const IDENTITY_RPCS = new Set([
  'create_adventurer_challenge',
  'consume_create_adventurer_challenge',
  'consume_adventurer_session_challenge',
  'get_adventurer_session',
  'get_adventurer_profile_by_wallet',
  'get_adventurer_profile_by_player_id',
  'check_adventurer_name_availability',
  'create_adventurer_rename_challenge',
  'consume_adventurer_rename_challenge',
])

export function createSupabaseAdventurerIdentityStore(client: SupabaseClient): AdventurerIdentityStore {
  return {
    async issueChallenge(input) {
      const result = readRpc(await call(client, input.purpose === 'RENAME' ? 'create_adventurer_rename_challenge' : 'create_adventurer_challenge', input.purpose === 'RENAME'
        ? { p_player_id: input.playerId, p_wallet: input.wallet, p_challenge_hash: input.challengeHash }
        : { p_wallet: input.wallet, p_purpose: input.purpose, p_challenge_hash: input.challengeHash }))
      return {
        challengeHash: input.challengeHash,
        purpose: input.purpose,
        wallet: asString(result.wallet),
        issuedAt: asIso(result.issued_at),
        expiresAt: asIso(result.expires_at),
        consumedAt: null,
        authorizationFingerprint: null,
        playerId: result.player_id == null ? null : asString(result.player_id),
      }
    },

    async createProfile(input) {
      const result = readRpc(await call(client, 'consume_create_adventurer_challenge', {
        p_challenge_hash: input.challengeHash,
        p_authorization_fingerprint: input.authorizationFingerprint,
        p_wallet: input.wallet,
        p_issued_at: input.issuedAt,
        p_expires_at: input.expiresAt,
        p_display_name: input.displayName,
        p_normalized_name: input.normalizedName,
        p_avatar_id: input.avatarId,
        p_session_hash: input.sessionHash,
        p_session_expires_at: input.sessionExpiresAt,
      }))
      return {
        profile: mapProfile(result.profile),
        session: mapSession(result.session),
      } satisfies CreateStoredAdventurerResult
    },

    async renameProfile(input) {
      const result = readRpc(await call(client, 'consume_adventurer_rename_challenge', {
        p_challenge_hash: input.challengeHash,
        p_authorization_fingerprint: input.authorizationFingerprint,
        p_player_id: input.playerId,
        p_wallet: input.wallet,
        p_issued_at: input.issuedAt,
        p_expires_at: input.expiresAt,
        p_current_name: input.currentName,
        p_new_name: input.newName,
        p_normalized_name: input.normalizedName,
      }))
      return mapProfile(result.profile)
    },

    async createSession(input) {
      const result = readRpc(await call(client, 'consume_adventurer_session_challenge', {
        p_challenge_hash: input.challengeHash,
        p_authorization_fingerprint: input.authorizationFingerprint,
        p_wallet: input.wallet,
        p_issued_at: input.issuedAt,
        p_expires_at: input.expiresAt,
        p_session_hash: input.sessionHash,
        p_session_expires_at: input.sessionExpiresAt,
      }))
      return {
        profile: mapProfile(result.profile),
        session: mapSession(result.session),
      } satisfies CreateStoredSessionResult
    },

    async getSession(sessionHash) {
      const payload = await call(client, 'get_adventurer_session', { p_session_hash: sessionHash })
      if (isNotFound(payload)) return null
      const result = readRpc(payload)
      return mapSession(result.session)
    },

    async getProfileByWallet(wallet) {
      const payload = await call(client, 'get_adventurer_profile_by_wallet', { p_wallet: wallet })
      if (isNotFound(payload)) return null
      const result = readRpc(payload)
      return mapProfile(result.profile)
    },

    async getProfileByPlayerId(playerId) {
      const payload = await call(client, 'get_adventurer_profile_by_player_id', { p_player_id: playerId })
      if (isNotFound(payload)) return null
      const result = readRpc(payload)
      return mapProfile(result.profile)
    },

    async checkNameAvailability(normalizedName) {
      const result = readRpc(await call(client, 'check_adventurer_name_availability', { p_normalized_name: normalizedName }))
      return result.available === true
    },

    async updateAvatar(input) {
      const { data, error } = await client
        .from('adventurer_profiles')
        .update({ avatar_id: input.avatarId })
        .eq('player_id', input.playerId)
        .eq('wallet', input.wallet)
        .select('player_id,wallet,display_name,avatar_id,display_name_changed_at,created_at,updated_at')
        .maybeSingle()
      if (error) throw new AdventurerUnavailableError()
      if (!data) throw new AdventurerError('PROFILE_NOT_FOUND')
      return mapProfile(data)
    },
  }
}

async function call(client: SupabaseClient, name: string, args: Record<string, unknown>): Promise<unknown> {
  if (!IDENTITY_RPCS.has(name)) throw new AdventurerUnavailableError()
  const { data, error } = await client.rpc(name, args)
  if (error) throw new AdventurerUnavailableError()
  return data
}

function readRpc(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new AdventurerUnavailableError()
  if (value.ok === false) {
    const code = value.error
    if (isAdventurerErrorCode(code)) throw new AdventurerError(code)
    throw new AdventurerUnavailableError()
  }
  if (value.ok !== true) throw new AdventurerUnavailableError()
  return value
}

function isNotFound(value: unknown): boolean {
  return isRecord(value) && value.ok === false && value.error === 'PROFILE_NOT_FOUND'
}

function mapProfile(value: unknown): StoredAdventurerProfile {
  const row = asRecord(value)
  return {
    playerId: asString(row.player_id),
    wallet: asString(row.wallet),
    displayName: asString(row.display_name),
    avatarId: asString(row.avatar_id),
    displayNameChangedAt: asIso(row.display_name_changed_at),
    createdAt: asIso(row.created_at),
    updatedAt: asIso(row.updated_at),
    stats: { lifetimeGems: 0, expeditionsCompleted: 0, bestStreak: 0 },
  }
}

function mapSession(value: unknown): StoredAdventurerSession {
  const row = asRecord(value)
  return {
    sessionHash: asString(row.session_hash),
    playerId: asString(row.player_id),
    wallet: asString(row.wallet),
    createdAt: asIso(row.created_at),
    expiresAt: asIso(row.expires_at),
    revokedAt: row.revoked_at == null ? null : asIso(row.revoked_at),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new AdventurerUnavailableError()
  return value as Record<string, unknown>
}

function asString(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) throw new AdventurerUnavailableError()
  return value
}

function asIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString()
  if (typeof value !== 'string') throw new AdventurerUnavailableError()
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) throw new AdventurerUnavailableError()
  return date.toISOString()
}

function isAdventurerErrorCode(value: unknown): value is import('../../src/domain/adventurer.js').AdventurerErrorCode {
  return value === 'PROFILE_NOT_FOUND'
    || value === 'PROFILE_ALREADY_EXISTS'
    || value === 'DISPLAY_NAME_INVALID'
    || value === 'DISPLAY_NAME_TAKEN'
    || value === 'DISPLAY_NAME_RESERVED'
    || value === 'DISPLAY_NAME_COOLDOWN'
    || value === 'AVATAR_UNAVAILABLE'
    || value === 'ADVENTURER_SESSION_INVALID'
    || value === 'CHALLENGE_INVALID'
    || value === 'CHALLENGE_EXPIRED'
    || value === 'SIGNATURE_INVALID'
}
