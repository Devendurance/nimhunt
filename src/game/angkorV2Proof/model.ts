import { sha256 } from '@noble/hashes/sha2.js'
import type { Direction, MissionType } from '../replay/types.js'
import * as gem from '../gemRunner/model.js'
import * as chest from '../chestHunter/model.js'
import * as vault from '../vaultBreaker/model.js'
import { outerRuinsAdapter } from '../gemRunner/outerRuinsAdapter.js'
import { overgrownTempleAdapter } from '../gemRunner/overgrownTempleAdapter.js'
import { innerSanctuaryAdapter } from '../gemRunner/innerSanctuaryAdapter.js'
import { lostCourtyardAdapter, forgottenGalleriesAdapter, royalTreasuryAdapter } from '../chestHunter/adapters.js'
import { templeApproachAdapter, ancientMechanismAdapter, innerVaultAdapter } from '../vaultBreaker/adapters.js'

export const V2_RULES = 'nimhunt-angkor-v2-rules-v1' as const
export const V2_ROOM = 'angkor-nine-stages-v1' as const
export const V2_BLUEPRINT = 'angkor-expedition-blueprint-v1' as const
export const V2_TRANSCRIPT = 2 as const
export const V2_ACTION_LIMIT = 30_000
export const V2_TICK_MS = 150
export type LocalAction = { type: 'MOVE'; direction: Direction } | { type: 'TICK' }
export type V2Action =
  | { readonly seq: number; readonly type: 'V2_MOVE'; readonly stageId: string; readonly direction: Direction }
  | { readonly seq: number; readonly type: 'V2_TICK' | 'V2_CONTINUE'; readonly stageId: string }
export type Expedition = gem.GemRunnerState | chest.ChestHunterState | vault.VaultBreakerState
interface StageView { player: { x: number; y: number }; tick: number; hp: number; status: 'playing' | 'complete' | 'failed' }
export interface V2State {
  readonly version: 2
  readonly seq: number
  readonly mission: MissionType
  readonly expedition: Expedition
  /** Trusted reducer-owned JSON; never accepted in an action/request. */
  readonly local: unknown
  readonly stageActionCount: number
  readonly stageMoveCount: number
  readonly movesSinceTick: number
  readonly totalTicks: number
}
interface ErasedAdapter {
  id: string
  create(carry: unknown): unknown
  reduce(state: unknown, action: LocalAction): unknown
  report(state: unknown, carry: unknown, count: number): unknown
}
/** Type erasure is confined to the internal registry. Each state/carry comes
 * exclusively from the matching factory and mission's existing carry whitelist. */
