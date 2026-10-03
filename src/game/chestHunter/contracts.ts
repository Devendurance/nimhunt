import { copyItems, type CarriedItems } from '../gemRunner/contracts'
export { copyItems, type CarriedItems }
export const CHEST_HUNTER_STAGES = [
  { id: 'lost-courtyard', name: 'Lost Courtyard', ordinal: 1, numeral: 'I', available: 6, required: 4 },
  { id: 'forgotten-galleries', name: 'Forgotten Galleries', ordinal: 2, numeral: 'II', available: 8, required: 5 },
  { id: 'royal-treasury', name: 'Royal Treasury', ordinal: 3, numeral: 'III', available: null, required: null },
] as const
export type StageDefinition = typeof CHEST_HUNTER_STAGES[number]
export type StageId = StageDefinition['id']
export interface StageCarry { readonly hp: number; readonly expeditionChestsOpened: number; readonly expeditionGems: number; readonly carriedItems: CarriedItems }
export interface StageProgress extends StageCarry { readonly stageChestsOpened: number }
export interface StageResult {
  readonly stageId: StageId; readonly stageChestsOpened: number; readonly expeditionChestsOpened: number
  readonly hpRemaining: number; readonly expeditionGems: number; readonly carriedItems: CarriedItems
  readonly openedChestIds: readonly string[]; readonly completion: { readonly tick: number; readonly actionCount: number }
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
  if (!Number.isInteger(carry.hp) || carry.hp < 0 || carry.hp > 100 || !Number.isSafeInteger(carry.expeditionChestsOpened) || carry.expeditionChestsOpened < 0 || !Number.isSafeInteger(carry.expeditionGems) || carry.expeditionGems < 0) throw new Error('Invalid Chest Hunter carry totals')
  return { hp: carry.hp, expeditionChestsOpened: carry.expeditionChestsOpened, expeditionGems: carry.expeditionGems, carriedItems: copyItems(carry.carriedItems) }
}
export function freshCarry(): StageCarry { return { hp: 100, expeditionChestsOpened: 0, expeditionGems: 0, carriedItems: { sword: false, potion: { owned: false, consumed: false } } } }
