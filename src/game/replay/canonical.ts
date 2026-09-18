import { Hash } from '@nimiq/core'
import type {
  ExpeditionActionBatch,
  ExpeditionBlueprint,
  ExpeditionCheckpoint,
  ExpeditionTranscript,
  ReplayAction,
  ReplayState,
  RewardClaimPayload,
} from './types.ts'

const encoder = new TextEncoder()

export function normalizeWallet(wallet: string): string {
  return wallet.replace(/\s+/g, '').toUpperCase()
}

export function serializeBlueprintHashPayload(blueprint: ExpeditionBlueprint): string {
  return JSON.stringify({
    rulesVersion: blueprint.rulesVersion,
    roomVersion: blueprint.roomVersion,
    blueprintVersion: blueprint.blueprintVersion,
    dayKey: blueprint.dayKey,
    mission: blueprint.mission,
    spawn: coordinate(blueprint.spawn),
    goblins: blueprint.goblins.map(goblin => ({
      id: goblin.id,
      spawn: coordinate(goblin.spawn),
      patrolRoute: goblin.patrolRoute.map(coordinate),
    })),
    gems: blueprint.gems.map(gem => ({ id: gem.id, x: gem.x, y: gem.y })),
    chests: blueprint.chests.map(chest => ({ id: chest.id, x: chest.x, y: chest.y, loot: chest.loot })),
    sword: blueprint.sword ? coordinate(blueprint.sword) : null,
    potion: blueprint.potion ? coordinate(blueprint.potion) : null,
    hazards: blueprint.hazards.map(hazard => ({ x: hazard.x, y: hazard.y, type: hazard.type })),
    boulders: blueprint.boulders.map(boulder => ({ id: boulder.id, x: boulder.x, y: boulder.y })),
    key: coordinate(blueprint.key),
    gate: coordinate(blueprint.gate),
    objective: coordinate(blueprint.objective),
    missionParameters: {
      gemTarget: blueprint.missionParameters.gemTarget,
      chestTarget: blueprint.missionParameters.chestTarget,
    },
    timedHazards: blueprint.timedHazards.map(hazard => ({
      id: hazard.id,
      x: hazard.x,
      y: hazard.y,
      type: hazard.type,
      trigger: hazard.trigger,
      delay: hazard.delay,
      triggerCells: (hazard.triggerCells ?? [{ x: hazard.x, y: hazard.y }]).map(coordinate),
    })),
  })
}

function serializeAction(action: ReplayAction): Record<string, unknown> {
  return action.type === 'MOVE'
    ? { seq: action.seq, type: action.type, direction: action.direction }
    : { seq: action.seq, type: action.type }
}

export function serializeTranscript(transcript: ExpeditionTranscript): string {
  return JSON.stringify({
    version: transcript.version,
    runId: transcript.runId,
    wallet: normalizeWallet(transcript.wallet),
    mission: transcript.mission,
    rulesVersion: transcript.rulesVersion,
    roomVersion: transcript.roomVersion,
    blueprintVersion: transcript.blueprintVersion,
    blueprintId: transcript.blueprintId,
    blueprintHash: transcript.blueprintHash,
    actions: transcript.actions.map(serializeAction),
  })
}

