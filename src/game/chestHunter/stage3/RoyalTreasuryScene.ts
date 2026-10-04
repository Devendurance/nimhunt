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
import { EXIT, CHESTS, GATE, KEY, PLATES, PRESSURE_GATE, ROYAL_CACHE_ID, BOULDERS, DART_GUARDIANS, DART_TIMING, MONKEY, SNAKES, DECOR, stageMap } from './level'
import type { StageCarry } from '../contracts'
import { SIMULATION_TICK_MS, initialStageState, planStageMove, reduceStage, type StageAction, type StageEvent, type StageState } from './model'

export interface RoyalTreasurySceneOptions {
  initialState?: StageState
  canAct?: () => boolean
  carry?: StageCarry
  reduceAction?: (action: StageAction) => StageState
  viewport: { width: number; height: number }
  onReady: (scene: RoyalTreasuryScene) => void
  onState: (state: StageState) => void
  onError: (message: string) => void
  onNotice: (message: string) => void
  onSound: (kind: 'gem' | 'unlock' | 'hurt') => void
}
const additional: AngkorV2AssetKey[] = ['potion-v2', 'chest-closed-v2', 'chest-open-v2', 'royal-cache-closed-v2', 'royal-cache-open-v2', 'pressure-plate-v2', 'royal-seal-key-v2', 'side-gate-locked-v2', 'side-gate-open-v2', 'pushable-boulder-v2', 'spike-trap-active-v2', 'snake-coiled-v2', 'snake-alert-v2', 'snake-slither-a-v2', 'snake-slither-b-v2', 'snake-strike-v2', 'monkey-perched-v2', 'monkey-alert-v2', 'monkey-throw-v2', 'monkey-rock-v2', 'dust-push-v2', 'dust-small-v2', 'rock-impact-v2', 'gem-sparkle-v2']

/** Isolated Chest Hunter dev-stage presentation. Approved traversal controls presentation; MOVE is
 * committed on arrival. Fixed explicit TICK actions are recorded for replay.
 * Suspension freezes simulation rather than fast-forwarding invisible attacks. */
