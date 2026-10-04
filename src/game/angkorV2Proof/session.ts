import type { CheckpointAcknowledgement, CheckpointRequest } from '../../domain/expeditionProof'
import type { ReplayState } from '../replay/types'
import { advanceRun } from '../replay/engine'
import { hashReplayState } from '../replay/canonical'
import type { LocalAction, V2Action } from './model'

export interface SessionOptions {
  initial: ReplayState; runId?: string; checkpointHash?: string
  send?: (request: CheckpointRequest) => Promise<CheckpointAcknowledgement>
}

/** The server protocol remains deliberately small and ordered. The client
 * keeps a larger bounded journal so normal network latency does not become a
 * gameplay lock, while a genuinely stalled connection still fails closed. */
export const V2_CHECKPOINT_BATCH_ACTIONS = 8
export const V2_CHECKPOINT_FLUSH_THRESHOLD = V2_CHECKPOINT_BATCH_ACTIONS
export const V2_CHECKPOINT_HIGH_WATER = 48

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
  get canAct(): boolean {
    return !this.error && !this.isBackpressured && this.state.angkorV2!.expedition.status === 'PLAYING'
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
    if (!this.options.send || !this.pending.length) return
    if (this.flight) { await this.flight; if (this.pending.length) return this.flush(); return }
    const actions = this.pending.slice(0, V2_CHECKPOINT_BATCH_ACTIONS), previousCheckpointHash = this.checkpointHash
    this.syncing = true; this.publish()
    this.flight = (async () => {
      try {
        const ack = await this.options.send!({ runId: this.options.runId!, previousCheckpointHash, actions })
        if (ack.runId !== this.options.runId || ack.previousCheckpointHash !== previousCheckpointHash || ack.seqStart !== actions[0].seq
          || ack.seqEnd !== actions.at(-1)!.seq || ack.acknowledgedSeq !== ack.seqEnd || ack.stateHash !== this.hashes.get(ack.seqEnd)) {
          this.error = 'The server checkpoint disagrees with this expedition. Reload to restore authoritative progress.'
          throw new Error('CHECKPOINT_MISMATCH')
        }
        this.checkpointHash = ack.checkpointHash; this.acknowledgedSeq = ack.seqEnd
        this.pending.splice(0, actions.length); actions.forEach(a => this.hashes.delete(a.seq))
      } finally { this.flight = undefined; this.syncing = false; this.publish() }
    })()
    await this.flight
    if (this.pending.length) await this.flush()
  }
}
