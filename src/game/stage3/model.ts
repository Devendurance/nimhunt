import { calculateMove } from '../systems/movement.js'
import { DIRECTION_VECTORS, type Direction, type GridCoord } from '../world/grid.js'
import { assertVitals, type StageCarry } from '../gemRunner/contracts.js'
import { DAMAGE as BASE_DAMAGE, SIMULATION_TICK_MS, sameCell, type SnakeState, type MonkeyState } from '../stage1/model.js'
import { inZone } from '../stage1/level.js'
import { ANACONDA, BOULDERS, EXIT, GEMS, GEM_REQUIREMENT, MONKEYS, PIT_ORDER, type PitId, RUBBLE, SNAKES, SPIKES, stageMap } from './level.js'
export { SIMULATION_TICK_MS }
export const DAMAGE = { ...BASE_DAMAGE, rubble: 22, anaconda: 26, replacementBoulder: 24 } as const
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
  | { type: 'ANACONDA_EMERGED'; pit: PitId; phase: number; vulnerableAt: number }
  | { type: 'ANACONDA_VULNERABLE'; pit: PitId; vulnerableUntil: number }
  | { type: 'BOULDER_DROP_TRIGGERED'; id: string; pit: PitId; impactTick: number }
  | { type: 'ANACONDA_HIT'; pit: PitId; successfulHits: number }
  | { type: 'ANACONDA_RETALIATION_TELEGRAPH'; tiles: GridCoord[]; impactTick: number; phase: number }
  | { type: 'ANACONDA_RETALIATION_IMPACT'; tiles: GridCoord[]; hit: boolean }
  | { type: 'REPLACEMENT_BOULDER_TELEGRAPH'; id: string; tile: GridCoord; impactTick: number }
  | { type: 'REPLACEMENT_BOULDER_IMPACT'; id: string; tile: GridCoord; hit: boolean }
  | { type: 'REPLACEMENT_BOULDER_READY'; id: string; tile: GridCoord }
  | { type: 'ANACONDA_PHASE_ADVANCED'; phase: number; pit: PitId }
  | { type: 'ANACONDA_DEFEATED'; successfulHits: 3; completeAt: number }
  | { type: 'EXIT_UNLOCKED' }
  | { type: 'STAGE_COMPLETE'; gems: number; hp: number }
