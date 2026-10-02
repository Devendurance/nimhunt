import { copyCarry, type StageAdapter, type StageCarry, type StageId, type StageReport, type StageResult } from './contracts'
import { expeditionCarry, initialGemRunnerState, reduceExpedition, type GemRunnerState } from './model'

export type TranscriptEntry =
  | { readonly type: 'EXPEDITION_STARTED'; readonly carry: StageCarry }
  | { readonly type: 'STAGE_STARTED'; readonly stageId: StageId; readonly carry: StageCarry }
  | { readonly type: 'STAGE_ACTION'; readonly stageId: StageId; readonly actionIndex: number; readonly action: unknown }
  | { readonly type: 'STAGE_COMPLETED'; readonly stageId: StageId; readonly result: StageResult; readonly carryOut: StageCarry }
  | { readonly type: 'STAGE_FAILED'; readonly stageId: StageId; readonly carryOut: StageCarry }
  | { readonly type: 'STAGE_ADVANCED'; readonly fromStage: StageId; readonly toStage: StageId; readonly carry: StageCarry }
export interface GemRunnerEnvelope {
  readonly schema: 'angkor-v2-gem-runner/v1'; readonly version: 1; readonly mission: 'gem-runner'
  readonly entries: readonly TranscriptEntry[]; readonly snapshot: GemRunnerState
}
export interface AttachedStage<State, Action> { readonly state: State; readonly actionCount: number; dispatch(action: Action): State }
const clone = <T,>(value: T): T => structuredClone(value)
function jsonAction(value: unknown): void {
  const stack = new Set<object>()
  const visit = (v: unknown): boolean => {
    if (v === null || typeof v === 'string' || typeof v === 'boolean') return true
    if (typeof v === 'number') return Number.isFinite(v)
    if (typeof v !== 'object' || stack.has(v) || Object.getOwnPropertySymbols(v).length) return false
    if (!Array.isArray(v) && Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null) return false
    stack.add(v); const valid = Object.values(v).every(visit); stack.delete(v); return valid
  }
  if (!visit(value)) throw new Error('Stage actions must be plain serializable JSON')
}
/** Small local orchestrator. No stage registry, maps, rendering or production
 * contracts. The caller supplies exactly the current stage's adapter. */