function adapter<S, C, R>(input: {
  definition: { id: string }; create(carry: C): S; reduce(state: S, action: LocalAction): S
  report(state: S, carry: C, count: number): R
}): ErasedAdapter {
  return { id: input.definition.id, create: c => input.create(c as C),
    reduce: (s, a) => input.reduce(s as S, a), report: (s, c, n) => input.report(s as S, c as C, n) }
}
const adapters = {
  'gem-runner': [adapter(outerRuinsAdapter), adapter(overgrownTempleAdapter), adapter(innerSanctuaryAdapter)],
  'chest-hunter': [adapter(lostCourtyardAdapter), adapter(forgottenGalleriesAdapter), adapter(royalTreasuryAdapter)],
  'vault-breaker': [adapter(templeApproachAdapter), adapter(ancientMechanismAdapter), adapter(innerVaultAdapter)],
} as const
export const stageIds = (mission: MissionType): readonly string[] => adapters[mission].map(a => a.id)
export function localView(state: V2State): StageView { return state.local as StageView }
function carry(e: Expedition): unknown {
  switch (e.mission) {
    case 'gem-runner': return gem.expeditionCarry(e)
    case 'chest-hunter': return chest.expeditionCarry(e)
    case 'vault-breaker': return vault.expeditionCarry(e)
  }
}
function continueExpedition(e: Expedition): Expedition {
  switch (e.mission) {
    case 'gem-runner': return gem.reduceExpedition(e, { type: 'CONTINUE' })
    case 'chest-hunter': return chest.reduceExpedition(e, { type: 'CONTINUE' })
    case 'vault-breaker': return vault.reduceExpedition(e, { type: 'CONTINUE' })
  }
}
function reportExpedition(e: Expedition, report: unknown): Expedition {
  // Reports are produced by the reducer-owned adapter, never deserialized from a client.
  switch (e.mission) {
    case 'gem-runner': {
      const r = report as import('../gemRunner/contracts.js').StageReport
      const next = gem.reduceExpedition(e, { type: 'STAGE_PROGRESS', stageId: e.currentStage, progress: r.progress })
      return r.status === 'COMPLETE' && next.status !== 'FAILED' ? gem.reduceExpedition(next, { type: 'STAGE_COMPLETED', result: r.result }) : next
    }
    case 'chest-hunter': {
      const r = report as import('../chestHunter/contracts.js').StageReport
      const next = chest.reduceExpedition(e, { type: 'STAGE_PROGRESS', stageId: e.currentStage, progress: r.progress })
      return r.status === 'COMPLETE' && next.status !== 'FAILED' ? chest.reduceExpedition(next, { type: 'STAGE_COMPLETED', result: r.result }) : next
    }
    case 'vault-breaker': {
      const r = report as import('../vaultBreaker/contracts.js').StageReport
      const next = vault.reduceExpedition(e, { type: 'STAGE_PROGRESS', stageId: e.currentStage, progress: r.progress })
      return r.status === 'COMPLETE' && next.status !== 'FAILED' ? vault.reduceExpedition(next, { type: 'STAGE_COMPLETED', result: r.result }) : next
    }
  }
}
export function initialV2(mission: MissionType): V2State {
  const expedition = mission === 'gem-runner' ? gem.initialGemRunnerState() : mission === 'chest-hunter' ? chest.initialChestHunterState() : vault.initialVaultBreakerState()
  return { version: 2, seq: 0, mission, expedition, local: adapters[mission][0].create(carry(expedition)), stageActionCount: 0, stageMoveCount: 0, movesSinceTick: 0, totalTicks: 0 }
}
export function isV2Action(input: unknown): input is V2Action {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false
  const v = input as Record<string, unknown>, keys = Object.keys(v)
  if (!Number.isSafeInteger(v.seq) || (v.seq as number) < 1 || typeof v.stageId !== 'string' || v.stageId.length > 40) return false
  const move = v.type === 'V2_MOVE'
  if (!move && v.type !== 'V2_TICK' && v.type !== 'V2_CONTINUE') return false
  return keys.length === (move ? 4 : 3) && keys.every(k => ['seq', 'type', 'stageId', ...(move ? ['direction'] : [])].includes(k))
    && (!move || ['UP', 'DOWN', 'LEFT', 'RIGHT'].includes(v.direction as string))
}
export function advanceV2(state: V2State, action: V2Action): V2State {
  if (!isV2Action(action) || action.seq !== state.seq + 1) throw new Error('INVALID_SEQUENCE_OR_ACTION')
  if (action.seq > V2_ACTION_LIMIT) throw new Error('ACTION_LIMIT_EXCEEDED')
  const e = state.expedition
  if (action.stageId !== e.currentStage || e.status === 'FAILED' || e.status === 'COMPLETE') throw new Error('INVALID_STAGE_OR_TERMINAL')
  if (action.type === 'V2_CONTINUE') {
    if (e.status !== 'TRANSITION') throw new Error('STAGE_NOT_COMPLETE')
    const expedition = continueExpedition(e)
    if (expedition.currentStageIndex !== e.currentStageIndex + 1) throw new Error('INVALID_STAGE_BOUNDARY')
    return { ...state, seq: action.seq, expedition, local: adapters[state.mission][expedition.currentStageIndex].create(carry(expedition)), stageActionCount: 0, stageMoveCount: 0, movesSinceTick: 0 }
  }
  if (e.status !== 'PLAYING') throw new Error('STAGE_NOT_PLAYING')
  const a = adapters[state.mission][e.currentStageIndex]
  const localAction: LocalAction = action.type === 'V2_MOVE' ? { type: 'MOVE', direction: action.direction } : { type: 'TICK' }
  const movesSinceTick = action.type === 'V2_TICK' ? 0 : state.movesSinceTick + 1
  if (movesSinceTick > 2) throw new Error('MISSING_SIMULATION_TICKS')
  const local = a.reduce(state.local, localAction)
  if (local === state.local) throw new Error('ILLEGAL_STAGE_ACTION')
  const count = state.stageActionCount + 1
  // Enforce simulation progress while moving. A MOVE may straddle a150ms tick,
  // but movement cannot indefinitely freeze wildlife, immunity or boss windows.
  const moves = state.stageMoveCount + (action.type === 'V2_MOVE' ? 1 : 0)
  if ((local as StageView).tick < Math.max(0, Math.floor(moves * 145 / V2_TICK_MS) - 1)) throw new Error('MISSING_SIMULATION_TICKS')
  const expedition = reportExpedition(e, a.report(local, e.stageCarryIn, count))
  return { ...state, seq: action.seq, local, expedition, stageActionCount: count, stageMoveCount: moves, movesSinceTick,
    totalTicks: state.totalTicks + ((local as StageView).tick - localView(state).tick) }
}
export function replayV2(mission: MissionType, actions: readonly V2Action[]): V2State {
  if (actions.length > V2_ACTION_LIMIT) throw new Error('ACTION_LIMIT_EXCEEDED')
  return actions.reduce(advanceV2, initialV2(mission))
}
/** Sorted plain JSON commits the complete reducer state including local bosses,
 * boundaries and exact carry; no selective summary hashing for V2. */
export function canonicalV2(value: unknown): string {
  return JSON.stringify(value, (_key, v) => v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v)
}
export function hashV2(domain: string, value: unknown): string {
  return Array.from(sha256(new TextEncoder().encode(`NIMHUNT:ANGKOR_V2:${domain}:v1\n${canonicalV2(value)}`)), b => b.toString(16).padStart(2, '0')).join('')
}
