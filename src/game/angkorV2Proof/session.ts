import type { CheckpointAcknowledgement, CheckpointRequest } from '../../domain/expeditionProof'
import type { ReplayState } from '../replay/types'
import { advanceRun } from '../replay/engine'
import { hashReplayState } from '../replay/canonical'
import { V2_MAX_CHECKPOINT_BATCH_ACTIONS } from '../replay/versions.js'
import type { LocalAction, V2Action } from './model'

export interface SessionOptions {
  initial: ReplayState; runId?: string; checkpointHash?: string
  send?: (request: CheckpointRequest) => Promise<CheckpointAcknowledgement>
}

export interface V2CheckpointMetrics {
  readonly rttMs: number | null
  readonly pendingCount: number
  readonly inFlightSeqStart: number | null
  readonly inFlightSeqEnd: number | null
  readonly acknowledgedSeq: number
  readonly backpressured: boolean
}

/** Version-scoped V2 transport. Legacy remains 8 elsewhere. */
export const V2_CHECKPOINT_BATCH_ACTIONS = V2_MAX_CHECKPOINT_BATCH_ACTIONS
export const V2_CHECKPOINT_FLUSH_THRESHOLD = 16
export const V2_CHECKPOINT_HIGH_WATER = 128
export const V2_CHECKPOINT_CATCHING_UP = 80

/** Presentation may predict reducers, but only server acknowledgements advance
 * reward proof. A lost reply retries the identical batch; no state/result POST. */
export class V2Session {
  state: ReplayState
  acknowledgedSeq: number
  checkpointHash: string
  error = ''
  syncing = false
  private pending: V2Action[] = []
  private hashes = new Map<number, string>()
  private flight?: Promise<void>
  private inFlightRequest?: CheckpointRequest
  private lastRttMs: number | null = null
  private listeners = new Set<() => void>()
  readonly options: SessionOptions
  constructor(options: SessionOptions) {
    this.options = options
    if (!options.initial.angkorV2) throw new Error('V2_SESSION_REQUIRED')
    this.state = structuredClone(options.initial); this.acknowledgedSeq = this.state.seq; this.checkpointHash = options.checkpointHash ?? ''
  }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private publish() { this.listeners.forEach(f => f()) }
  /** Number of locally accepted actions not yet acknowledged by the server. */
  get pendingCount(): number { return this.pending.length }
  /** True only at the bounded high-water mark; fatal sync errors are exposed via error. */
  get isBackpressured(): boolean { return Boolean(this.options.send && !this.error && this.pending.length >= V2_CHECKPOINT_HIGH_WATER) }
  get isCatchingUp(): boolean {
    return Boolean(this.options.send && !this.error && !this.isBackpressured && this.pending.length >= V2_CHECKPOINT_CATCHING_UP)
  }
  get canAct(): boolean {
    return !this.error && !this.isBackpressured && this.state.angkorV2!.expedition.status === 'PLAYING'
  }
  get metrics(): V2CheckpointMetrics {
    const actions = this.inFlightRequest?.actions
    return {
      rttMs: this.lastRttMs,
      pendingCount: this.pending.length,
      inFlightSeqStart: actions?.[0]?.seq ?? null,
      inFlightSeqEnd: actions?.at(-1)?.seq ?? null,
      acknowledgedSeq: this.acknowledgedSeq,
      backpressured: this.isBackpressured,
    }
  }
  dispatch(action: LocalAction): unknown {
    if (!this.canAct) return this.state.angkorV2!.local
    const e = this.state.angkorV2!.expedition
    this.accept(action.type === 'MOVE' ? { seq: this.state.seq + 1, type: 'V2_MOVE', stageId: e.currentStage, direction: action.direction }
      : { seq: this.state.seq + 1, type: 'V2_TICK', stageId: e.currentStage })
    return this.state.angkorV2!.local
  }
  private accept(action: V2Action): void {
    const next = advanceRun(this.state, action)
    if (!next.accepted) { this.error = 'Expedition synchronization stopped. Reload to restore the last server checkpoint.'; this.publish(); return }
    this.state = next.state
    if (this.options.send) { this.pending.push(action); this.hashes.set(action.seq, hashReplayState(next.state)) }
    else this.acknowledgedSeq = this.state.seq
    this.publish()
    if (this.pending.length >= V2_CHECKPOINT_FLUSH_THRESHOLD || this.state.angkorV2!.expedition.status !== 'PLAYING') void this.flush().catch(() => undefined)
  }
  async continue(): Promise<void> {
    await this.flush()
    if (this.error || this.state.angkorV2!.expedition.status !== 'TRANSITION') return
    this.accept({ seq: this.state.seq + 1, type: 'V2_CONTINUE', stageId: this.state.angkorV2!.expedition.currentStage })
    await this.flush()
  }
  async flush(): Promise<void> {
    if (!this.options.send) return
    if (this.flight) {
      await this.flight
      if (!this.error && (this.inFlightRequest || this.pending.length)) return this.flush()
      return
    }
    if (!this.inFlightRequest && !this.pending.length) return
    const work = this.drain()
    this.flight = work
    try { await work }
    finally { if (this.flight === work) this.flight = undefined }
    if (!this.error && (this.inFlightRequest || this.pending.length)) return this.flush()
  }
  private nextRequest(): CheckpointRequest | undefined {
    if (this.inFlightRequest) return this.inFlightRequest
    if (!this.pending.length || !this.options.runId) return undefined
    return {
      runId: this.options.runId,
      previousCheckpointHash: this.checkpointHash,
      actions: this.pending.slice(0, V2_CHECKPOINT_BATCH_ACTIONS),
    }
  }
  private async drain(): Promise<void> {
    while (!this.error && this.options.send && (this.inFlightRequest || this.pending.length)) {
      const request = this.nextRequest()
      if (!request) return
      this.inFlightRequest = request
      this.syncing = true
      this.publish()
      try {
        const started = Date.now()
        const ack = await this.options.send(request)
        this.lastRttMs = Date.now() - started
        if (ack.runId !== this.options.runId || ack.previousCheckpointHash !== request.previousCheckpointHash || ack.seqStart !== request.actions[0].seq
          || ack.seqEnd !== request.actions.at(-1)!.seq || ack.acknowledgedSeq !== ack.seqEnd || ack.stateHash !== this.hashes.get(ack.seqEnd)) {
          this.error = 'The server checkpoint disagrees with this expedition. Reload to restore authoritative progress.'
          throw new Error('CHECKPOINT_MISMATCH')
        }
        this.checkpointHash = ack.checkpointHash; this.acknowledgedSeq = ack.seqEnd
        this.pending.splice(0, request.actions.length); request.actions.forEach(a => this.hashes.delete(a.seq))
        this.inFlightRequest = undefined
      } finally { this.syncing = false; this.publish() }
    }
  }
}
