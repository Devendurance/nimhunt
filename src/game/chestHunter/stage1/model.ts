import { calculateMove } from '../../systems/movement'
import { createChestStates, getChestAt, CHEST_GEM_AMOUNT, CHEST_POTION_HEAL, type ChestInstance } from '../../systems/chests'
import { clampHP } from '../../domain/runState'
import { DIRECTION_VECTORS, type Direction, type GridCoord } from '../../world/grid'
import type { CarriedItems } from '../../gemRunner/contracts'
import { BOULDERS, CHESTS, CHEST_REQUIREMENT, EXIT, GATE, KEY, MONKEY, SNAKES, SPIKES, inZone, stageMap } from './level'

export const SIMULATION_TICK_MS = 150
export const DAMAGE = { spikes: 18, snake: 12, monkey: 20, trap: 18 } as const
export type StageAction = { type: 'MOVE'; direction: Direction } | { type: 'TICK' } | { type: 'RESET' }
type EventPayload =
  | { type: 'MOVE'; direction: Direction; from: GridCoord; to: GridCoord }
  | { type: 'CHEST_OPENED'; id: string; stageChestsOpened: number; expeditionChestsOpened: number }
  | { type: 'CHEST_LOOT_RESOLVED'; id: string; loot: ChestInstance['loot']; gems: number; healed: number }
  | { type: 'DAMAGE'; source: keyof typeof DAMAGE; amount: number; hp: number }
  | { type: 'KEY_COLLECTED'; id: string }
  | { type: 'GATE_UNLOCKED' }
  | { type: 'SNAKE_ACTIVATED'; id: string }
  | { type: 'SNAKE_MOVED'; id: string; from: GridCoord; to: GridCoord }
  | { type: 'MONKEY_ATTACK_TELEGRAPH'; target: GridCoord; impactTick: number; perch: number }
  | { type: 'MONKEY_ROCK_IMPACT'; target: GridCoord; hit: boolean }
  | { type: 'BOULDER_PUSH'; id: string; from: GridCoord; to: GridCoord }
  | { type: 'EXIT_UNLOCKED' }
  | { type: 'STAGE_COMPLETE'; chests: number; hp: number }
export type StageEvent = EventPayload & { seq: number; tick: number }
export interface StageResult {
  stageId: 'lost-courtyard'; stageChestsOpened: number; expeditionChestsOpened: number; hpRemaining: number
  expeditionGems: number; carriedItems: CarriedItems; openedChestIds: string[]
  completion: { tick: number; actionCount: number }
}
export interface StageState {
  version: 1; tick: number; actionCount: number; player: GridCoord; hp: number; invulnerableUntil: number
  status: 'playing' | 'complete' | 'failed'; stageChestsOpened: number; expeditionChestsOpened: number; expeditionGems: number
  carriedItems: { sword: boolean; potion: { owned: boolean; consumed: boolean } }; chests: ChestInstance[]; keyCollected: boolean; keyHeld: boolean; gateUnlocked: boolean
  boulders: { id: string; x: number; y: number }[]
  snakes: { id: string; mode: 'dormant' | 'alert' | 'patrol'; index: number; nextTick: number }[]
  monkey: { mode: 'dormant' | 'tell' | 'recover'; perch: number; nextTick: number; target: GridCoord | null }
  exitUnlocked: boolean; result: StageResult | null; events: StageEvent[]
}
export const sameCell = (a: GridCoord, b: GridCoord) => a.x === b.x && a.y === b.y
export function initialStageState(): StageState {
  return { version: 1, tick: 0, actionCount: 0, player: { ...stageMap.collision.playerStart }, hp: 100, invulnerableUntil: 0,
    status: 'playing', stageChestsOpened: 0, expeditionChestsOpened: 0, expeditionGems: 0,
    carriedItems: { sword: false, potion: { owned: false, consumed: false } }, chests: createChestStates(CHESTS),
    keyCollected: false, keyHeld: false, gateUnlocked: false, boulders: BOULDERS.map(({id,x,y}) => ({id,x,y})),
    snakes: SNAKES.map(s => ({ id: s.id, mode: 'dormant', index: 0, nextTick: 0 })),
    monkey: { mode: 'dormant', perch: 0, nextTick: 0, target: null }, exitUnlocked: false, result: null, events: [] }
}
/** Logical gate authority and authored guide grooves, never sprite alpha.
 * The entrance can always be cleared; end stops cannot seal a chest pocket. */
