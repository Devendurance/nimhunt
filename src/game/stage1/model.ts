import { calculateMove } from '../systems/movement'
import { DIRECTION_VECTORS, type Direction, type GridCoord } from '../world/grid'
import { BOULDERS, EXIT, GEMS, GEM_REQUIREMENT, MONKEY, SNAKES, SPIKES, inZone, stageMap } from './level'
import { assertVitals, type StageCarry } from '../gemRunner/contracts'

export const SIMULATION_TICK_MS = 150
export const DAMAGE = { spikes: 18, snake: 12, monkey: 20 } as const
export type StageAction = { type: 'MOVE'; direction: Direction } | { type: 'TICK' } | { type: 'RESET' }
type EventPayload =
  | { type: 'MOVE'; direction: Direction; from: GridCoord; to: GridCoord }
  | { type: 'GEM_COLLECTED'; id: string; stageGems: number; expeditionGems: number }
  | { type: 'DAMAGE'; source: keyof typeof DAMAGE; amount: number; hp: number }
  | { type: 'SNAKE_ACTIVATED'; id: string }
  | { type: 'SNAKE_MOVED'; id: string; from: GridCoord; to: GridCoord }
  | { type: 'MONKEY_ATTACK_TELEGRAPH'; target: GridCoord; impactTick: number; perch: number }
  | { type: 'MONKEY_ROCK_IMPACT'; target: GridCoord; hit: boolean }
  | { type: 'BOULDER_PUSH'; id: string; from: GridCoord; to: GridCoord }
  | { type: 'EXIT_UNLOCKED' }
  | { type: 'STAGE_COMPLETE'; gems: number; hp: number }
export type StageEvent = EventPayload & { seq: number; tick: number }
export interface SnakeState { id: string; mode: 'dormant' | 'alert' | 'patrol'; index: number; nextTick: number }
export interface MonkeyState { mode: 'dormant' | 'tell' | 'recover'; perch: number; nextTick: number; target: GridCoord | null }
export interface StageState {
  version: 1; tick: number; player: GridCoord; hp: number; invulnerableUntil: number
  status: 'playing' | 'complete' | 'failed'; stageGems: number; expeditionGems: number; collected: string[]
  boulders: { id: string; x: number; y: number }[]; snakes: SnakeState[]; monkey: MonkeyState
  exitUnlocked: boolean; result: { gems: number; expeditionGems: number; hp: number } | null; events: StageEvent[]
}
export const sameCell = (a: GridCoord, b: GridCoord) => a.x === b.x && a.y === b.y
export function initialStageState(carry: Pick<StageCarry, 'hp' | 'expeditionGems'> = { hp: 100, expeditionGems: 0 }): StageState {
  assertVitals(carry.hp, carry.expeditionGems)
  if (carry.hp === 0) throw new Error('Cannot start Outer Ruins with zero HP')
  return { version: 1, tick: 0, player: { ...stageMap.collision.playerStart }, hp: carry.hp, invulnerableUntil: 0,
    status: 'playing', stageGems: 0, expeditionGems: carry.expeditionGems, collected: [], boulders: BOULDERS.map(b => ({ ...b })),
    snakes: SNAKES.map(s => ({ id: s.id, mode: 'dormant', index: 0, nextTick: 0 })),
    monkey: { mode: 'dormant', perch: 0, nextTick: 0, target: null }, exitUnlocked: false, result: null, events: [] }
}
/** Pure one-cell push, matching V1 semantics: walls, other boulders, Gems,
 * hazards and the passage cannot be displaced or covered. */
