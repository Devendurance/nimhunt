import { calculateMove } from '../systems/movement.js'
import { DIRECTION_VECTORS, type Direction, type GridCoord } from '../world/grid.js'
import { assertVitals, type StageCarry } from '../gemRunner/contracts.js'
import { DAMAGE as BASE_DAMAGE, SIMULATION_TICK_MS, sameCell, type SnakeState, type MonkeyState } from '../stage1/model.js'
import { inZone } from '../stage1/level.js'
import { BOULDERS, EXIT, GEMS, GEM_REQUIREMENT, MONKEYS, RUBBLE, SNAKES, SPIKES, stageMap } from './level.js'
export { SIMULATION_TICK_MS }
export const DAMAGE = { ...BASE_DAMAGE, rubble: 22 } as const
export type StageAction = { type: 'MOVE'; direction: Direction } | { type: 'TICK' }
type EventPayload =
  | { type: 'MOVE'; direction: Direction; from: GridCoord; to: GridCoord }
  | { type: 'GEM_COLLECTED'; id: string; stageGems: number; expeditionGems: number }
  | { type: 'DAMAGE'; source: keyof typeof DAMAGE; amount: number; hp: number }
  | { type: 'SNAKE_ACTIVATED'; id: string }
  | { type: 'SNAKE_MOVED'; id: string; from: GridCoord; to: GridCoord }
  | { type: 'MONKEY_ATTACK_TELEGRAPH'; id: string; target: GridCoord; impactTick: number; perch: number }
  | { type: 'MONKEY_ROCK_IMPACT'; id: string; target: GridCoord; hit: boolean }
  | { type: 'BOULDER_PUSH'; id: string; from: GridCoord; to: GridCoord }
  | { type: 'RUBBLE_TELEGRAPH'; tiles: readonly GridCoord[]; impactTick: number }
  | { type: 'RUBBLE_IMPACT'; tiles: readonly GridCoord[]; hit: boolean }
  | { type: 'EXIT_UNLOCKED' }
  | { type: 'STAGE_COMPLETE'; gems: number; hp: number }