export class RoyalTreasuryScene extends Phaser.Scene {
  readonly options: RoyalTreasurySceneOptions
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
  private chests = new Map<string, Phaser.GameObjects.Image>()
  private stones = new Map<string, Phaser.GameObjects.Image>()
  private snakes: Phaser.GameObjects.Image[] = []
  private monkey?: Phaser.GameObjects.Image
  private rock?: Phaser.GameObjects.Image
  private pressureGate?: Phaser.GameObjects.Image
  private plates: Phaser.GameObjects.Image[] = []
  private dartWarnings?:Phaser.GameObjects.Graphics
  private dartProjectiles?:Phaser.GameObjects.Graphics
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
  constructor(options: RoyalTreasurySceneOptions) { super('RoyalTreasury'); this.options = options; this.state = options.initialState ?? initialStageState(options.carry) }
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
    for (const chest of CHESTS) {
      const image = sprite(chest.id===ROYAL_CACHE_ID ? 'royal-cache-closed-v2' : 'chest-closed-v2', chest)
      // The drawn front extends below the cell. Sort at logical contact Y,
      // so opening on entry never hides the Explorer behind the raised lid.
      image.setY(image.y + 10).setDepth(environmentDepth('ground-item', tileToPixel(chest).y))
      this.chests.set(chest.id, image)
    }
    this.plates = PLATES.map(p=>{const image=sprite('pressure-plate-v2',p);image.setY(image.y+15);return image})
    this.pressureGate = this.environment.addSprite({ key: 'side-gate-locked-v2', ...tileToPixel(PRESSURE_GATE), depthY: tileToPixel(PRESSURE_GATE).y + 8, occludesPlayer: false })
    this.pressureGate.setY(this.pressureGate.y + 16)
    this.key = sprite('royal-seal-key-v2', KEY)
    this.gate = this.environment.addSprite({ key: 'side-gate-locked-v2', ...tileToPixel(GATE), depthY: tileToPixel(GATE).y + 8, occludesPlayer: false })
    this.gate.setY(this.gate.y + 16)
    this.guides = this.add.graphics().setDepth(environmentDepth('floor-overlay', 0))
    this.guides.lineStyle(1, 0xd3bd91, .7)
    for(const track of BOULDERS) {
      for(const offset of [10,22])this.guides.lineBetween(track.x*32+offset,track.minY*32+3,track.x*32+offset,(track.maxY+1)*32-3)
      for(const y of [track.minY*32+2,(track.maxY+1)*32-2])this.guides.lineStyle(2,0xd3bd91,.7).lineBetween(track.x*32+8,y,track.x*32+24,y)
    }
    for (const stone of this.state.boulders) this.stones.set(stone.id, sprite('pushable-boulder-v2', stone, 'low-prop'))
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
    this.dartWarnings=this.add.graphics().setDepth(environmentDepth('floor-overlay',0)+1)
    this.dartProjectiles=this.add.graphics().setDepth(10000)
    this.add.rectangle(0,0,this.options.viewport.width,this.options.viewport.height,0x071b16,.10).setOrigin(0).setScrollFactor(0).setDepth(90000)
    this.target = this.add.graphics().setDepth(environmentDepth('ground-item', 0) + 1)
    this.collision = this.add.graphics().setDepth(100000).setVisible(false)
    this.cameraFrame = this.add.graphics().setDepth(100001).setVisible(false)
    this.drawCollision()
    const canvas = this.game.canvas
    canvas.id = 'chest-hunter-stage3-room'; canvas.tabIndex = 0
    canvas.setAttribute('aria-label', 'Chest Hunter Royal Treasury. Hold arrows, WASD or directional controls to move.')
    canvas.dataset.collision = JSON.stringify(stageMap.collision.layout)
    canvas.dataset.chests = JSON.stringify(CHESTS); canvas.dataset.world = '1024,832'
    canvas.dataset.ready = 'true'
    canvas.dataset.state = JSON.stringify(this.state)
    this.events.once('shutdown', () => { this.unbind?.(); this.explorer?.destroy(); this.environment?.destroy() })
    if (this.options.initialState) restorePresentation(this.state, {chests: this.chests, key: this.key, gate: this.gate, pressureGate: this.pressureGate, plates: this.plates, passage: this.passage}); this.options.onReady(this); this.options.onState(this.state)
  }
  start() { this.reset(); this.running = true; this.game.canvas.focus() }
  reset() {
    this.running = false; this.accumulator = 0; this.state = this.options.initialState ?? initialStageState(this.options.carry); this.transcript.length = 0
    this.tweens.killAll(); this.traversal?.reset()
    for (const effect of this.effects) effect.destroy()
    this.effects.clear()
    this.explorer?.sprite.setAlpha(1)
    for (const [id,chest] of this.chests) chest.setTexture(angkorV2TextureKey(id===ROYAL_CACHE_ID ? 'royal-cache-closed-v2' : 'chest-closed-v2'))
    this.pressureGate?.setTexture(angkorV2TextureKey('side-gate-locked-v2')); this.plates.forEach(p=>p.clearTint())
    this.key?.setVisible(true); this.gate?.setTexture(angkorV2TextureKey('side-gate-locked-v2')); this.options.onNotice('Walk onto treasure to open it.')
    for (const b of this.state.boulders) this.stones.get(b.id)?.setPosition(...this.point(b))
    this.syncActors(); this.target?.clear(); this.rock?.setVisible(false); this.passage?.setTexture(angkorV2TextureKey('temple-passage-closed-height-v2'))
    this.scroll = cameraTarget(this.traversal!.foot, stageMap.world, this.options.viewport)
    this.cameras.main.setScroll(this.scroll.x, this.scroll.y); if (this.options.initialState) restorePresentation(this.state, {chests: this.chests, key: this.key, gate: this.gate, pressureGate: this.pressureGate, plates: this.plates, passage: this.passage}); this.options.onState(this.state)
    this.game.canvas.dataset.state = JSON.stringify(this.state)
  }
  setDebug(visible: boolean) { this.debug = visible; this.collision?.setVisible(visible); this.cameraFrame?.setVisible(visible); this.options.onState(this.state) }
  exportReplay() {
    const blob = new Blob([JSON.stringify({ schema: 'angkor-chest-hunter-stage2/v1', stageId: 'forgotten-galleries', actions: this.transcript, result: this.state.result }, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = 'forgotten-galleries-local-replay.json'; link.click(); URL.revokeObjectURL(url)
  }
  private dispatch(action: StageAction) {
    const previous = this.state, next = this.options.reduceAction ? this.options.reduceAction(action) : reduceStage(previous, action)
    this.transcript.push(action); this.state = next
    this.game.canvas.dataset.state = JSON.stringify(next)
    for (const event of next.events.slice(previous.events.length)) this.present(event)
    this.syncActors()
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
    if (event.type === 'CHEST_OPENED') {
      this.chests.get(event.id)?.setTexture(angkorV2TextureKey(event.id===ROYAL_CACHE_ID ? 'royal-cache-open-v2' : 'chest-open-v2'))
      this.effect('gem-sparkle-v2', this.state.player); this.options.onSound('gem')
    }
    if (event.type === 'CHEST_LOOT_RESOLVED' && event.id!==ROYAL_CACHE_ID) {
      const message = event.loot === 'GEMS' ? '+2 Gems secured' : event.loot === 'POTION' ? 'Potion used · +' + event.healed + ' HP'
        : event.loot === 'TRAP' ? 'Trapped chest · watch your HP' : event.loot === 'SWORD' ? event.swordAlreadyOwned ? 'Blade already carried · chest opened' : 'Ancient Blade secured' : 'Nothing but dust · chest opened'
      this.options.onNotice(message)
      if (event.loot === 'POTION') { const foot = tileToPixel(this.state.player); this.effects.add(this.environment!.showItemReceipt('potion-v2', foot.x, foot.y)) }
      if (event.loot === 'TRAP' || event.loot === 'EMPTY') this.effect('dust-push-v2', this.state.player)
    }
    if (event.type === 'KEY_COLLECTED') { this.key?.setVisible(false); this.options.onNotice('Royal Seal Key · find the Twin Seal door'); this.options.onSound('gem') }
    if(event.type.startsWith('PRESSURE_PLATE_')) {
      this.plates.forEach((p,i)=>{if(i===0?this.state.pressurePlateA:this.state.pressurePlateB)p.setTint(0xc8dbb8);else p.clearTint()})
      this.options.onNotice(this.state.pressureGateOpen?'Twin seals held · Royal Vault open':'Hold BOTH seals with their stones')
    }
    if(event.type==='ROYAL_VAULT_GATE_OPENED'||event.type==='ROYAL_VAULT_GATE_CLOSED') {
      const open=event.type==='ROYAL_VAULT_GATE_OPENED'
      this.pressureGate?.setTexture(angkorV2TextureKey(open?'side-gate-open-v2':'side-gate-locked-v2'))
      this.options.onNotice(open?'Both seals held · enter the Royal Vault':'Seal released · Royal Vault closed');this.options.onSound('unlock')
    }
    if(event.type==='ROYAL_CACHE_OPENED'){this.options.onNotice('ROYAL CACHE SECURED · treasure of Angkor');this.options.onSound('unlock')}
    if(event.type==='DART_GUARDIAN_TELEGRAPH')this.options.onNotice('Guardian eyes awake · leave the amber lane')
    if(event.type==='DART_GUARDIAN_IMPACT')for(const p of event.lane)this.effect('dust-small-v2',p)
    if (event.type === 'GATE_UNLOCKED') { this.gate?.setTexture(angkorV2TextureKey('side-gate-open-v2')); this.options.onNotice('Royal Seal door unlocked · key used'); this.options.onSound('unlock') }
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
  }
  private syncDarts(time:number) {
    const warnings=this.dartWarnings,projectiles=this.dartProjectiles
    warnings?.clear();projectiles?.clear()
    this.state.darts.forEach((dart,i)=>{
      if(dart.mode!=='tell'&&dart.mode!=='flight')return
      const authored=DART_GUARDIANS[i],origin=tileToPixel(authored.origin)
      for(const p of dart.lane)warnings?.fillStyle(0xdd945e,.22).fillRect(p.x*32+2,p.y*32+2,28,28).lineStyle(1,0xffcb7e,.85).strokeRect(p.x*32+3,p.y*32+3,26,26)
      const pulse=this.reduced.matches ? .8 : .6+Math.sin(time/120)*.2
      projectiles?.fillStyle(0xffd86a,pulse).fillCircle(origin.x-4,origin.y-25,2).fillCircle(origin.x+4,origin.y-25,2)
      if(dart.mode==='flight') {
        const first=tileToPixel(dart.lane[0]),last=tileToPixel(dart.lane.at(-1)!)
        const t=Math.min(1,(DART_TIMING.flight-(dart.nextTick-this.state.tick)+this.accumulator/SIMULATION_TICK_MS)/DART_TIMING.flight)
        const x=first.x+(last.x-first.x)*t,y=first.y+(last.y-first.y)*t,horizontal=authored.direction==='RIGHT'
        projectiles?.lineStyle(2,0xd3bd91,1).lineBetween(x-(horizontal?7:0),y-(horizontal?0:7),x,y)
        if(horizontal)projectiles?.fillStyle(0xffd86a,1).fillTriangle(x+4,y,x-1,y-3,x-1,y+3)
        else projectiles?.fillStyle(0xffd86a,1).fillTriangle(x,y+4,x-3,y-1,x+3,y-1)
      }
    })
  }
  private drawCollision() {
    this.collision?.clear().lineStyle(1, 0x63dbe0, .45)
    for (let y = 0; y < 26; y++) for (let x = 0; x < 32; x++) {
      if (stageMap.collision.layout[y][x] === '#') this.collision?.fillStyle(0xff8072, .16).fillRect(x * 32, y * 32, 32, 32)
      this.collision?.strokeRect(x * 32, y * 32, 32, 32)
      if ((x === GATE.x && y === GATE.y && !this.state.gateUnlocked) || (x === PRESSURE_GATE.x && y === PRESSURE_GATE.y && !this.state.pressureGateOpen) || this.state.boulders.some(b=>b.x===x && b.y===y)) this.collision?.fillStyle(0xf2c14e,.3).fillRect(x*32,y*32,32,32)
    }
  }
  update(time: number, delta: number) {
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
    this.syncDarts(time)
    this.explorer.sprite.setAlpha(this.state.tick < this.state.invulnerableUntil ? .7 : 1)
    this.scroll = followCamera(this.scroll, this.traversal.foot, stageMap.world, delta, this.reduced.matches, this.options.viewport)
    this.cameras.main.setScroll(this.scroll.x, this.scroll.y)
    if (this.debug) this.drawCollision()
    if (this.debug) this.cameraFrame?.clear().lineStyle(2, 0x81b4ff, .9).strokeRect(this.scroll.x + 1, this.scroll.y + 1, this.options.viewport.width - 2, this.options.viewport.height - 2)
    const d = this.game.canvas.dataset
    d.logical = this.state.player.x + ',' + this.state.player.y; d.moving = String(this.traversal.moving); d.to = this.traversal.activeMove ? this.traversal.activeMove.to.x + ',' + this.traversal.activeMove.to.y : d.logical
    d.status = this.state.status; d.running = String(this.running); d.hp = String(this.state.hp); d.stageChestsOpened = String(this.state.stageChestsOpened); d.tick = String(this.state.tick)
    d.scroll = this.scroll.x + ',' + this.scroll.y; d.faded = String(this.environment.fadedStructureCount)
    this.reportMs += delta
    if (this.reportMs > 100) {
      d.state = JSON.stringify(this.state); d.transcript = JSON.stringify(this.transcript); this.reportMs = 0
      if (this.debug) this.options.onState(this.state)
    }
  }
}