export function planStageMove(state: StageState, direction: Direction) {
  if (state.status !== 'playing' || !Object.hasOwn(DIRECTION_VECTORS, direction)) return null
  const move = calculateMove(stageMap.collision, state.player, direction)
  if (!move.success || (sameCell(move.to, EXIT) && !state.exitUnlocked)) return null
  const boulder = state.boulders.find(b => sameCell(b, move.to))
  if (!boulder) return { ...move, push: null }
  const push = calculateMove(stageMap.collision, boulder, direction)
  if (!push.success || sameCell(push.to, EXIT) || state.boulders.some(b => sameCell(b, push.to))
    || GEMS.some(g => !state.collected.includes(g.id) && sameCell(g, push.to))
    || SPIKES.some(group => group.tiles.some(p => sameCell(p, push.to)))
    || SNAKES.some(s => s.path.some(tile => sameCell(tile, push.to)))) return null
  return { ...move, push: { id: boulder.id, from: { x: boulder.x, y: boulder.y }, to: push.to } }
}
export function reduceStage(state: StageState, action: StageAction): StageState {
  if (action.type === 'RESET') return initialStageState()
  if (state.status !== 'playing') return state
  const plan = action.type === 'MOVE' ? planStageMove(state, action.direction) : null
  if (action.type === 'MOVE' && !plan) return state
  const next: StageState = { ...state, player: { ...state.player }, boulders: state.boulders.map(b => ({ ...b })), snakes: state.snakes.map(s => ({ ...s })), monkey: { ...state.monkey }, collected: [...state.collected], events: [...state.events] }
  const emit = (event: EventPayload) => next.events.push({ ...event, seq: next.events.length + 1, tick: next.tick })
  const hurt = (source: keyof typeof DAMAGE) => {
    if (next.tick < next.invulnerableUntil || next.status !== 'playing') return
    const amount = Math.min(next.hp, DAMAGE[source]); next.hp -= amount; next.invulnerableUntil = next.tick + 6
    emit({ type: 'DAMAGE', source, amount, hp: next.hp })
    if (next.hp === 0) next.status = 'failed'
  }
  if (action.type === 'TICK') next.tick++
  if (action.type === 'MOVE' && plan) {
    next.player = { ...plan.to }
    if (plan.push) { const b = next.boulders.find(b => b.id === plan.push!.id)!; Object.assign(b, plan.push.to); emit({ type: 'BOULDER_PUSH', ...plan.push }) }
    emit({ type: 'MOVE', direction: action.direction, from: plan.from, to: plan.to })
    const gem = GEMS.find(g => sameCell(g, next.player) && !next.collected.includes(g.id))
    if (gem) {
      next.collected.push(gem.id); next.stageGems++; next.expeditionGems++
      emit({ type: 'GEM_COLLECTED', id: gem.id, stageGems: next.stageGems, expeditionGems: next.expeditionGems })
      if (!next.exitUnlocked && next.stageGems >= GEM_REQUIREMENT) { next.exitUnlocked = true; emit({ type: 'EXIT_UNLOCKED' }) }
    }
  }
  for (const group of SPIKES) if (group.tiles.some(p => sameCell(p, next.player))) hurt('spikes')
  next.snakes.forEach((snake, i) => {
    const authored = SNAKES[i]
    if (snake.mode === 'dormant' && inZone(next.player, authored.zone)) {
      snake.mode = 'alert'; snake.nextTick = next.tick + 3; emit({ type: 'SNAKE_ACTIVATED', id: snake.id })
    } else if (action.type === 'TICK' && snake.mode !== 'dormant' && next.tick >= snake.nextTick) {
      const from = authored.path[snake.index], index = (snake.index + 1) % authored.path.length, to = authored.path[index]
      // A pushed boulder blocks the next authored step; no alternate pathfinding.
      if (!next.boulders.some(b => sameCell(b, to))) { snake.index = index; emit({ type: 'SNAKE_MOVED', id: snake.id, from, to }) }
      snake.mode = 'patrol'; snake.nextTick = next.tick + 4
    }
    if (snake.mode !== 'dormant' && sameCell(next.player, authored.path[snake.index])) hurt('snake')
  })
  const monkey = next.monkey
  if (action.type === 'TICK') {
    if (monkey.mode === 'tell' && next.tick >= monkey.nextTick && monkey.target) {
      const hit = sameCell(next.player, monkey.target)
      emit({ type: 'MONKEY_ROCK_IMPACT', target: { ...monkey.target }, hit })
      if (hit) hurt('monkey')
      monkey.mode = 'recover'; monkey.nextTick = next.tick + 10; monkey.target = null; monkey.perch = (monkey.perch + 1) % MONKEY.perches.length
    } else if (monkey.mode !== 'tell' && next.tick >= monkey.nextTick && inZone(next.player, MONKEY.zone)) {
      monkey.mode = 'tell'; monkey.target = { ...next.player }; monkey.nextTick = next.tick + 8
      emit({ type: 'MONKEY_ATTACK_TELEGRAPH', target: { ...monkey.target }, impactTick: monkey.nextTick, perch: monkey.perch })
    }
  }
  if (action.type === 'MOVE' && next.status === 'playing' && next.exitUnlocked && sameCell(next.player, EXIT)) {
    next.status = 'complete'; next.result = { gems: next.stageGems, expeditionGems: next.expeditionGems, hp: next.hp }
    emit({ type: 'STAGE_COMPLETE', gems: next.stageGems, hp: next.hp })
  }
  return next
}
/** Explicit ticks belong to the local transcript. No wall clock, RNG, Phaser or
 * production proof/replay contract enters this model. */
export function replayStage(actions: readonly StageAction[], carry?: Pick<StageCarry, 'hp' | 'expeditionGems'>): StageState { return actions.reduce(reduceStage, initialStageState(carry)) }