export function planStageMove(state: StageState, direction: Direction) {
  if (state.status !== 'playing' || !Object.hasOwn(DIRECTION_VECTORS, direction)) return null
  const move = calculateMove(stageMap.collision, state.player, direction)
  if (!move.success || (sameCell(move.to, EXIT) && !state.exitUnlocked)
    || (sameCell(move.to, GATE) && !state.gateUnlocked && !state.keyHeld)) return null
  const boulder = state.boulders.find(b => sameCell(b, move.to))
  if (!boulder) return { ...move, push: null }
  const track = BOULDERS.find(b => b.id === boulder.id)!
  const push = calculateMove(stageMap.collision, boulder, direction)
  if (!push.success || push.to.y !== track.y || push.to.x < track.minX || push.to.x > track.maxX
    || state.boulders.some(b => sameCell(b, push.to)) || CHESTS.some(c => sameCell(c, push.to))
    || SNAKES.some(s => s.path.some(tile => sameCell(tile, push.to)))) return null
  return { ...move, push: { id: boulder.id, from: { x: boulder.x, y: boulder.y }, to: push.to } }
}
export function reduceStage(state: StageState, action: StageAction): StageState {
  if (action.type === 'RESET') return initialStageState()
  if (state.status !== 'playing') return state
  const plan = action.type === 'MOVE' ? planStageMove(state, action.direction) : null
  if (action.type === 'MOVE' && !plan) return state
  const next: StageState = { ...state, actionCount: state.actionCount + 1, player: { ...state.player },
    carriedItems: { sword: state.carriedItems.sword, potion: { ...state.carriedItems.potion } },
    chests: state.chests.map(c => ({ ...c })), boulders: state.boulders.map(b => ({ ...b })),
    snakes: state.snakes.map(s => ({ ...s })), monkey: { ...state.monkey }, events: [...state.events] }
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
    if (!next.keyCollected && sameCell(next.player, KEY)) {
      next.keyCollected = true; next.keyHeld = true; emit({ type: 'KEY_COLLECTED', id: KEY.id })
    }
    if (!next.gateUnlocked && next.keyHeld && sameCell(next.player, GATE)) {
      next.keyHeld = false; next.gateUnlocked = true; emit({ type: 'GATE_UNLOCKED' })
    }
    const chest = getChestAt(next.chests, next.player)
    if (chest && !chest.resolved) {
      Object.assign(chest, { state: 'OPEN', resolved: true })
      next.stageChestsOpened++; next.expeditionChestsOpened++
      emit({ type: 'CHEST_OPENED', id: chest.id, stageChestsOpened: next.stageChestsOpened, expeditionChestsOpened: next.expeditionChestsOpened })
      let gems = 0, healed = 0
      // V1 loot vocabulary, exact Gems/heal constants and immediate potion use.
      // openChest itself also applies V1 mission completion/30 HP trap, so it
      // deliberately stays outside this isolated exit-gated, 18 HP trap reducer.
      if (chest.loot === 'GEMS') { gems = CHEST_GEM_AMOUNT; next.expeditionGems += gems }
      if (chest.loot === 'POTION') {
        healed = Math.min(CHEST_POTION_HEAL, 100 - next.hp); next.hp = clampHP(next.hp + healed)
        next.carriedItems.potion = { owned: true, consumed: true }
      }
      if (chest.loot === 'SWORD') next.carriedItems.sword = true
      if (chest.loot === 'TRAP') hurt('trap')
      emit({ type: 'CHEST_LOOT_RESOLVED', id: chest.id, loot: chest.loot, gems, healed })
      if (!next.exitUnlocked && next.status === 'playing' && next.stageChestsOpened >= CHEST_REQUIREMENT) { next.exitUnlocked = true; emit({ type: 'EXIT_UNLOCKED' }) }
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
    next.status = 'complete'
    next.result = { stageId: 'lost-courtyard', stageChestsOpened: next.stageChestsOpened,
      expeditionChestsOpened: next.expeditionChestsOpened, hpRemaining: next.hp, expeditionGems: next.expeditionGems,
      carriedItems: { sword: next.carriedItems.sword, potion: { ...next.carriedItems.potion } },
      openedChestIds: next.chests.filter(c => c.resolved).map(c => c.id), completion: { tick: next.tick, actionCount: next.actionCount } }
    emit({ type: 'STAGE_COMPLETE', chests: next.stageChestsOpened, hp: next.hp })
  }
  return next
}
export function replayStage(actions: readonly StageAction[]): StageState { return actions.reduce(reduceStage, initialStageState()) }
export interface ChestHunterTranscript {
  schema: 'angkor-chest-hunter-stage1/v1'; stageId: 'lost-courtyard'; actions: StageAction[]; result: StageResult | null
}
export function stageTranscript(actions: readonly StageAction[]): ChestHunterTranscript {
  return { schema: 'angkor-chest-hunter-stage1/v1', stageId: 'lost-courtyard', actions: actions.map(a => ({ ...a })), result: replayStage(actions).result }
}
