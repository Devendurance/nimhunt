import { randomUUID } from 'node:crypto'
import type {
  AdventurerAllyRequest,
  AdventurerBlockedProfile,
  AdventurerRelationship,
  AdventurerSocialOverview,
  AdventurerSocialProfile,
} from '../../src/domain/adventurerSocial.js'
import { AdventurerSocialError } from './errors.js'
import type { AdventurerSocialStore } from './socialTypes.js'

const MAX_ALLIES = 100
const MAX_OUTGOING = 25
const MAX_INCOMING = 25

type MemorySocialRequest = AdventurerAllyRequest & {
  readonly senderId: string
  readonly receiverId: string
  status: 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'CANCELLED'
}

export function createMemoryAdventurerSocialStore(
  getProfile: (playerId: string) => Promise<AdventurerSocialProfile | null> | AdventurerSocialProfile | null,
): AdventurerSocialStore & {
  readonly requests: readonly MemorySocialRequest[]
  readonly allies: readonly (readonly [string, string])[]
  readonly blocks: readonly (readonly [string, string])[]
} {
  const requests = new Map<string, MemorySocialRequest>()
  const allies = new Set<string>()
  const blocks = new Map<string, string>()

  const store: AdventurerSocialStore & {
    readonly requests: readonly MemorySocialRequest[]
    readonly allies: readonly (readonly [string, string])[]
    readonly blocks: readonly (readonly [string, string])[]
  } = {
    get requests() { return [...requests.values()] },
    get allies() { return [...allies].map(pair => pair.split(':') as [string, string]) },
    get blocks() { return [...blocks.keys()].map(pair => pair.split(':') as [string, string]) },

    async getAllyCount(playerId) {
      return [...allies].filter(pair => pair.startsWith(`${playerId}:`) || pair.endsWith(`:${playerId}`)).length
    },

    async getRelationship(viewerId, targetId): Promise<AdventurerRelationship> {
      if (!await getProfile(targetId)) return { state: 'UNAVAILABLE', requestId: null }
      if (blocks.has(blockKey(targetId, viewerId))) return { state: 'UNAVAILABLE', requestId: null }
      if (blocks.has(blockKey(viewerId, targetId))) return { state: 'BLOCKED_BY_ME', requestId: null }
      if (allies.has(pairKey(viewerId, targetId))) return { state: 'ALLY', requestId: null }
      const pending = findPendingBetween(requests, viewerId, targetId)
      if (!pending) return { state: 'NONE', requestId: null }
      return {
        state: pending.senderId === viewerId ? 'OUTGOING_PENDING' : 'INCOMING_PENDING',
        requestId: pending.requestId,
      }
    },

    async getOverview(playerId): Promise<AdventurerSocialOverview> {
      const incoming = [...requests.values()]
        .filter(request => request.receiverId === playerId && request.status === 'PENDING')
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      const incomingRequests: AdventurerAllyRequest[] = []
      for (const request of incoming) {
        const sender = await getProfile(request.senderId)
        if (sender) incomingRequests.push({ ...request, playerId: sender.playerId, displayName: sender.displayName, avatarId: sender.avatarId })
      }
      const allyProfiles: AdventurerSocialProfile[] = []
      for (const pair of [...allies].filter(pair => pair.startsWith(`${playerId}:`) || pair.endsWith(`:${playerId}`))) {
        const otherId = pair.split(':')[0] === playerId ? pair.split(':')[1] : pair.split(':')[0]
        if (!otherId) continue
        const other = await getProfile(otherId)
        if (other) allyProfiles.push(other)
      }
      return {
        allyCount: allyProfiles.length,
        incomingPendingCount: incoming.length,
        outgoingPendingCount: [...requests].filter(([, request]) => request.senderId === playerId && request.status === 'PENDING').length,
        incomingRequests,
        allies: allyProfiles,
      }
    },

    async getBlocked(playerId): Promise<readonly AdventurerBlockedProfile[]> {
      const blocked: AdventurerBlockedProfile[] = []
      for (const [key, blockedAt] of blocks) {
        const [blockerId, blockedId] = key.split(':')
        if (blockerId !== playerId || !blockedId) continue
        const profile = await getProfile(blockedId)
        if (profile) blocked.push({ ...profile, blockedAt })
      }
      return blocked.sort((left, right) => right.blockedAt.localeCompare(left.blockedAt))
    },

    async request(senderId, receiverId) {
      if (!await getProfile(receiverId)) throw new AdventurerSocialError('SOCIAL_TARGET_UNAVAILABLE')
      if (blocks.has(blockKey(senderId, receiverId)) || blocks.has(blockKey(receiverId, senderId))) throw new AdventurerSocialError('SOCIAL_TARGET_UNAVAILABLE')
      if (allies.has(pairKey(senderId, receiverId))) throw new AdventurerSocialError('SOCIAL_ALREADY_ALLY')
      const existing = findPendingBetween(requests, senderId, receiverId)
      if (existing) throw new AdventurerSocialError(existing.senderId === senderId ? 'SOCIAL_REQUEST_PENDING' : 'SOCIAL_INCOMING_REQUEST_EXISTS')
      if ([...requests.values()].filter(request => request.senderId === senderId && request.status === 'PENDING').length >= MAX_OUTGOING) throw new AdventurerSocialError('SOCIAL_OUTGOING_CAP_REACHED')
      if ([...requests.values()].filter(request => request.receiverId === receiverId && request.status === 'PENDING').length >= MAX_INCOMING) throw new AdventurerSocialError('SOCIAL_INCOMING_CAP_REACHED')
      const request: MemorySocialRequest = {
        requestId: randomUUID(),
        playerId: receiverId,
        displayName: '',
        avatarId: '',
        createdAt: new Date().toISOString(),
        senderId,
        receiverId,
        status: 'PENDING',
      }
      requests.set(request.requestId, request)
      return { requestId: request.requestId }
    },

    async accept(receiverId, requestId) {
      const request = requests.get(requestId)
      if (!request || request.status !== 'PENDING') throw new AdventurerSocialError('SOCIAL_REQUEST_STALE')
      if (request.receiverId !== receiverId) throw new AdventurerSocialError('SOCIAL_UNAUTHORIZED_ACTION')
      if (blocks.has(blockKey(request.senderId, request.receiverId)) || blocks.has(blockKey(request.receiverId, request.senderId))) throw new AdventurerSocialError('SOCIAL_TARGET_UNAVAILABLE')
      if (await store.getAllyCount(request.senderId) >= MAX_ALLIES || await store.getAllyCount(request.receiverId) >= MAX_ALLIES) throw new AdventurerSocialError('SOCIAL_ALLY_CAP_REACHED')
      allies.add(pairKey(request.senderId, request.receiverId))
      requests.set(requestId, { ...request, status: 'ACCEPTED' })
    },

    async decline(receiverId, requestId) {
      const request = requirePending(requests, requestId)
      if (request.receiverId !== receiverId) throw new AdventurerSocialError('SOCIAL_UNAUTHORIZED_ACTION')
      requests.set(requestId, { ...request, status: 'DECLINED' })
    },

    async cancel(senderId, requestId) {
      const request = requirePending(requests, requestId)
      if (request.senderId !== senderId) throw new AdventurerSocialError('SOCIAL_UNAUTHORIZED_ACTION')
      requests.set(requestId, { ...request, status: 'CANCELLED' })
    },

    async remove(playerId, otherPlayerId) {
      const key = pairKey(playerId, otherPlayerId)
      if (!allies.delete(key)) throw new AdventurerSocialError('SOCIAL_NOT_ALLY')
    },

    async block(blockerId, blockedId) {
      if (!await getProfile(blockedId)) throw new AdventurerSocialError('SOCIAL_TARGET_UNAVAILABLE')
      if (blockerId === blockedId) throw new AdventurerSocialError('SOCIAL_SELF_ACTION')
      allies.delete(pairKey(blockerId, blockedId))
      for (const [id, request] of requests) {
        if (request.status === 'PENDING' && ((request.senderId === blockerId && request.receiverId === blockedId) || (request.senderId === blockedId && request.receiverId === blockerId))) {
          requests.set(id, { ...request, status: 'CANCELLED' })
        }
      }
      blocks.set(blockKey(blockerId, blockedId), new Date().toISOString())
    },

    async unblock(blockerId, blockedId) {
      if (!blocks.delete(blockKey(blockerId, blockedId))) throw new AdventurerSocialError('SOCIAL_NOT_BLOCKER')
    },
  }
  return store
}

function requirePending(requests: ReadonlyMap<string, MemorySocialRequest>, requestId: string): MemorySocialRequest {
  const request = requests.get(requestId)
  if (!request || request.status !== 'PENDING') throw new AdventurerSocialError('SOCIAL_REQUEST_STALE')
  return request
}

function findPendingBetween(requests: ReadonlyMap<string, MemorySocialRequest>, left: string, right: string): MemorySocialRequest | null {
  return [...requests.values()].find(request => request.status === 'PENDING' && ((request.senderId === left && request.receiverId === right) || (request.senderId === right && request.receiverId === left))) ?? null
}

function pairKey(left: string, right: string): string {
  return left < right ? `${left}:${right}` : `${right}:${left}`
}

function blockKey(blocker: string, blocked: string): string {
  return `${blocker}:${blocked}`
}
