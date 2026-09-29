import type {
  AdventurerBlockedProfile,
  AdventurerRelationship,
  AdventurerSocialOverview,
} from '../../src/domain/adventurerSocial.js'
import type { StoredAdventurerSession } from './types.js'

export type AdventurerSocialStore = {
  getAllyCount(playerId: string): Promise<number>
  getRelationship(viewerId: string, targetId: string): Promise<AdventurerRelationship>
  getOverview(playerId: string): Promise<AdventurerSocialOverview>
  getBlocked(playerId: string): Promise<readonly AdventurerBlockedProfile[]>
  request(senderId: string, receiverId: string): Promise<{ readonly requestId: string }>
  accept(receiverId: string, requestId: string): Promise<void>
  decline(receiverId: string, requestId: string): Promise<void>
  cancel(senderId: string, requestId: string): Promise<void>
  remove(playerId: string, otherPlayerId: string): Promise<void>
  block(blockerId: string, blockedId: string): Promise<void>
  unblock(blockerId: string, blockedId: string): Promise<void>
}

export type AdventurerSocialService = {
  getAllyCount(playerId: string): Promise<number>
  getRelationship(viewer: StoredAdventurerSession, targetId: string): Promise<AdventurerRelationship>
  getOverview(session: StoredAdventurerSession): Promise<AdventurerSocialOverview>
  getBlocked(session: StoredAdventurerSession): Promise<readonly AdventurerBlockedProfile[]>
  request(session: StoredAdventurerSession, targetId: string): Promise<{ readonly requestId: string }>
  accept(session: StoredAdventurerSession, requestId: string): Promise<void>
  decline(session: StoredAdventurerSession, requestId: string): Promise<void>
  cancel(session: StoredAdventurerSession, requestId: string): Promise<void>
  remove(session: StoredAdventurerSession, otherPlayerId: string): Promise<void>
  block(session: StoredAdventurerSession, otherPlayerId: string): Promise<void>
  unblock(session: StoredAdventurerSession, otherPlayerId: string): Promise<void>
}

