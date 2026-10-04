import { restorePresentation } from '../../angkorV2Proof/restorePresentation'
import Phaser from 'phaser'
import { AngkorV2Environment, angkorV2TextureKey, preloadAngkorV2Environment } from '../../rendering/angkorV2/environment'
import { ANGKOR_V2_RENDER as R, environmentDepth } from '../../rendering/angkorV2/geometry'
import { TileTraversal, type TraversalMove, ANGKOR_V2_MOVE_MS } from '../../traversal/angkorV2/movement'
import { TraversalPlayer } from '../../traversal/angkorV2/player'
import { bindTraversalKeyboard } from '../../traversal/angkorV2/input'
import { cameraTarget, followCamera } from '../../traversal/angkorV2/camera'
import { tileToPixel, type GridCoord } from '../../world/grid'
import type { AngkorV2AssetKey } from '../../assets/angkorV2Manifest'
import { EXIT, GEMS, POTION, RUBBLE, BOULDERS, GATE, KEY, PLATE, PRESSURE_GATE, MONKEY, SNAKES, SPIKES, DECOR, stageMap } from './level'
import type { StageCarry } from '../contracts'
import { SIMULATION_TICK_MS, initialStageState, planStageMove, reduceStage, type StageAction, type StageEvent, type StageState } from './model'

export interface TempleApproachSceneOptions {
  initialState?: StageState
  canAct?: () => boolean
  carry?: StageCarry
  reduceAction?: (action: StageAction) => StageState
  viewport: { width: number; height: number }
  onReady: (scene: TempleApproachScene) => void
  onState: (state: StageState) => void
  onError: (message: string) => void
  onNotice: (message: string) => void
  onSound: (kind: 'gem' | 'unlock' | 'hurt') => void
}
const additional: AngkorV2AssetKey[] = ['blue-gem-v2', 'potion-v2', 'pressure-plate-v2', 'bronze-temple-key-v2', 'side-gate-locked-v2', 'side-gate-open-v2', 'pushable-boulder-v2', 'spike-trap-active-v2', 'snake-coiled-v2', 'snake-alert-v2', 'snake-slither-a-v2', 'snake-slither-b-v2', 'snake-strike-v2', 'monkey-perched-v2', 'monkey-alert-v2', 'monkey-throw-v2', 'monkey-rock-v2', 'dust-push-v2', 'rock-impact-v2', 'gem-sparkle-v2']

/** Isolated Vault Breaker dev-stage presentation. Approved traversal controls presentation; MOVE is
 * committed on arrival. Fixed explicit TICK actions are recorded for replay.
 * Suspension freezes simulation rather than fast-forwarding invisible attacks. */
