import { copyItems, type CarriedItems } from '../gemRunner/contracts'
export { copyItems, type CarriedItems }
export const VAULT_BREAKER_STAGES = [
  { id: 'temple-approach', name: 'Temple Approach', ordinal: 1, numeral: 'I', implemented: true },
  { id: 'ancient-mechanism', name: 'Ancient Mechanism', ordinal: 2, numeral: 'II', implemented: true },
  { id: 'inner-vault', name: 'Inner Vault', ordinal: 3, numeral: 'III', implemented: false },
] as const
export type StageDefinition = typeof VAULT_BREAKER_STAGES[number]
export type StageId = StageDefinition['id']
/** Explicit carry whitelist: local keys, stones and mechanisms cannot leak. */
export interface StageCarry { readonly hp: number; readonly carriedItems: CarriedItems }
export interface ApproachObjectives {
  readonly bronzeKeyCollected: boolean
  readonly outerSealUnlocked: boolean
  /** Historical activation; current gate/plate occupancy remains stage-local. */
  readonly mechanismActivated: boolean
}
export interface MechanismObjectives {
  readonly counterweightSolved: boolean
  readonly rotaryAligned: boolean
  readonly relayReached: boolean
  readonly mechanismCoreActivated: boolean
  readonly finalCombinationSet: boolean
  readonly innerLockOpened: boolean
}
export type ObjectiveResults = ApproachObjectives | MechanismObjectives
export interface StageProgress extends StageCarry { readonly objectives: ObjectiveResults; readonly optionalGemCount: number }
interface ResultCarry {
  readonly hpRemaining: number; readonly carriedItems: CarriedItems
  readonly optionalGemCount: number; readonly completion: { readonly tick: number; readonly actionCount: number }
}
export interface ApproachResult extends ResultCarry, ApproachObjectives { readonly stageId: 'temple-approach' }
export interface MechanismResult extends ResultCarry, MechanismObjectives {
  readonly stageId: 'ancient-mechanism'
  readonly counterweightActive: boolean
  readonly rotaryState: 'A' | 'B' | 'C'
}
export type StageResult = ApproachResult | MechanismResult
export function resultObjectives(result: StageResult): ObjectiveResults {
  if (result.stageId === 'temple-approach') return { bronzeKeyCollected: result.bronzeKeyCollected, outerSealUnlocked: result.outerSealUnlocked, mechanismActivated: result.mechanismActivated }
  return { counterweightSolved: result.counterweightSolved, rotaryAligned: result.rotaryAligned, relayReached: result.relayReached, mechanismCoreActivated: result.mechanismCoreActivated, finalCombinationSet: result.finalCombinationSet, innerLockOpened: result.innerLockOpened }
}
export type StageReport =
  | { readonly status: 'PLAYING' | 'FAILED'; readonly progress: StageProgress }
  | { readonly status: 'COMPLETE'; readonly progress: StageProgress; readonly result: StageResult }
export interface StageAdapter<State, Action> {
  readonly definition: StageDefinition
  create(carry: StageCarry): State
  reduce(state: State, action: Action): State
  isAction(value: unknown): value is Action
  report(state: State, carryIn: StageCarry, actionCount: number): StageReport
}
export function copyCarry(carry: StageCarry): StageCarry {
  if (!Number.isInteger(carry.hp) || carry.hp < 0 || carry.hp > 100) throw new Error('Invalid Vault Breaker HP')
  return { hp: carry.hp, carriedItems: copyItems(carry.carriedItems) }
}
export const emptyObjectives = (): ApproachObjectives => ({ bronzeKeyCollected: false, outerSealUnlocked: false, mechanismActivated: false })
export const freshCarry = (): StageCarry => ({ hp: 100, carriedItems: { sword: false, potion: { owned: false, consumed: false } } })
