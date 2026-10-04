import { hashBlueprint, hashCheckpoint, hashReplayState } from '../../src/game/replay/canonical.js'
import { CHECKPOINT_VERSION } from '../../src/game/replay/versions.js'
import type { ExpeditionCheckpoint } from '../../src/game/replay/types.js'
import type { DurableExpeditionRun } from './types.js'
import { isV2Blueprint, validV2Blueprint } from '../../src/game/angkorV2Proof/blueprint.js'
import { hashTranscript } from '../../src/game/replay/canonical.js'
import { replayActions } from '../../src/game/replay/engine.js'
import { reconstructActionsFromBatches } from './verify.js'

export function isRecoverableV2Run(run: DurableExpeditionRun): boolean {
  if (!isV2Blueprint(run.blueprint) || !validV2Blueprint(run.blueprint) || run.terminal) return false
  try {
    const actions = reconstructActionsFromBatches(run)
    const state = replayActions({ blueprint: run.blueprint, mission: run.mission, rulesVersion: run.blueprint.rulesVersion, roomVersion: run.blueprint.roomVersion }, actions)
    const transcriptHash = hashTranscript({ version: 2, runId: run.runId, wallet: run.wallet, mission: run.mission, rulesVersion: run.blueprint.rulesVersion, roomVersion: run.blueprint.roomVersion, blueprintVersion: run.blueprint.blueprintVersion, blueprintId: run.blueprint.blueprintId, blueprintHash: run.blueprint.blueprintHash, actions })
    return hashReplayState(state) === run.checkpoint.stateHash && hashReplayState(run.state) === run.checkpoint.stateHash
      && transcriptHash === run.checkpoint.transcriptHash && hashCheckpoint(run.checkpoint) === run.checkpointHash
      && run.checkpoint.runId === run.runId && run.checkpoint.runChallenge === run.runChallenge && state.seq === run.seq
  } catch { return false }
}

export function createInitialCheckpoint(
  runId: string,
  runChallenge: string,
  stateHash: string,
  transcriptHash: string,
): ExpeditionCheckpoint {
  const base: ExpeditionCheckpoint = {
    version: CHECKPOINT_VERSION,
    runId,
    runChallenge,
    seq: 0,
    previousCheckpointHash: null,
    stateHash,
    transcriptHash,
    checkpointHash: '',
  }
  return { ...base, checkpointHash: hashCheckpoint(base) }
}

export function isRecoverableInitialRun(run: DurableExpeditionRun): boolean {
  const state = run.state
  const checkpoint = run.checkpoint
  return run.blueprint.blueprintId === state.blueprintId
    && run.blueprint.blueprintHash === state.blueprintHash
    && run.blueprint.mission === run.mission
    && state.seq === 0
    && state.run.runStatus === 'PLAYING'
    && state.run.missionStatus === 'IN_PROGRESS'
    && checkpoint.runId === run.runId
    && checkpoint.runChallenge === run.runChallenge
    && checkpoint.seq === 0
    && checkpoint.previousCheckpointHash === null
    && checkpoint.stateHash === run.initialStateHash
    && checkpoint.transcriptHash === run.initialTranscriptHash
    && checkpoint.checkpointHash === run.initialCheckpointHash
    && checkpoint.checkpointHash === run.checkpointHash
    && hashReplayState(state) === run.initialStateHash
    && hashCheckpoint(checkpoint) === checkpoint.checkpointHash
    && hashBlueprint(run.blueprint) === run.blueprint.blueprintHash
}