export function serializeReplayState(state: ReplayState): string {
  return JSON.stringify({
    seq: state.seq,
    mission: state.mission,
    rulesVersion: state.rulesVersion,
    roomVersion: state.roomVersion,
    blueprintVersion: state.blueprintVersion,
    blueprintId: state.blueprintId,
    blueprintHash: state.blueprintHash,
    player: coordinate(state.player),
    run: {
      hp: state.run.hp,
      gemsCollected: state.run.gemsCollected,
      collectedGemIds: [...state.run.collectedGemIds],
      chestsOpened: state.run.chestsOpened,
      openedChestIds: [...state.run.openedChestIds],
      missionStatus: state.run.missionStatus,
      runStatus: state.run.runStatus,
    },
    items: {
      hasSword: state.items.hasSword,
      swordPickedUp: state.items.swordPickedUp,
      potionConsumed: state.items.potionConsumed,
    },
    puzzle: {
      hasTempleKey: state.puzzle.hasTempleKey,
      gateState: state.puzzle.gateState,
      boulderPositions: state.puzzle.boulderPositions.map(boulder => ({ id: boulder.id, x: boulder.x, y: boulder.y })),
      objectiveReached: state.puzzle.objectiveReached,
    },
    chests: state.chests.map(chest => ({
      id: chest.id,
      x: chest.x,
      y: chest.y,
      loot: chest.loot,
      state: chest.state,
      resolved: chest.resolved,
    })),
    goblins: state.goblins.map(goblin => ({
      gridX: goblin.gridX,
      gridY: goblin.gridY,
      facing: goblin.facing,
      state: goblin.state,
      patrolIndex: goblin.patrolIndex,
      patrolDirection: goblin.patrolDirection,
    })),
    ...(state.collapsingBoulders && state.collapsingBoulders.length > 0 ? {
      collapsingBoulders: state.collapsingBoulders.map(b => ({
        id: b.id,
        state: b.state,
        triggeredAtTick: b.triggeredAtTick,
        elapsedTicks: b.elapsedTicks,
        targetTicks: b.targetTicks,
      })),
    } : {}),
  })
}

export function serializeCheckpoint(checkpoint: ExpeditionCheckpoint): string {
  return JSON.stringify({
    version: checkpoint.version,
    runId: checkpoint.runId,
    runChallenge: checkpoint.runChallenge,
    seq: checkpoint.seq,
    previousCheckpointHash: checkpoint.previousCheckpointHash,
    stateHash: checkpoint.stateHash,
    transcriptHash: checkpoint.transcriptHash,
  })
}

export function serializeActionBatch(batch: ExpeditionActionBatch): string {
  return JSON.stringify({
    version: batch.version,
    runId: batch.runId,
    previousCheckpointHash: batch.previousCheckpointHash,
    seqStart: batch.seqStart,
    seqEnd: batch.seqEnd,
    actions: batch.actions.map(serializeAction),
  })
}

export function serializeClaim(payload: RewardClaimPayload): string {
  const canonical: Record<string, string | number> = {
    version: payload.version,
    type: payload.type,
    claimId: payload.claimId,
    wallet: normalizeWallet(payload.wallet),
    runId: payload.runId,
    mission: payload.mission,
    dayKey: payload.dayKey,
    runChallenge: payload.runChallenge,
    transcriptHash: payload.transcriptHash,
    rulesVersion: payload.rulesVersion,
    roomVersion: payload.roomVersion,
    blueprintVersion: payload.blueprintVersion,
    blueprintId: payload.blueprintId,
    blueprintHash: payload.blueprintHash,
  }
  if (payload.vaultSealHash !== undefined) canonical.vaultSealHash = payload.vaultSealHash
  return JSON.stringify(canonical)
}

export function hashBlueprint(blueprint: ExpeditionBlueprint): string {
  return hashDomain('BLUEPRINT', serializeBlueprintHashPayload(blueprint))
}

export function hashTranscript(transcript: ExpeditionTranscript): string {
  return hashDomain('TRANSCRIPT', serializeTranscript(transcript))
}

export function hashReplayState(state: ReplayState): string {
  return hashDomain('REPLAY_STATE', serializeReplayState(state))
}

export function hashCheckpoint(checkpoint: ExpeditionCheckpoint): string {
  return hashDomain('CHECKPOINT', serializeCheckpoint(checkpoint))
}

export function hashActionBatch(batch: ExpeditionActionBatch): string {
  return hashDomain('ACTION_BATCH', serializeActionBatch(batch))
}

export function hashClaim(payload: RewardClaimPayload): string {
  return hashDomain('CLAIM', serializeClaim(payload))
}

function coordinate(value: { readonly x: number; readonly y: number }): { x: number; y: number } {
  return { x: value.x, y: value.y }
}

function hashDomain(domain: string, serialized: string): string {
  const digest = Hash.computeSha256(encoder.encode(`NIMHUNT:${domain}:v1\n${serialized}`))
  return Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('')
}
