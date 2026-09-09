import { describe, expect, it } from 'vitest'
import {
  hashActionBatch,
  hashBlueprint,
  hashCheckpoint,
  hashClaim,
  hashReplayState,
  hashTranscript,
  serializeTranscript,
} from './canonical'
import type {
  ExpeditionActionBatch,
  ExpeditionBlueprint,
  ExpeditionCheckpoint,
  ExpeditionTranscript,
  ReplayState,
  RewardClaimPayload,
} from './types'

const blueprint: ExpeditionBlueprint = {
  rulesVersion: 'nimhunt-rules-v1',
  roomVersion: 'angkor-room-01-v1',
  blueprintVersion: 'angkor-blueprint-v1',
  dayKey: '2026-09-09',
  mission: 'gem-runner',
  blueprintId: 'blueprint-a',
  blueprintHash: 'a'.repeat(64),
  status: 'PUBLISHED',
  storedCanonicalJson: '{"not":"hashed"}',
  createdAt: '2026-09-09T00:00:00.000Z',
  updatedAt: '2026-09-09T00:00:00.000Z',
  spawn: { x: 3, y: 3 },
  goblins: [{ id: 'goblin-1', spawn: { x: 7, y: 4 }, patrolRoute: [{ x: 7, y: 4 }, { x: 7, y: 5 }] }],
  gems: [{ id: 'gem-1', x: 2, y: 3 }],
  chests: [{ id: 'chest-1', x: 1, y: 2, loot: 'GEMS' }],
  sword: { x: 1, y: 6 },
  potion: { x: 2, y: 1 },
  hazards: [{ x: 5, y: 3, type: 'SPIKES' }],
  boulders: [{ id: 'boulder-1', x: 4, y: 6 }],
  key: { x: 3, y: 6 },
  gate: { x: 8, y: 3 },
  objective: { x: 9, y: 3 },
  missionParameters: { gemTarget: 6, chestTarget: 4 },
  timedHazards: [],
}

const transcript: ExpeditionTranscript = {
  version: 1,
  runId: 'run-1',
  wallet: 'NQ12 AB CD',
  mission: 'gem-runner',
  rulesVersion: 'nimhunt-rules-v1',
  roomVersion: 'angkor-room-01-v1',
  blueprintVersion: 'angkor-blueprint-v1',
  blueprintId: 'blueprint-a',
  blueprintHash: 'a'.repeat(64),
  actions: [{ seq: 1, type: 'MOVE', direction: 'RIGHT' }],
}

const replayState: ReplayState = {
  seq: 1,
  blueprint,
  mission: 'gem-runner',
  rulesVersion: 'nimhunt-rules-v1',
  roomVersion: 'angkor-room-01-v1',
  blueprintVersion: 'angkor-blueprint-v1',
  blueprintId: 'blueprint-a',
  blueprintHash: 'a'.repeat(64),
  player: { x: 4, y: 3 },
  run: {
    hp: 100,
    gemsCollected: 0,
    collectedGemIds: [],
    chestsOpened: 0,
    openedChestIds: [],
    missionStatus: 'IN_PROGRESS',
    runStatus: 'PLAYING',
  },
  items: { hasSword: false, swordPickedUp: false, potionConsumed: false },
  puzzle: {
    hasTempleKey: false,
    gateState: 'LOCKED',
    boulderPositions: [{ id: 'boulder-1', x: 4, y: 6 }],
    objectiveReached: false,
  },
  chests: [{ id: 'chest-1', x: 1, y: 2, loot: 'GEMS', state: 'CLOSED', resolved: false }],
  goblins: [{ gridX: 7, gridY: 5, facing: 'DOWN', state: 'PATROL', patrolIndex: 1, patrolDirection: 1 }],
}

const checkpoint: ExpeditionCheckpoint = {
  version: 1,
  runId: 'run-1',
  runChallenge: 'run-challenge',
  seq: 1,
  previousCheckpointHash: '0'.repeat(64),
  stateHash: 'b'.repeat(64),
  transcriptHash: 'c'.repeat(64),
  checkpointHash: 'd'.repeat(64),
}