export type StageEvent = EventPayload & { seq: number; tick: number }
export interface StageState {
  version: 1; tick: number; player: GridCoord; hp: number; invulnerableUntil: number
  status: 'playing' | 'complete' | 'failed'; stageGems: number; expeditionGems: number; collected: string[]
  boulders: { id: string; x: number; y: number }[]; snakes: SnakeState[]; monkeys: (MonkeyState & { id: string })[]
  rubble: { mode: 'armed' | 'tell' | 'recover'; nextTick: number }
  exitUnlocked: boolean; result: { gems: number; expeditionGems: number; hp: number } | null; events: StageEvent[]
}
export function initialStageState(carry: Pick<StageCarry, 'hp' | 'expeditionGems'>): StageState {
  assertVitals(carry.hp, carry.expeditionGems)
  if (!carry.hp) throw new Error('Cannot start Overgrown Temple with zero HP')
  return { version: 1, tick: 0, player: { ...stageMap.collision.playerStart }, hp: carry.hp, invulnerableUntil: 0,
    status: 'playing', stageGems: 0, expeditionGems: carry.expeditionGems, collected: [],
    boulders: BOULDERS.map(({ id, x, y }) => ({ id, x, y })), snakes: SNAKES.map(s => ({ id: s.id, mode: 'dormant', index: 0, nextTick: 0 })),
    monkeys: MONKEYS.map(m => ({ id: m.id, mode: 'dormant', perch: 0, nextTick: 0, target: null })), rubble: { mode: 'armed', nextTick: 0 }, exitUnlocked: false, result: null, events: [] }
}
export function planStageMove(state: StageState, direction: Direction) {
  if (state.status !== 'playing' || !Object.hasOwn(DIRECTION_VECTORS, direction)) return null
  const move = calculateMove(stageMap.collision, state.player, direction)
  if (!move.success || (sameCell(move.to, EXIT) && !state.exitUnlocked)) return null
  const stone = state.boulders.find(b => sameCell(b, move.to))
  if (!stone) return { ...move, push: null }
  const track = BOULDERS.find(b => b.id === stone.id)!, push = calculateMove(stageMap.collision, stone, direction)
  if (!sameCell(stone, track) || direction !== track.direction || !push.success || !sameCell(push.to, track.parked)
    || state.boulders.some(b => sameCell(b, push.to)) || sameCell(push.to, EXIT)
    || GEMS.some(g => sameCell(g, push.to)) || SPIKES.some(g => g.tiles.some(p => sameCell(p, push.to)))
    || SNAKES.some((s, i) => sameCell(s.path[state.snakes[i].index], push.to))) return null
  return { ...move, push: { id: stone.id, from: { x: stone.x, y: stone.y }, to: push.to } }
}
export function reduceStage(state: StageState, action: StageAction): StageState {
  if (state.status !== 'playing') return state
  const plan = action.type === 'MOVE' ? planStageMove(state, action.direction) : null
  if (action.type === 'MOVE' && !plan) return state
  const next: StageState = { ...state, player: { ...state.player }, collected: [...state.collected], boulders: state.boulders.map(b => ({ ...b })), snakes: state.snakes.map(s => ({ ...s })), monkeys: state.monkeys.map(m => ({ ...m })), rubble: { ...state.rubble }, events: [...state.events] }
  const emit = (event: EventPayload) => next.events.push({ ...event, seq: next.events.length + 1, tick: next.tick })
  const hurt = (source: keyof typeof DAMAGE) => {
    if (next.tick < next.invulnerableUntil || next.status !== 'playing') return
    const amount = Math.min(next.hp, DAMAGE[source]); next.hp -= amount; next.invulnerableUntil = next.tick + 6
    emit({ type: 'DAMAGE', source, amount, hp: next.hp }); if (!next.hp) next.status = 'failed'
  }
  if (action.type === 'TICK') next.tick++
  if (action.type === 'MOVE' && plan) {
    next.player = { ...plan.to }
    if (plan.push) { Object.assign(next.boulders.find(b => b.id === plan.push!.id)!, plan.push.to); emit({ type: 'BOULDER_PUSH', ...plan.push }) }
    emit({ type: 'MOVE', direction: action.direction, from: plan.from, to: plan.to })
    const gem = GEMS.find(g => sameCell(g, next.player) && !next.collected.includes(g.id))
    if (gem) {
      next.collected.push(gem.id); next.stageGems++; next.expeditionGems++
      emit({ type: 'GEM_COLLECTED', id: gem.id, stageGems: next.stageGems, expeditionGems: next.expeditionGems })
      if (!next.exitUnlocked && next.stageGems >= GEM_REQUIREMENT) { next.exitUnlocked = true; emit({ type: 'EXIT_UNLOCKED' }) }
    }
  }
  SPIKES.forEach(g => { if (g.tiles.some(p => sameCell(p, next.player))) hurt('spikes') })
  next.snakes.forEach((snake, i) => {
    const authored = SNAKES[i]
    if (snake.mode === 'dormant' && inZone(next.player, authored.zone)) {
      snake.mode = 'alert'; snake.nextTick = next.tick + 3; emit({ type: 'SNAKE_ACTIVATED', id: snake.id })
    } else if (action.type === 'TICK' && snake.mode !== 'dormant' && next.tick >= snake.nextTick) {
      const from = authored.path[snake.index], index = (snake.index + 1) % authored.path.length, to = authored.path[index]
      if (!next.boulders.some(b => sameCell(b, to))) { snake.index = index; emit({ type: 'SNAKE_MOVED', id: snake.id, from, to }) }
      snake.mode = 'patrol'; snake.nextTick = next.tick + 4
    }
    if (snake.mode !== 'dormant' && sameCell(next.player, authored.path[snake.index])) hurt('snake')
  })
  if (action.type === 'TICK') next.monkeys.forEach((monkey, i) => {
    const authored = MONKEYS[i]
    if (monkey.mode === 'tell' && next.tick >= monkey.nextTick && monkey.target) {
      const hit = sameCell(next.player, monkey.target); emit({ type: 'MONKEY_ROCK_IMPACT', id: monkey.id, target: { ...monkey.target }, hit })
      if (hit) hurt('monkey')
      monkey.mode = 'recover'; monkey.nextTick = next.tick + authored.recoveryTicks; monkey.target = null; monkey.perch = (monkey.perch + 1) % authored.perches.length
    } else if (monkey.mode !== 'tell' && next.tick >= monkey.nextTick && inZone(next.player, authored.zone)) {
      monkey.mode = 'tell'; monkey.target = { ...next.player }; monkey.nextTick = next.tick + authored.tellTicks
      emit({ type: 'MONKEY_ATTACK_TELEGRAPH', id: monkey.id, target: { ...monkey.target }, impactTick: monkey.nextTick, perch: monkey.perch })
    }
  })
  const rubble = next.rubble
  if (rubble.mode === 'armed' && inZone(next.player, RUBBLE.zone)) {
    rubble.mode = 'tell'; rubble.nextTick = next.tick + RUBBLE.tellTicks; emit({ type: 'RUBBLE_TELEGRAPH', tiles: RUBBLE.tiles, impactTick: rubble.nextTick })
  } else if (action.type === 'TICK' && rubble.mode === 'tell' && next.tick >= rubble.nextTick) {
    const hit = RUBBLE.tiles.some(p => sameCell(p, next.player)); emit({ type: 'RUBBLE_IMPACT', tiles: RUBBLE.tiles, hit }); if (hit) hurt('rubble')
    rubble.mode = 'recover'; rubble.nextTick = next.tick + RUBBLE.recoveryTicks
  } else if (action.type === 'TICK' && rubble.mode === 'recover' && next.tick >= rubble.nextTick && !inZone(next.player, RUBBLE.zone)) rubble.mode = 'armed'
  if (action.type === 'MOVE' && next.status === 'playing' && next.exitUnlocked && sameCell(next.player, EXIT)) {
    next.status = 'complete'; next.result = { gems: next.stageGems, expeditionGems: next.expeditionGems, hp: next.hp }; emit({ type: 'STAGE_COMPLETE', gems: next.stageGems, hp: next.hp })
  }
  return next
}
export function replayStage(actions: readonly StageAction[], carry: Pick<StageCarry, 'hp' | 'expeditionGems'>): StageState { return actions.reduce(reduceStage, initialStageState(carry)) }
