import {
  V2_CHECKPOINT_CATCHING_UP,
  type V2Session,
} from '../../game/angkorV2Proof/session'

export function v2GameplayNotice(input: {
  readonly practice: boolean
  readonly error?: string
  readonly pendingCount: number
  readonly backpressured: boolean
}): string {
  if (input.error) return input.error
  if (input.practice) return 'Explore all three stages. Practice never creates a reward expedition.'
  if (input.backpressured) return 'Connection is slow — securing progress…'
  if (input.pendingCount >= V2_CHECKPOINT_CATCHING_UP) return 'Connection is catching up — progress is still secured.'
  return 'Progress saves automatically.'
}

export function v2ControlsLocked(input: {
  readonly loadedStage: string
  readonly stageId: string
  readonly canAct: boolean
  readonly error?: string
}): boolean {
  return input.loadedStage !== input.stageId || !input.canAct || Boolean(input.error)
}

export function v2CheckpointDebugEnabled(search = typeof window === 'undefined' ? '' : window.location.search): boolean {
  return new URLSearchParams(search).has('dev')
}

export function formatV2CheckpointMetrics(session: V2Session): string {
  const metrics = session.metrics
  const inFlight = metrics.inFlightSeqStart === null || metrics.inFlightSeqEnd === null
    ? 'none'
    : `${metrics.inFlightSeqStart}-${metrics.inFlightSeqEnd}`
  const rtt = metrics.rttMs === null ? '—' : `${metrics.rttMs}ms`
  return `RTT ${rtt} · pending ${metrics.pendingCount} · in-flight ${inFlight} · ack ${metrics.acknowledgedSeq} · ${metrics.backpressured ? 'BACKPRESSURE' : 'ok'}`
}
