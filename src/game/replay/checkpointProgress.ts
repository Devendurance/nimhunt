import type { CheckpointAcknowledgement, CheckpointProgress } from '../../domain/expeditionProof.js'
import type { ReplayState } from './types.js'

export function deriveCheckpointProgress(state: ReplayState, checkpointHash: string): CheckpointProgress {
  return {
    acknowledgedSeq: state.seq,
    checkpointHash,
    hp: state.run.hp,
    gemsCollected: state.run.gemsCollected,
    chestsOpened: state.run.chestsOpened,
    hasTempleKey: state.puzzle.hasTempleKey,
    objectiveReached: state.puzzle.objectiveReached,
    missionSatisfied: state.run.missionStatus === 'COMPLETE',
    dead: state.run.hp === 0,
  }
}

export function progressConflicts(local: CheckpointProgress, remote: CheckpointAcknowledgement): boolean {
  return local.acknowledgedSeq !== remote.acknowledgedSeq
    || local.checkpointHash !== remote.checkpointHash
    || local.hp !== remote.hp
    || local.gemsCollected !== remote.gemsCollected
    || local.chestsOpened !== remote.chestsOpened
    || local.hasTempleKey !== remote.hasTempleKey
    || local.objectiveReached !== remote.objectiveReached
    || local.missionSatisfied !== remote.missionSatisfied
    || local.dead !== remote.dead
}
