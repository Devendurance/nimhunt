import {
  AdventurerSocialError,
  AdventurerUnavailableError,
} from './errors.js'
import type { AdventurerSocialService, AdventurerSocialStore } from './socialTypes.js'

export function createAdventurerSocialService(store: AdventurerSocialStore): AdventurerSocialService {
  let mutationTail = Promise.resolve()
  const runExclusive = <T>(operation: () => Promise<T>): Promise<T> => {
    const next = mutationTail.then(operation)
    mutationTail = next.then(() => undefined, () => undefined)
    return next
  }

  return {
    getAllyCount(playerId) {
      requireUuid(playerId)
      return store.getAllyCount(playerId)
    },

    async getRelationship(session, targetId) {
      requireUuid(targetId)
      if (session.playerId === targetId) return { state: 'SELF', requestId: null }
      return store.getRelationship(session.playerId, targetId)
    },

    getOverview(session) {
      return store.getOverview(session.playerId)
    },

    request(session, targetId) {
      return runExclusive(async () => {
        requireOtherPlayer(session.playerId, targetId)
        return store.request(session.playerId, targetId)
      })
    },

    accept(session, requestId) {
      return runExclusive(async () => {
        requireUuid(requestId)
        return store.accept(session.playerId, requestId)
      })
    },

    decline(session, requestId) {
      return runExclusive(async () => {
        requireUuid(requestId)
        return store.decline(session.playerId, requestId)
      })
    },

    cancel(session, requestId) {
      return runExclusive(async () => {
        requireUuid(requestId)
        return store.cancel(session.playerId, requestId)
      })
    },

    remove(session, otherPlayerId) {
      return runExclusive(async () => {
        requireOtherPlayer(session.playerId, otherPlayerId)
        return store.remove(session.playerId, otherPlayerId)
      })
    },

    block(session, otherPlayerId) {
      return runExclusive(async () => {
        requireOtherPlayer(session.playerId, otherPlayerId)
        return store.block(session.playerId, otherPlayerId)
      })
    },

    unblock(session, otherPlayerId) {
      return runExclusive(async () => {
        requireOtherPlayer(session.playerId, otherPlayerId)
        return store.unblock(session.playerId, otherPlayerId)
      })
    },
  }
}

export function requireSocialService(service: AdventurerSocialService | null): AdventurerSocialService {
  if (!service) throw new AdventurerUnavailableError()
  return service
}

function requireOtherPlayer(playerId: string, targetId: string): void {
  requireUuid(targetId)
  if (playerId === targetId) throw new AdventurerSocialError('SOCIAL_SELF_ACTION')
}

function requireUuid(value: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new AdventurerSocialError('SOCIAL_INVALID_PLAYER')
  }
}

export function isSocialErrorCode(value: unknown): value is import('../../src/domain/adventurerSocial.js').AdventurerSocialErrorCode {
  return value === 'SOCIAL_OUTGOING_CAP_REACHED'
    || value === 'SOCIAL_INCOMING_CAP_REACHED'
    || value === 'SOCIAL_ALLY_CAP_REACHED'
    || value === 'SOCIAL_ALREADY_ALLY'
    || value === 'SOCIAL_REQUEST_PENDING'
    || value === 'SOCIAL_INCOMING_REQUEST_EXISTS'
    || value === 'SOCIAL_TARGET_UNAVAILABLE'
    || value === 'SOCIAL_REQUEST_STALE'
    || value === 'SOCIAL_REQUEST_NOT_FOUND'
    || value === 'SOCIAL_UNAUTHORIZED_ACTION'
    || value === 'SOCIAL_SELF_ACTION'
    || value === 'SOCIAL_NOT_ALLY'
    || value === 'SOCIAL_NOT_BLOCKER'
    || value === 'SOCIAL_INVALID_PLAYER'
    || value === 'SOCIAL_UNAVAILABLE'
}