export type StageEvent = EventPayload & { seq: number; tick: number }
export interface AnacondaState {
  mode: 'DORMANT' | 'EMERGING' | 'VULNERABLE' | 'RETALIATING' | 'RECOVERING' | 'DEFEATED'
  phase: number; activePit: PitId; successfulHits: number
  nextTick: number; vulnerableUntil: number; targets: GridCoord[]
  pendingDrop: { id: string; impactTick: number } | null
  replacement: { id: string; mode: 'WAITING' | 'TELEGRAPH' | 'LANDED'; impactTick: number } | null
  phaseHit: boolean; defeatedAt: number | null; objectiveSatisfied: boolean
}
export interface StageState {
  version: 2; tick: number; player: GridCoord; hp: number; invulnerableUntil: number
  status: 'playing' | 'complete' | 'failed'; stageGems: number; expeditionGems: number; collected: string[]
  boulders: { id: string; x: number; y: number }[]; snakes: SnakeState[]; monkeys: (MonkeyState & { id: string })[]
  rubble: { mode: 'armed' | 'tell' | 'recover'; nextTick: number }
  anaconda: AnacondaState
  exitUnlocked: boolean; result: { gems: number; expeditionGems: number; hp: number } | null; events: StageEvent[]
}
export function initialStageState(carry: Pick<StageCarry, 'hp' | 'expeditionGems'>): StageState {
  assertVitals(carry.hp, carry.expeditionGems)
  if (!carry.hp) throw new Error('Cannot start Inner Sanctuary with zero HP')
  return { version: 2, tick: 0, player: { ...stageMap.collision.playerStart }, hp: carry.hp, invulnerableUntil: 0,
    status: 'playing', stageGems: 0, expeditionGems: carry.expeditionGems, collected: [],
    boulders: BOULDERS.map(({ id, x, y }) => ({ id, x, y })), snakes: SNAKES.map(s => ({ id: s.id, mode: 'dormant', index: 0, nextTick: 0 })),
    monkeys: MONKEYS.map(m => ({ id: m.id, mode: 'dormant', perch: 0, nextTick: 0, target: null })), rubble: { mode: 'armed', nextTick: 0 }, anaconda: { mode: 'DORMANT', phase: 1, activePit: PIT_ORDER[0], successfulHits: 0, nextTick: 0, vulnerableUntil: 0, targets: [], pendingDrop: null, replacement: null, phaseHit: false, defeatedAt: null, objectiveSatisfied: false }, exitUnlocked: false, result: null, events: [] }
}
export function planStageMove(state: StageState, direction: Direction) {
  if (state.status !== 'playing' || !Object.hasOwn(DIRECTION_VECTORS, direction)) return null
  const move = calculateMove(stageMap.collision, state.player, direction)
  if (!move.success || (sameCell(move.to, EXIT) && !state.exitUnlocked)) return null
  const stone = state.boulders.find(b => sameCell(b, move.to))
  if (!stone) return { ...move, push: null }
  const track = BOULDERS.find(b => b.id === stone.id)!, push = calculateMove(stageMap.collision, stone, direction)
  if (state.anaconda.mode !== 'VULNERABLE' || state.anaconda.activePit !== track.pit || state.anaconda.pendingDrop || state.anaconda.vulnerableUntil - state.tick < 2
    || !sameCell(stone, track) || direction !== track.direction || !push.success || !sameCell(push.to, track.drop)
    || state.boulders.some(b => sameCell(b, push.to)) || sameCell(push.to, EXIT)
    || GEMS.some(g => sameCell(g, push.to)) || SPIKES.some(g => g.tiles.some(p => sameCell(p, push.to)))
    || SNAKES.some((s, i) => sameCell(s.path[state.snakes[i].index], push.to))) return null
  return { ...move, push: { id: stone.id, from: { x: stone.x, y: stone.y }, to: push.to } }
}
export function reduceStage(state: StageState, action: StageAction): StageState {
  if (state.status !== 'playing') return state
  const plan = action.type === 'MOVE' ? planStageMove(state, action.direction) : null
  if (action.type === 'MOVE' && !plan) return state
  const next: StageState = { ...state, player: { ...state.player }, collected: [...state.collected], boulders: state.boulders.map(b => ({ ...b })), snakes: state.snakes.map(s => ({ ...s })), monkeys: state.monkeys.map(m => ({ ...m })), rubble: { ...state.rubble }, anaconda: { ...state.anaconda, targets: state.anaconda.targets.map(p => ({ ...p })), pendingDrop: state.anaconda.pendingDrop ? { ...state.anaconda.pendingDrop } : null, replacement: state.anaconda.replacement ? { ...state.anaconda.replacement } : null }, events: [...state.events] }
  const emit = (event: EventPayload) => next.events.push({ ...event, seq: next.events.length + 1, tick: next.tick })
  const hurt = (source: keyof typeof DAMAGE) => {
    if (next.tick < next.invulnerableUntil || next.status !== 'playing') return
    const amount = Math.min(next.hp, DAMAGE[source]); next.hp -= amount; next.invulnerableUntil = next.tick + 6
    emit({ type: 'DAMAGE', source, amount, hp: next.hp }); if (!next.hp) next.status = 'failed'
  }
  if (action.type === 'TICK') next.tick++
  if (action.type === 'MOVE' && plan) {
    next.player = { ...plan.to }
    if (plan.push) {
      next.boulders = next.boulders.filter(b => b.id !== plan.push!.id)
      emit({ type: 'BOULDER_PUSH', ...plan.push })
      next.anaconda.pendingDrop = { id: plan.push.id, impactTick: next.tick + ANACONDA.dropTicks }
      emit({ type: 'BOULDER_DROP_TRIGGERED', id: plan.push.id, pit: next.anaconda.activePit, impactTick: next.anaconda.pendingDrop.impactTick })
    }
    emit({ type: 'MOVE', direction: action.direction, from: plan.from, to: plan.to })
    const gem = GEMS.find(g => sameCell(g, next.player) && !next.collected.includes(g.id))
    if (gem) {
      next.collected.push(gem.id); next.stageGems++; next.expeditionGems++
      emit({ type: 'GEM_COLLECTED', id: gem.id, stageGems: next.stageGems, expeditionGems: next.expeditionGems })

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

  const boss = next.anaconda
  const emerge = () => {
    boss.mode = 'EMERGING'; boss.phaseHit = false; boss.targets = []
    boss.nextTick = next.tick + ANACONDA.emergenceTicks
    emit({ type: 'ANACONDA_EMERGED', pit: boss.activePit, phase: boss.phase, vulnerableAt: boss.nextTick })
  }
  const retaliate = () => {
    const phase = ANACONDA.phases[boss.phase - 1]
    boss.mode = 'RETALIATING'; boss.nextTick = next.tick + phase.tellTicks
    boss.targets = phase.laneRows.flatMap(y => Array.from({ length: 8 }, (_, i) => ({ x: 20 + i, y })))
      .filter(p => stageMap.collision.layout[p.y][p.x] !== '#')
    emit({ type: 'ANACONDA_RETALIATION_TELEGRAPH', phase: boss.phase, tiles: boss.targets.map(p => ({ ...p })), impactTick: boss.nextTick })
  }
  if (next.status === 'playing') {
    // Replacement impact is fixed. Readiness waits for the one-step actor halo:
    // a boulder can never appear inside an already animating tile destination.
    if (action.type === 'TICK' && boss.replacement) {
      const replacement = boss.replacement, track = BOULDERS.find(b => b.id === replacement.id)!
      if (replacement.mode === 'TELEGRAPH' && next.tick >= replacement.impactTick) {
        const hit = sameCell(next.player, track)
        emit({ type: 'REPLACEMENT_BOULDER_IMPACT', id: track.id, tile: { x: track.x, y: track.y }, hit })
        if (hit) hurt('replacementBoulder')
        replacement.mode = 'LANDED'
      }
      if (replacement.mode === 'LANDED' && Math.abs(next.player.x - track.x) + Math.abs(next.player.y - track.y) > 1) {
        next.boulders.push({ id: track.id, x: track.x, y: track.y }); boss.replacement = null
        emit({ type: 'REPLACEMENT_BOULDER_READY', id: track.id, tile: { x: track.x, y: track.y } })
      }
    }
    if (next.status === 'playing' && boss.mode === 'DORMANT' && inZone(next.player, ANACONDA.sanctum)) emerge()
    else if (action.type === 'TICK' && next.status === 'playing') {
      const phase = ANACONDA.phases[boss.phase - 1]
      if (boss.mode === 'EMERGING' && next.tick >= boss.nextTick) {
        boss.mode = 'VULNERABLE'; boss.vulnerableUntil = next.tick + phase.vulnerableTicks
        emit({ type: 'ANACONDA_VULNERABLE', pit: boss.activePit, vulnerableUntil: boss.vulnerableUntil })
      } else if (boss.mode === 'VULNERABLE') {
        if (boss.pendingDrop && next.tick >= boss.pendingDrop.impactTick) {
          const id = boss.pendingDrop.id
          boss.pendingDrop = null; boss.successfulHits++; boss.phaseHit = true
          emit({ type: 'ANACONDA_HIT', pit: boss.activePit, successfulHits: boss.successfulHits })
          boss.replacement = { id, mode: 'WAITING', impactTick: 0 }
          if (boss.successfulHits === 3) {
            // Final rock interrupts retaliation. Collapse is a deterministic pause,
            // not a fourth phase or an automatic expedition completion.
            boss.mode = 'DEFEATED'; boss.defeatedAt = next.tick; boss.targets = []
            const track = BOULDERS.find(b => b.id === id)!
            boss.replacement.mode = 'TELEGRAPH'; boss.replacement.impactTick = next.tick + phase.replacementTicks
            emit({ type: 'REPLACEMENT_BOULDER_TELEGRAPH', id, tile: { x: track.x, y: track.y }, impactTick: boss.replacement.impactTick })
            boss.nextTick = next.tick + ANACONDA.defeatTicks
            emit({ type: 'ANACONDA_DEFEATED', successfulHits: 3, completeAt: boss.nextTick })
          } else retaliate()
        } else if (!boss.pendingDrop && next.tick >= boss.vulnerableUntil) retaliate()
      } else if (boss.mode === 'RETALIATING' && next.tick >= boss.nextTick) {
        const hit = boss.targets.some(p => sameCell(p, next.player))
        emit({ type: 'ANACONDA_RETALIATION_IMPACT', tiles: boss.targets.map(p => ({ ...p })), hit }); if (hit) hurt('anaconda')
        boss.targets = []; boss.mode = 'RECOVERING'; boss.nextTick = next.tick + phase.recoveryTicks
        if (boss.replacement?.mode === 'WAITING') {
          const track = BOULDERS.find(b => b.id === boss.replacement!.id)!
          boss.replacement.mode = 'TELEGRAPH'; boss.replacement.impactTick = next.tick + phase.replacementTicks
          emit({ type: 'REPLACEMENT_BOULDER_TELEGRAPH', id: track.id, tile: { x: track.x, y: track.y }, impactTick: boss.replacement.impactTick })
        }
      } else if (boss.mode === 'RECOVERING' && next.tick >= boss.nextTick && !boss.replacement && inZone(next.player, ANACONDA.sanctum)) {
        if (boss.phaseHit) {
          boss.phase++; boss.activePit = PIT_ORDER[boss.phase - 1]
          emit({ type: 'ANACONDA_PHASE_ADVANCED', phase: boss.phase, pit: boss.activePit })
        }
        emerge()
      } else if (boss.mode === 'DEFEATED' && next.tick >= boss.nextTick && !boss.replacement) boss.objectiveSatisfied = true
    }
    if (next.status === 'playing' && !next.exitUnlocked && next.stageGems >= GEM_REQUIREMENT && boss.mode === 'DEFEATED' && boss.successfulHits === 3 && boss.objectiveSatisfied) {
      next.exitUnlocked = true; emit({ type: 'EXIT_UNLOCKED' })
    }
  }
  if (action.type === 'MOVE' && next.status === 'playing' && next.exitUnlocked && sameCell(next.player, EXIT)) {
    next.status = 'complete'; next.result = { gems: next.stageGems, expeditionGems: next.expeditionGems, hp: next.hp }; emit({ type: 'STAGE_COMPLETE', gems: next.stageGems, hp: next.hp })
  }
  return next
}
export function replayStage(actions: readonly StageAction[], carry: Pick<StageCarry, 'hp' | 'expeditionGems'>): StageState { return actions.reduce(reduceStage, initialStageState(carry)) }
