import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  AdventurerAllyRequest,
  AdventurerBlockedProfile,
  AdventurerRelationship,
  AdventurerSocialOverview,
  AdventurerSocialProfile,
} from '../../src/domain/adventurerSocial.js'
import { AdventurerSocialError, AdventurerUnavailableError } from './errors.js'
import { isSocialErrorCode } from './social.js'
import type { AdventurerSocialStore } from './socialTypes.js'

const SOCIAL_RPCS = new Set([
  'get_adventurer_ally_count',
  'get_adventurer_relationship',
  'get_adventurer_social_overview',
  'get_adventurer_blocked_profiles',
  'adventurer_social_request',
  'adventurer_social_accept',
  'adventurer_social_decline',
  'adventurer_social_cancel',
  'adventurer_social_remove',
  'adventurer_social_block',
  'adventurer_social_unblock',
])

export function createSupabaseAdventurerSocialStore(client: SupabaseClient): AdventurerSocialStore {
  return {
    async getAllyCount(playerId) {
      const result = readRpc(await call(client, 'get_adventurer_ally_count', { p_player_id: playerId }))
      if (!Number.isSafeInteger(result.ally_count) || (result.ally_count as number) < 0) throw new AdventurerUnavailableError()
      return result.ally_count as number
    },

    async getRelationship(viewerId, targetId) {
      const result = readRpc(await call(client, 'get_adventurer_relationship', { p_viewer_id: viewerId, p_target_id: targetId }))
      const state = result.state
      if (state !== 'NONE' && state !== 'OUTGOING_PENDING' && state !== 'INCOMING_PENDING' && state !== 'ALLY' && state !== 'BLOCKED_BY_ME' && state !== 'UNAVAILABLE') throw new AdventurerUnavailableError()
      return {
        state,
        requestId: result.request_id == null ? null : asString(result.request_id),
      } satisfies AdventurerRelationship
    },

    async getOverview(playerId) {
      const result = readRpc(await call(client, 'get_adventurer_social_overview', { p_player_id: playerId }))
      return mapOverview(result)
    },

    async getBlocked(playerId) {
      const result = readRpc(await call(client, 'get_adventurer_blocked_profiles', { p_blocker_id: playerId }))
      if (!Array.isArray(result.blocked)) throw new AdventurerUnavailableError()
      const blocked = result.blocked.map(mapBlockedProfile)
      if (blocked.some(profile => profile === null)) throw new AdventurerUnavailableError()
      return blocked as AdventurerBlockedProfile[]
    },

    async request(senderId, receiverId) {
      const result = readRpc(await call(client, 'adventurer_social_request', { p_sender_id: senderId, p_receiver_id: receiverId }))
      return { requestId: asString(result.request_id) }
    },

    async accept(receiverId, requestId) {
      readRpc(await call(client, 'adventurer_social_accept', { p_receiver_id: receiverId, p_request_id: requestId }))
    },

    async decline(receiverId, requestId) {
      readRpc(await call(client, 'adventurer_social_decline', { p_receiver_id: receiverId, p_request_id: requestId }))
    },

    async cancel(senderId, requestId) {
      readRpc(await call(client, 'adventurer_social_cancel', { p_sender_id: senderId, p_request_id: requestId }))
    },

    async remove(playerId, otherPlayerId) {
      readRpc(await call(client, 'adventurer_social_remove', { p_player_id: playerId, p_other_player_id: otherPlayerId }))
    },

    async block(blockerId, blockedId) {
      readRpc(await call(client, 'adventurer_social_block', { p_blocker_id: blockerId, p_blocked_id: blockedId }))
    },

    async unblock(blockerId, blockedId) {
      readRpc(await call(client, 'adventurer_social_unblock', { p_blocker_id: blockerId, p_blocked_id: blockedId }))
    },
  }
}

async function call(client: SupabaseClient, name: string, args: Record<string, unknown>): Promise<unknown> {
  if (!SOCIAL_RPCS.has(name)) throw new AdventurerUnavailableError()
  const { data, error } = await client.rpc(name, args)
  if (error) throw new AdventurerUnavailableError()
  return data
}

function readRpc(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new AdventurerUnavailableError()
  if (value.ok === false) {
    if (isSocialErrorCode(value.error)) throw new AdventurerSocialError(value.error)
    throw new AdventurerUnavailableError()
  }
  if (value.ok !== true) throw new AdventurerUnavailableError()
  return value
}

function mapOverview(value: Record<string, unknown>): AdventurerSocialOverview {
  const allyCount = asCount(value.ally_count)
  const incomingPendingCount = asCount(value.incoming_pending_count)
  const outgoingPendingCount = asCount(value.outgoing_pending_count)
  const incomingRequests = Array.isArray(value.incoming_requests) ? value.incoming_requests.map(mapRequest) : null
  const allies = Array.isArray(value.allies) ? value.allies.map(mapProfile) : null
  if (allyCount === null || incomingPendingCount === null || outgoingPendingCount === null || !incomingRequests || incomingRequests.some(value => value === null) || !allies || allies.some(value => value === null)) throw new AdventurerUnavailableError()
  return {
    allyCount,
    incomingPendingCount,
    outgoingPendingCount,
    incomingRequests: incomingRequests as AdventurerAllyRequest[],
    allies: allies as AdventurerSocialProfile[],
  }
}

function mapRequest(value: unknown): AdventurerAllyRequest | null {
  if (!isRecord(value)) return null
  const requestId = typeof value.request_id === 'string' ? value.request_id : null
  const playerId = typeof value.player_id === 'string' ? value.player_id : null
  const displayName = typeof value.display_name === 'string' ? value.display_name : null
  const avatarId = typeof value.avatar_id === 'string' ? value.avatar_id : null
  const createdAt = asIso(value.created_at)
  if (!requestId || !playerId || !displayName || !avatarId || !createdAt) return null
  return { requestId, playerId, displayName, avatarId, createdAt }
}

function mapBlockedProfile(value: unknown): AdventurerBlockedProfile | null {
  if (!isRecord(value)) return null
  const profile = mapProfile(value)
  const blockedAt = asIso(value.blocked_at)
  return profile && blockedAt ? { ...profile, blockedAt } : null
}

function mapProfile(value: unknown): AdventurerSocialProfile | null {
  if (!isRecord(value)) return null
  const playerId = typeof value.player_id === 'string' ? value.player_id : null
  const displayName = typeof value.display_name === 'string' ? value.display_name : null
  const avatarId = typeof value.avatar_id === 'string' ? value.avatar_id : null
  if (!playerId || !displayName || !avatarId) return null
  return { playerId, displayName, avatarId }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asString(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) throw new AdventurerUnavailableError()
  return value
}

function asCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
}

function asIso(value: unknown): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString()
  if (typeof value !== 'string') return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}