const actionBatch: ExpeditionActionBatch = {
  version: 1,
  runId: 'run-1',
  previousCheckpointHash: '0'.repeat(64),
  seqStart: 1,
  seqEnd: 1,
  actions: [{ seq: 1, type: 'MOVE', direction: 'RIGHT' }],
}

const claim: RewardClaimPayload = {
  version: 1,
  type: 'NIMHUNT_REWARD_CLAIM',
  claimId: 'claim-1',
  wallet: 'NQ12 AB CD',
  runId: 'run-1',
  mission: 'gem-runner',
  dayKey: '2026-09-09',
  runChallenge: 'run-challenge',
  transcriptHash: 'c'.repeat(64),
  rulesVersion: 'nimhunt-rules-v1',
  roomVersion: 'angkor-room-01-v1',
  blueprintVersion: 'angkor-blueprint-v1',
  blueprintId: 'blueprint-a',
  blueprintHash: 'a'.repeat(64),
}

describe('canonical proof serialization', () => {
  it('hashes equivalent blueprint payloads independent of object key order', () => {
    const reordered = {
      ...blueprint,
      missionParameters: { chestTarget: 4, gemTarget: 6 },
      spawn: { y: 3, x: 3 },
      goblins: [{ ...blueprint.goblins[0], spawn: { y: 4, x: 7 }, patrolRoute: [{ y: 4, x: 7 }, { y: 5, x: 7 }] }],
    }

    expect(hashBlueprint(blueprint)).toBe(hashBlueprint(reordered))
  })

  it('excludes blueprint identity, lifecycle, timestamps, stored JSON, and self-hash', () => {
    const changedMetadata: ExpeditionBlueprint = {
      ...blueprint,
      blueprintId: 'blueprint-b',
      blueprintHash: 'b'.repeat(64),
      status: 'DRAFT',
      storedCanonicalJson: '{"changed":true}',
      createdAt: '2026-09-10T00:00:00.000Z',
      updatedAt: '2026-09-10T00:01:00.000Z',
    }

    expect(hashBlueprint(blueprint)).toBe(hashBlueprint(changedMetadata))
  })

  it('includes normalized wallet and complete bindings in transcript hash', () => {
    const compactWallet = { ...transcript, wallet: 'NQ12ABCD' }
    const changedDirection = { ...transcript, actions: [{ seq: 1, type: 'MOVE' as const, direction: 'UP' as const }] }

    expect(hashTranscript(transcript)).toBe(hashTranscript(compactWallet))
    expect(hashTranscript(transcript)).not.toBe(hashTranscript(changedDirection))
    expect(hashTranscript({ ...transcript, blueprintId: 'blueprint-b' })).not.toBe(hashTranscript(transcript))
  })

  it('serializes the transcript in fixed order without a trailing newline', () => {
    expect(serializeTranscript(transcript)).toBe(
      '{"version":1,"runId":"run-1","wallet":"NQ12ABCD","mission":"gem-runner","rulesVersion":"nimhunt-rules-v1","roomVersion":"angkor-room-01-v1","blueprintVersion":"angkor-blueprint-v1","blueprintId":"blueprint-a","blueprintHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","actions":[{"seq":1,"type":"MOVE","direction":"RIGHT"}]}',
    )
    expect(serializeTranscript(transcript).endsWith('\n')).toBe(false)
  })

  it('keeps proof structures in distinct hash domains', () => {
    expect(hashReplayState(replayState)).not.toBe(hashTranscript(transcript))
    expect(hashCheckpoint(checkpoint)).not.toBe(hashActionBatch(actionBatch))
    expect(hashClaim(claim)).not.toBe(hashTranscript(transcript))
  })

  it('changes checkpoint, action-batch, and claim hashes when bound data changes', () => {
    expect(hashCheckpoint({ ...checkpoint, seq: 2 })).not.toBe(hashCheckpoint(checkpoint))
    expect(hashActionBatch({ ...actionBatch, actions: [{ seq: 1, type: 'MOVE', direction: 'LEFT' }] })).not.toBe(hashActionBatch(actionBatch))
    expect(hashClaim({ ...claim, transcriptHash: 'e'.repeat(64) })).not.toBe(hashClaim(claim))
  })
})
