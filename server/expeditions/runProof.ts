import { hashBlueprint, hashCheckpoint, hashReplayState } from '../../src/game/replay/canonical.ts'
import { CHECKPOINT_VERSION } from '../../src/game/replay/versions.ts'
import type { ExpeditionCheckpoint } from '../../src/game/replay/types.ts'
import type { DurableExpeditionRun } from './types.ts'

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
