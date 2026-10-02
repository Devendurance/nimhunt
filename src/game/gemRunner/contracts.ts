export const GEM_RUNNER_STAGES = [
  { id: 'outer-ruins', name: 'Outer Ruins', ordinal: 1, numeral: 'I' },
  { id: 'overgrown-temple', name: 'Overgrown Temple', ordinal: 2, numeral: 'II' },
  { id: 'inner-sanctuary', name: 'Inner Sanctuary', ordinal: 3, numeral: 'III' },
] as const
export type StageDefinition = typeof GEM_RUNNER_STAGES[number]
export type StageId = StageDefinition['id']
export interface CarriedItems {
  readonly sword: boolean
  /** Ownership means acquired; consumed remains true after use. No replenishment. */
  readonly potion: { readonly owned: boolean; readonly consumed: boolean }
}
export interface StageCarry { readonly hp: number; readonly expeditionGems: number; readonly carriedItems: CarriedItems }
export interface StageProgress extends StageCarry { readonly stageGems: number }
export interface StageResult {
  readonly stageId: StageId; readonly stageGems: number; readonly expeditionGems: number; readonly hpRemaining: number
  readonly carriedItems: CarriedItems
  readonly completion: { readonly tick: number; readonly actionCount: number }
}
export type StageReport =
  | { readonly status: 'PLAYING' | 'FAILED'; readonly progress: StageProgress }
  | { readonly status: 'COMPLETE'; readonly progress: StageProgress; readonly result: StageResult }
/** A stage owns its reducer/actions/local state. The expedition sees only this
 * report and the explicit carry whitelist; no scene or local puzzle objects. */
export interface StageAdapter<State, Action> {
  readonly definition: StageDefinition
  create(carry: StageCarry): State
  reduce(state: State, action: Action): State
  isAction(value: unknown): value is Action
  report(state: State, carryIn: StageCarry, actionCount: number): StageReport
}
export function assertVitals(hp: number, gems: number): void {
  if (!Number.isInteger(hp) || hp < 0 || hp > 100 || !Number.isSafeInteger(gems) || gems < 0) throw new Error('Invalid Gem Runner carry totals')
}
export function copyItems(items: CarriedItems): CarriedItems {
  if (!items || typeof items.sword !== 'boolean' || typeof items.potion?.owned !== 'boolean' || typeof items.potion?.consumed !== 'boolean' || (items.potion.consumed && !items.potion.owned)) throw new Error('Invalid carried items')
  return { sword: items.sword, potion: { owned: items.potion.owned, consumed: items.potion.consumed } }
}
export function copyCarry(carry: StageCarry): StageCarry {
  assertVitals(carry.hp, carry.expeditionGems)
  return { hp: carry.hp, expeditionGems: carry.expeditionGems, carriedItems: copyItems(carry.carriedItems) }
}
export function freshCarry(): StageCarry { return { hp: 100, expeditionGems: 0, carriedItems: { sword: false, potion: { owned: false, consumed: false } } } }