export class GemRunnerRuntime {
  private current = initialGemRunnerState()
  private attached = false
  private entries: TranscriptEntry[] = [
    { type: 'EXPEDITION_STARTED', carry: expeditionCarry(this.current) },
    { type: 'STAGE_STARTED', stageId: this.current.currentStage, carry: expeditionCarry(this.current) },
  ]
  get state(): GemRunnerState { return this.current }
  get transcriptLength(): number { return this.entries.length }
  entriesSince(index: number): readonly TranscriptEntry[] { return clone(this.entries.slice(index)) }
  envelope(): GemRunnerEnvelope { return clone({ schema: 'angkor-v2-gem-runner/v1', version: 1, mission: 'gem-runner', entries: this.entries, snapshot: this.current }) }
  attachStage<State, Action>(adapter: StageAdapter<State, Action>): AttachedStage<State, Action> {
    if (this.current.status !== 'PLAYING' || adapter.definition.id !== this.current.currentStage || this.attached) throw new Error('Only the current unstarted stage can attach')
    const carry = expeditionCarry(this.current), stageId = adapter.definition.id
    let local = adapter.create(copyCarry(carry)), count = 0
    this.attached = true
    const report = (value: StageReport, actionCount: number): { state: GemRunnerState; boundary?: TranscriptEntry } => {
      let next = reduceExpedition(this.current, { type: 'STAGE_PROGRESS', stageId, progress: value.progress })
      if (next.status === 'FAILED') return { state: next, boundary: { type: 'STAGE_FAILED', stageId, carryOut: expeditionCarry(next) } }
      else if (value.status === 'FAILED') throw new Error('Failed stage report must have zero HP')
      else if (value.status === 'COMPLETE') {
        if (value.result.stageId !== stageId || value.result.hpRemaining !== value.progress.hp || value.result.stageGems !== value.progress.stageGems || value.result.expeditionGems !== value.progress.expeditionGems || value.result.completion.actionCount !== actionCount || stable(value.result.carriedItems) !== stable(value.progress.carriedItems)) throw new Error('Stage result does not match final progress')
        next = reduceExpedition(next, { type: 'STAGE_COMPLETED', result: value.result })
        return { state: next, boundary: { type: 'STAGE_COMPLETED', stageId, result: clone(next.stageResults.at(-1)!), carryOut: expeditionCarry(next) } }
      }
      return { state: next }
    }
    return {
      get state() { return local }, get actionCount() { return count },
      dispatch: (action: Action) => {
        if (this.current.status !== 'PLAYING' || this.current.currentStage !== stageId) return local
        if (!adapter.isAction(action)) throw new Error('Invalid stage action (reset/revive is not an expedition action)')
        jsonAction(action)
        const nextLocal = adapter.reduce(local, action), nextCount = count + 1
        const next = report(adapter.report(nextLocal, carry, nextCount), nextCount)
        local = nextLocal; count = nextCount; this.current = next.state
        this.entries.push({ type: 'STAGE_ACTION', stageId, actionIndex: count, action: clone(action) })
        if (next.boundary) this.entries.push(next.boundary)
        return local
      },
    }
  }
  continue(): GemRunnerState {
    const previous = this.current, next = reduceExpedition(previous, { type: 'CONTINUE' })
    if (next === previous) return previous
    const carry = expeditionCarry(next)
    this.entries.push({ type: 'STAGE_ADVANCED', fromStage: previous.currentStage, toStage: next.currentStage, carry: copyCarry(carry) }, { type: 'STAGE_STARTED', stageId: next.currentStage, carry: copyCarry(carry) })
    this.current = next; this.attached = false; return next
  }
}
export type StageFactory = (runtime: GemRunnerRuntime) => { dispatch(action: unknown): void }
export function stageFactory<State, Action>(adapter: StageAdapter<State, Action>): StageFactory {
  return runtime => { const stage = runtime.attachStage(adapter); return { dispatch: action => {
    if (!adapter.isAction(action)) throw new Error('Invalid transcript stage action')
    stage.dispatch(action)
  } } }
}
const stable = (value: unknown): string => JSON.stringify(value, (_key, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v)
/** Replays stage-owned actions through supplied real adapters, and verifies every
 * generated boundary/carry/result and final cumulative snapshot. Missing stage
 * implementations can have a start boundary, but cannot have gameplay actions. */
export function replayEnvelope(envelope: GemRunnerEnvelope, factories: Partial<Record<StageId, StageFactory>>): GemRunnerRuntime {
  if (envelope.schema !== 'angkor-v2-gem-runner/v1' || envelope.version !== 1 || envelope.mission !== 'gem-runner') throw new Error('Unsupported local Gem Runner envelope')
  const runtime = new GemRunnerRuntime()
  const compare = (from: number) => {
    runtime.entriesSince(from).forEach((entry, index) => {
      if (stable(entry) !== stable(envelope.entries[from + index])) throw new Error('Transcript boundary/action/carry mismatch')
    })
  }
  compare(0)
  let active: ReturnType<StageFactory> | undefined
  while (runtime.transcriptLength < envelope.entries.length) {
    const from = runtime.transcriptLength, entry = envelope.entries[from]
    if (entry.type === 'STAGE_ACTION' && entry.stageId === runtime.state.currentStage && runtime.state.status === 'PLAYING') {
      const factory = factories[runtime.state.currentStage]
      if (!factory) throw new Error('Stage gameplay adapter is not implemented')
      active ??= factory(runtime); active.dispatch(entry.action)
    } else if (entry.type === 'STAGE_ADVANCED' && runtime.state.status === 'TRANSITION') { runtime.continue(); active = undefined }
    else throw new Error('Unexpected stage boundary or stage order')
    if (runtime.transcriptLength === from) throw new Error('Transcript cannot advance a terminal stage')
    compare(from)
  }
  if (stable(runtime.state) !== stable(envelope.snapshot)) throw new Error('Expedition snapshot mismatch')
  return runtime
}