export class TempleApproachScene extends Phaser.Scene {
  readonly options: TempleApproachSceneOptions
  state = initialStageState()
  readonly transcript: StageAction[] = []
  traversal?: TileTraversal
  private environment?: AngkorV2Environment
  private explorer?: TraversalPlayer
  private unbind?: () => void
  private scroll = { x: 0, y: 0 }
  private accumulator = 0
  private running = false
  private debug = false
  private reportMs = 0
  private gems = new Map<string, Phaser.GameObjects.Image>()
  private stones = new Map<string, Phaser.GameObjects.Image>()
  private snakes: Phaser.GameObjects.Image[] = []
  private monkey?: Phaser.GameObjects.Image
  private rock?: Phaser.GameObjects.Image
  private pressureGate?: Phaser.GameObjects.Image
  private plate?: Phaser.GameObjects.Image
  private potion?: Phaser.GameObjects.Image
  private rubbleRocks: Phaser.GameObjects.Image[] = []
  private gate?: Phaser.GameObjects.Image
  private key?: Phaser.GameObjects.Image
  private guides?: Phaser.GameObjects.Graphics
  private passage?: Phaser.GameObjects.Image
  private target?: Phaser.GameObjects.Graphics
  private collision?: Phaser.GameObjects.Graphics
  private cameraFrame?: Phaser.GameObjects.Graphics
  private reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
  private failures: string[] = []
  private effects = new Set<Phaser.GameObjects.Image>()
  constructor(options: TempleApproachSceneOptions) { super('TempleApproach'); this.options = options; this.state = options.initialState ?? initialStageState(options.carry) }
  preload() {
    this.load.on('loaderror', (file: Phaser.Loader.File) => this.failures.push(file.key))
    preloadAngkorV2Environment(this, [...additional, ...DECOR.map(p => p.key)])
  }
  create() {
    if (this.failures.length) { this.options.onError('Stage assets could not load. Reload to retry.'); return }
    this.environment = new AngkorV2Environment(this, stageMap.visual)
    for (const p of [...stageMap.structures, ...DECOR]) this.environment.addSprite(p)
    const sprite = (key: AngkorV2AssetKey, coord: GridCoord, depthClass: 'actor' | 'ground-item' | 'low-prop' = 'ground-item') => {
      const foot = tileToPixel(coord)
      return this.environment!.addSprite({ key, ...foot, depthClass, occludesPlayer: false })
    }
    for (const gem of GEMS) this.gems.set(gem.id, sprite('blue-gem-v2', gem))
    this.potion = sprite('potion-v2', POTION)
    this.plate = sprite('pressure-plate-v2', PLATE)
    this.plate.setY(this.plate.y + 15)
    this.pressureGate = this.environment.addSprite({ key: 'side-gate-locked-v2', ...tileToPixel(PRESSURE_GATE), depthY: tileToPixel(PRESSURE_GATE).y + 8, occludesPlayer: false })
    this.pressureGate.setY(this.pressureGate.y + 16)
    this.key = sprite('bronze-temple-key-v2', KEY)
    this.gate = this.environment.addSprite({ key: 'side-gate-locked-v2', ...tileToPixel(GATE), depthY: tileToPixel(GATE).y + 8, occludesPlayer: false })
    this.gate.setY(this.gate.y + 16)
    this.guides = this.add.graphics().setDepth(environmentDepth('floor-overlay', 0))
    for (const b of BOULDERS) {
      this.guides.lineStyle(1,0xd3bd91,.7)
      for(const offset of [10,22]) this.guides.lineBetween(b.x*32+offset,b.minY*32+3,b.x*32+offset,(b.maxY+1)*32-3)
      this.guides.lineStyle(2,0xd3bd91,.7).lineBetween(b.x*32+8,b.minY*32+2,b.x*32+24,b.minY*32+2)
        .lineBetween(b.x*32+8,(b.maxY+1)*32-2,b.x*32+24,(b.maxY+1)*32-2)
    }
    this.rubbleRocks=RUBBLE.tiles.map(tile=>this.add.image(tile.x*32+16,tile.y*32+16,angkorV2TextureKey('monkey-rock-v2')).setDisplaySize(18,18).setDepth(environmentDepth('effect',tile.y*32+16)).setVisible(false))
    for (const stone of this.state.boulders) this.stones.set(stone.id, sprite('pushable-boulder-v2', stone, 'low-prop'))
    for (const group of SPIKES) for (const tile of group.tiles) sprite('spike-trap-active-v2', tile)
    this.snakes = SNAKES.map(s => sprite('snake-coiled-v2', s.path[0], 'actor'))
    this.monkey = sprite('monkey-perched-v2', MONKEY.perches[0], 'actor')
    // Perches lie above solid masonry and have no collision on the floor.
    this.monkey.setY(this.monkey.y - R.tallHeight)
    this.rock = this.add.image(0, 0, angkorV2TextureKey('monkey-rock-v2')).setDisplaySize(13, 13).setDepth(10000).setVisible(false)
    this.passage = this.environment.addSprite({ key: 'temple-passage-closed-height-v2', x: EXIT.x * 32 + 16, y: EXIT.y * 32 + 24, depthY: EXIT.y * 32 + 8, shadow: true })
    this.traversal = new TileTraversal({...stageMap.collision, playerStart: this.state.player}, move => this.animatePush(move), ANGKOR_V2_MOVE_MS, {
      canEnter: (_from, direction) => this.running && (this.options.canAct?.() ?? true) && this.state.status === 'playing' && Boolean(planStageMove(this.state, direction)),
      onArrive: move => this.dispatch({ type: 'MOVE', direction: move.direction }),
    })
    this.explorer = new TraversalPlayer(this, this.environment, this.traversal)
    this.unbind = bindTraversalKeyboard(this.traversal)
    this.scroll = cameraTarget(this.traversal.foot, stageMap.world, this.options.viewport)
    this.cameras.main.setBounds(0, 0, stageMap.world.width, stageMap.world.height).setScroll(this.scroll.x, this.scroll.y)
    this.target = this.add.graphics().setDepth(environmentDepth('ground-item', 0) + 1)
    this.collision = this.add.graphics().setDepth(100000).setVisible(false)
    this.cameraFrame = this.add.graphics().setDepth(100001).setVisible(false)
    this.drawCollision()
    const canvas = this.game.canvas
    canvas.id = 'vault-breaker-stage1-room'; canvas.tabIndex = 0
    canvas.setAttribute('aria-label', 'Vault Breaker Temple Approach. Hold arrows, WASD or directional controls to move.')
    canvas.dataset.collision = JSON.stringify(stageMap.collision.layout)
    canvas.dataset.gems = JSON.stringify(GEMS); canvas.dataset.world = '1024,768'
    canvas.dataset.ready = 'true'
    canvas.dataset.state = JSON.stringify(this.state)
    this.events.once('shutdown', () => { this.unbind?.(); this.explorer?.destroy(); this.environment?.destroy() })
    if (this.options.initialState) restorePresentation(this.state, {gems: this.gems, key: this.key, potion: this.potion, gate: this.gate, pressureGate: this.pressureGate, plate: this.plate, passage: this.passage}); this.options.onReady(this); this.options.onState(this.state)
  }
  start() { this.reset(); this.running = true; this.game.canvas.focus() }
  reset() {
    this.running = false; this.accumulator = 0; this.state = this.options.initialState ?? initialStageState(this.options.carry); this.transcript.length = 0
    this.tweens.killAll(); this.traversal?.reset()
    for (const effect of this.effects) effect.destroy()
    this.effects.clear()
    this.explorer?.sprite.setAlpha(1)
    for (const gem of this.gems.values()) gem.setVisible(true); this.potion?.setVisible(true)
    this.pressureGate?.setTexture(angkorV2TextureKey('side-gate-locked-v2')); this.plate?.clearTint()
    this.key?.setVisible(true); this.gate?.setTexture(angkorV2TextureKey('side-gate-locked-v2')); this.options.onNotice('Find the Bronze Vault Key. Shift stones along their carved rails.')
    for (const b of this.state.boulders) this.stones.get(b.id)?.setPosition(...this.point(b))
    this.syncActors(); this.target?.clear(); this.rock?.setVisible(false); this.passage?.setTexture(angkorV2TextureKey('temple-passage-closed-height-v2'))
    this.scroll = cameraTarget(this.traversal!.foot, stageMap.world, this.options.viewport)
    this.cameras.main.setScroll(this.scroll.x, this.scroll.y); if (this.options.initialState) restorePresentation(this.state, {gems: this.gems, key: this.key, potion: this.potion, gate: this.gate, pressureGate: this.pressureGate, plate: this.plate, passage: this.passage}); this.options.onState(this.state)
    this.game.canvas.dataset.state = JSON.stringify(this.state)
  }
  setDebug(visible: boolean) { this.debug = visible; this.collision?.setVisible(visible); this.cameraFrame?.setVisible(visible); this.options.onState(this.state) }
  exportReplay() {
    const blob = new Blob([JSON.stringify({ schema: 'angkor-vault-breaker-stage1/v1', stageId: 'temple-approach', actions: this.transcript, result: this.state.result }, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = 'temple-approach-local-replay.json'; link.click(); URL.revokeObjectURL(url)
  }
  private dispatch(action: StageAction) {
    const previous = this.state, next = this.options.reduceAction ? this.options.reduceAction(action) : reduceStage(previous, action)
    this.transcript.push(action); this.state = next
    this.game.canvas.dataset.state = JSON.stringify(next)
    for (const event of next.events.slice(previous.events.length)) this.present(event)
    this.syncActors(); if(this.debug)this.drawCollision()
    if (next.status !== 'playing') { this.running = false; this.traversal?.clearInput(); this.options.onState(next) }
    else if (next.events.length !== previous.events.length) this.options.onState(next)
  }
  private point(p: GridCoord): [number, number] { const v = tileToPixel(p); return [v.x, v.y] }
  private animatePush(move: TraversalMove) {
    const plan = planStageMove(this.state, move.direction)
    if (!plan?.push) return
    const sprite = this.stones.get(plan.push.id)!, foot = tileToPixel(plan.push.to)
    this.tweens.add({ targets: sprite, x: foot.x, y: foot.y, duration: ANGKOR_V2_MOVE_MS, onUpdate: () => sprite.setDepth(environmentDepth('low-prop', sprite.y)) })
    this.effect('dust-push-v2', plan.push.from)
  }
  private effect(key: AngkorV2AssetKey, coord: GridCoord) {
    const foot = tileToPixel(coord), image = this.add.image(foot.x, foot.y - 8, angkorV2TextureKey(key)).setDisplaySize(32, 24).setDepth(environmentDepth('effect', foot.y))
    this.effects.add(image)
    this.tweens.add({ targets: image, alpha: 0, duration: this.reduced.matches ? 100 : 360, onComplete: () => { this.effects.delete(image); image.destroy() } })
  }
  private present(event: StageEvent) {
    if(event.type==='GEM_COLLECTED'){this.gems.get(event.id)?.setVisible(false);this.effect('gem-sparkle-v2',this.state.player);this.options.onSound('gem');this.options.onNotice('Optional Gem secured · access is the objective')}
    if(event.type==='POTION_CONSUMED'){this.potion?.setVisible(false);this.options.onSound('gem');this.options.onNotice('Potion used · +'+event.healed+' HP')}
    if(event.type==='RUBBLE_TELEGRAPH')this.options.onNotice('Roof breaking · keep to the clear lane')
    if(event.type==='RUBBLE_IMPACT')for(const tile of event.tiles){this.effect('rock-impact-v2',tile);this.effect('dust-push-v2',tile)}
    if (event.type === 'KEY_COLLECTED') { this.key?.setVisible(false); this.options.onNotice('Bronze Vault Key · breach the Outer Seal'); this.options.onSound('gem') }
    if (event.type === 'MECHANISM_GATE_OPENED' || event.type === 'MECHANISM_GATE_CLOSED') {
      const open = event.type === 'MECHANISM_GATE_OPENED'
      this.pressureGate?.setTexture(angkorV2TextureKey(open ? 'side-gate-open-v2' : 'side-gate-locked-v2'))
      if (open) this.plate?.setTint(0xc8e493); else this.plate?.clearTint()
      this.options.onNotice(open ? 'Mechanism held · inner passage open' : 'Weight removed · mechanism gate closed')
      this.options.onSound('unlock'); this.drawCollision()
    }
    if (event.type === 'OUTER_SEAL_UNLOCKED') { this.gate?.setTexture(angkorV2TextureKey('side-gate-open-v2')); this.options.onNotice('Outer Seal breached · key consumed'); this.options.onSound('unlock') }
    if (event.type === 'EXIT_UNLOCKED') { this.passage?.setTexture(angkorV2TextureKey('temple-passage-open-height-v2')); this.options.onSound('unlock') }
    if (event.type === 'DAMAGE') { this.options.onSound('hurt'); if (!this.reduced.matches) this.cameras.main.flash(90, 90, 22, 15, false) }
    if (event.type === 'MONKEY_ROCK_IMPACT') { this.effect('rock-impact-v2', event.target); this.target?.clear() }
    if (event.type === 'SNAKE_MOVED' && !this.reduced.matches) {
      const image = this.snakes[SNAKES.findIndex(s => s.id === event.id)], from = tileToPixel(event.from), to = tileToPixel(event.to)
      this.tweens.killTweensOf(image); image.setPosition(from.x, from.y)
      this.tweens.add({ targets: image, x: to.x, y: to.y, duration: 145, onUpdate: () => image.setDepth(environmentDepth('actor', image.y)) })
    }
  }
  private syncActors() {
    this.state.snakes.forEach((s, i) => {
      const coord = SNAKES[i].path[s.index], image = this.snakes[i]
      const key = s.mode === 'dormant' ? 'snake-coiled-v2' : s.mode === 'alert' ? 'snake-alert-v2' : s.index % 2 ? 'snake-slither-a-v2' : 'snake-slither-b-v2'
      const foot = tileToPixel(coord)
      image.setTexture(angkorV2TextureKey(key))
      if (!this.tweens.isTweening(image)) image.setPosition(foot.x, foot.y).setDepth(environmentDepth('actor', foot.y))
    })
    const m = this.state.monkey, perch = MONKEY.perches[m.perch], foot = tileToPixel(perch)
    this.monkey?.setTexture(angkorV2TextureKey(m.mode === 'tell' ? m.nextTick - this.state.tick <= 2 ? 'monkey-throw-v2' : 'monkey-alert-v2' : 'monkey-perched-v2')).setPosition(foot.x, foot.y - R.tallHeight).setDepth(environmentDepth('foreground', foot.y + R.tile / 2))
    this.target?.clear()
    if (m.mode === 'tell' && m.target) {
      const p = tileToPixel(m.target), remaining = (m.nextTick - this.state.tick) / 8
      this.target?.fillStyle(0xec8864, .25).fillRect(m.target.x * 32 + 2, m.target.y * 32 + 2, 28, 28)
        .lineStyle(2, 0xffb780, .95).strokeCircle(p.x, p.y, 12).lineBetween(p.x - 6, p.y, p.x + 6, p.y).lineBetween(p.x, p.y - 6, p.x, p.y + 6)
        .lineStyle(3, 0xf3ead7, 1).beginPath().arc(p.x, p.y, 14, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * remaining).strokePath()
    }
    if(this.state.rubble.mode==='tell')for(const tile of RUBBLE.tiles){
      const p=tileToPixel(tile),remaining=(this.state.rubble.nextTick-this.state.tick)/RUBBLE.tellTicks
      this.target?.fillStyle(0xe7ab74,.3).fillRect(tile.x*32+2,tile.y*32+2,28,28).lineStyle(2,0xffd3a0,.95).strokeRect(tile.x*32+3,tile.y*32+3,26,26)
        .lineStyle(2,0xf3ead7,1).beginPath().arc(p.x,p.y,10,-Math.PI/2,-Math.PI/2+Math.PI*2*remaining).strokePath()
    }
  }
  private drawCollision() {
    this.collision?.clear().lineStyle(1, 0x63dbe0, .45)
    for (let y = 0; y < 24; y++) for (let x = 0; x < 32; x++) {
      if (stageMap.collision.layout[y][x] === '#') this.collision?.fillStyle(0xff8072, .16).fillRect(x * 32, y * 32, 32, 32)
      this.collision?.strokeRect(x * 32, y * 32, 32, 32)
      if ((x === GATE.x && y === GATE.y && !this.state.outerSealUnlocked) || (x === PRESSURE_GATE.x && y === PRESSURE_GATE.y && !this.state.mechanismGateOpen) || this.state.boulders.some(b=>b.x===x && b.y===y)) this.collision?.fillStyle(0xf2c14e,.3).fillRect(x*32,y*32,32,32)
    }
  }
  update(_time: number, delta: number) {
    if (!this.environment || !this.explorer || !this.traversal) return
    const active = this.running && (this.options.canAct?.() ?? true) && !document.hidden && document.hasFocus()
    this.tweens.timeScale = active ? 1 : 0
    if (active) {
      this.traversal.update(delta)
      // At most one explicit tick per frame; suspension/slow frames cannot burst attacks.
      this.accumulator += Math.min(delta, 50)
      if (this.accumulator >= SIMULATION_TICK_MS && this.running) { this.accumulator -= SIMULATION_TICK_MS; this.dispatch({ type: 'TICK' }) }
    } else this.traversal.clearInput()
    this.explorer.update(active ? delta : 0, this.reduced.matches); this.environment.update(delta)
    const monkey = this.state.monkey
    const throwing = monkey.mode === 'tell' && monkey.target !== null && monkey.nextTick - this.state.tick <= 2
    this.rock?.setVisible(throwing)
    if (throwing && monkey.target) {
      const from = tileToPixel(MONKEY.perches[monkey.perch]), to = tileToPixel(monkey.target)
      const t = Math.min(1, (2 - (monkey.nextTick - this.state.tick) + this.accumulator / SIMULATION_TICK_MS) / 2)
      const startY = from.y - R.tallHeight - 12
      this.rock?.setPosition(from.x + (to.x - from.x) * t, startY + (to.y - startY) * t - Math.sin(t * Math.PI) * 20)
    }
    const falling=this.state.rubble.mode==='tell'&&this.state.rubble.nextTick-this.state.tick<=2
    this.rubbleRocks.forEach((rock,i)=>{
      rock.setVisible(falling)
      if(falling){const t=Math.min(1,(2-(this.state.rubble.nextTick-this.state.tick)+this.accumulator/SIMULATION_TICK_MS)/2);rock.setY(RUBBLE.tiles[i].y*32+16-(1-t)*60)}
    })
    this.explorer.sprite.setAlpha(this.state.tick < this.state.invulnerableUntil ? .7 : 1)
    this.scroll = followCamera(this.scroll, this.traversal.foot, stageMap.world, delta, this.reduced.matches, this.options.viewport)
    this.cameras.main.setScroll(this.scroll.x, this.scroll.y)
    if (this.debug) this.cameraFrame?.clear().lineStyle(2, 0x81b4ff, .9).strokeRect(this.scroll.x + 1, this.scroll.y + 1, this.options.viewport.width - 2, this.options.viewport.height - 2)
    const d = this.game.canvas.dataset
    d.logical = this.state.player.x + ',' + this.state.player.y; d.moving = String(this.traversal.moving); d.to = this.traversal.activeMove ? this.traversal.activeMove.to.x + ',' + this.traversal.activeMove.to.y : d.logical
    d.status = this.state.status; d.running = String(this.running); d.hp = String(this.state.hp);  d.tick = String(this.state.tick)
    d.scroll = this.scroll.x + ',' + this.scroll.y; d.faded = String(this.environment.fadedStructureCount)
    this.reportMs += delta
    if (this.reportMs > 100) {
      d.state = JSON.stringify(this.state); d.transcript = JSON.stringify(this.transcript); this.reportMs = 0
      if (this.debug) this.options.onState(this.state)
    }
  }
}
