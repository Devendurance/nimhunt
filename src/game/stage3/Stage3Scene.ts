import Phaser from 'phaser'
import { AngkorV2Environment, angkorV2TextureKey, preloadAngkorV2Environment } from '../rendering/angkorV2/environment'
import { ANGKOR_V2_RENDER as R, environmentDepth, readabilityOccluders, readabilityAlpha } from '../rendering/angkorV2/geometry'
import { TileTraversal, type TraversalMove, ANGKOR_V2_MOVE_MS } from '../traversal/angkorV2/movement'
import { TraversalPlayer } from '../traversal/angkorV2/player'
import { bindTraversalKeyboard } from '../traversal/angkorV2/input'
import { cameraTarget, followCamera } from '../traversal/angkorV2/camera'
import { tileToPixel, type GridCoord } from '../world/grid'
import type { AngkorV2AssetKey } from '../assets/angkorV2Manifest'
import { ANACONDA, EXIT, GEMS, MONKEYS, PITS, RUBBLE, BOULDERS, SNAKES, SPIKES, STAGE_DECOR, stageMap } from './level'
import { SIMULATION_TICK_MS, initialStageState, planStageMove, reduceStage, type StageAction, type StageEvent, type StageState } from './model'
import type { StageCarry } from '../gemRunner/contracts'

export interface Stage3SceneOptions {
  carry: StageCarry
  /** Local expedition authority; the isolated Stage III reducer remains the fallback. */
  reduceAction?: (action: StageAction) => StageState
  viewport: { width: number; height: number }
  onReady: (scene: Stage3Scene) => void
  onState: (state: StageState) => void
  onError: (message: string) => void
  onSound: (kind: 'gem' | 'unlock' | 'hurt') => void
}
const additional: AngkorV2AssetKey[] = ['blue-gem-v2', 'pushable-boulder-v2', 'spike-trap-active-v2', 'snake-coiled-v2', 'snake-alert-v2', 'snake-slither-a-v2', 'snake-slither-b-v2', 'snake-strike-v2', 'monkey-perched-v2', 'monkey-alert-v2', 'monkey-throw-v2', 'monkey-rock-v2', 'dust-push-v2', 'rock-impact-v2', 'gem-sparkle-v2', 'anaconda-coiled-v2', 'anaconda-rise-v2', 'anaconda-strike-v2', 'anaconda-retreat-v2']

/** Local dev-stage adapter. Approved traversal controls presentation; MOVE is
 * committed on arrival. Fixed explicit TICK actions are recorded for replay.
 * Suspension freezes simulation rather than fast-forwarding invisible attacks. */
export class Stage3Scene extends Phaser.Scene {
  readonly options: Stage3SceneOptions
  state: StageState
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
  private monkeys: Phaser.GameObjects.Image[] = []
  private rocks: Phaser.GameObjects.Image[] = []
  private rubbleRocks: Phaser.GameObjects.Image[] = []
  private boss?: Phaser.GameObjects.Image
  private passageBody?: Phaser.GameObjects.Image
  private bossRock?: Phaser.GameObjects.Image
  private replacementRock?: Phaser.GameObjects.Image
  private bossAlpha = 1
  private strikeUntil = -1
  private recoilUntil = -1
  private passage?: Phaser.GameObjects.Image
  private target?: Phaser.GameObjects.Graphics
  private collision?: Phaser.GameObjects.Graphics
  private cameraFrame?: Phaser.GameObjects.Graphics
  private reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
  private failures: string[] = []
  private effects = new Set<Phaser.GameObjects.Image>()
  constructor(options: Stage3SceneOptions) { super('InnerSanctuary'); this.options = options; this.state = initialStageState(options.carry) }
  preload() {
    this.load.on('loaderror', (file: Phaser.Loader.File) => this.failures.push(file.key))
    preloadAngkorV2Environment(this, [...additional, ...STAGE_DECOR.map(p => p.key)])
  }
  create() {
    if (this.failures.length) { this.options.onError('Stage assets could not load. Reload to retry.'); return }
    this.environment = new AngkorV2Environment(this, stageMap.visual)
    for (const p of [...stageMap.structures, ...STAGE_DECOR]) this.environment.addSprite(p)
    this.boss = this.add.image(0, 0, angkorV2TextureKey('anaconda-rise-v2')).setOrigin(.5, 504 / 512).setDisplaySize(112, 112).setVisible(false)
    this.bossRock = this.add.image(0, 0, angkorV2TextureKey('pushable-boulder-v2')).setDisplaySize(30, 30).setDepth(20000).setVisible(false)
    this.replacementRock = this.add.image(0, 0, angkorV2TextureKey('pushable-boulder-v2')).setDisplaySize(30, 30).setDepth(20000).setVisible(false)
    // A visible section of the same serpent rises along the solid central spine.
    // Its visual footprint stays over masonry; only authored gate cells block.
    this.passageBody = this.add.image(15 * 32 + 16, 10 * 32 - R.tallHeight, angkorV2TextureKey('anaconda-body-v2'))
      .setDisplaySize(64, 30).setAngle(90).setDepth(environmentDepth('foreground', 11 * 32)).setAlpha(.7)
    const sprite = (key: AngkorV2AssetKey, coord: GridCoord, depthClass: 'actor' | 'ground-item' | 'low-prop' = 'ground-item') => {
      const foot = tileToPixel(coord)
      return this.environment!.addSprite({ key, ...foot, depthClass, occludesPlayer: false })
    }
    for (const gem of GEMS) this.gems.set(gem.id, sprite('blue-gem-v2', gem))
    for (const stone of this.state.boulders) {
      // A raised stone cradle makes the boulder a drop mechanism, not a loose rock.
      const foot = tileToPixel(stone)
      this.environment.addSprite({ key: 'pillar-broken-height-v2', ...foot, depthY: PITS[BOULDERS.find(b => b.id === stone.id)!.pit].y * 32 + 42, occludesPlayer: false }).setDisplaySize(24, 36)
      this.stones.set(stone.id, sprite('pushable-boulder-v2', stone, 'low-prop').setY(foot.y - 8).setDepth(20000))
    }
    for (const group of SPIKES) for (const tile of group.tiles) sprite('spike-trap-active-v2', tile)
    this.snakes = SNAKES.map(s => sprite('snake-coiled-v2', s.path[0], 'actor'))
    this.monkeys = MONKEYS.map(m => sprite('monkey-perched-v2', m.perches[0], 'actor'))
    this.rocks = MONKEYS.map(() => this.add.image(0, 0, angkorV2TextureKey('monkey-rock-v2')).setDisplaySize(13, 13).setDepth(10000).setVisible(false))
    // Engraved short tracks and empty parking recesses explain constrained pushes.
    const tracks = this.add.graphics().setDepth(environmentDepth('floor-overlay', 0))
    for (const b of BOULDERS) {
      tracks.lineStyle(2, 0xb3b68a, .75).strokeRect(b.drop.x * 32 + 4, b.drop.y * 32 + 4, 24, 24)
      tracks.lineBetween(b.x * 32 + 16, b.y * 32 + 16, b.drop.x * 32 + 16, b.drop.y * 32 + 16)
    }
    this.rubbleRocks = RUBBLE.tiles.map(tile => this.add.image(tile.x * 32 + 16, tile.y * 32 + 16, angkorV2TextureKey('monkey-rock-v2')).setDisplaySize(15, 15).setDepth(environmentDepth('effect', tile.y * 32 + 16)).setVisible(false))
    this.passage = this.environment.addSprite({ key: 'temple-passage-closed-height-v2', x: EXIT.x * 32 + 16, y: EXIT.y * 32 + 24, depthY: EXIT.y * 32 + 8, shadow: true })
    this.traversal = new TileTraversal(stageMap.collision, move => this.animatePush(move), ANGKOR_V2_MOVE_MS, {
      canEnter: (_from, direction) => this.running && this.state.status === 'playing' && Boolean(planStageMove(this.state, direction)),
      onArrive: move => this.dispatch({ type: 'MOVE', direction: move.direction }),
    })
    this.explorer = new TraversalPlayer(this, this.environment, this.traversal)
    this.unbind = bindTraversalKeyboard(this.traversal)
    this.scroll = cameraTarget(this.traversal.foot, stageMap.world, this.options.viewport)
    this.cameras.main.setBounds(0, 0, stageMap.world.width, stageMap.world.height).setScroll(this.scroll.x, this.scroll.y)
    // Quiet jungle shade affects presentation only; collision and simulation are unchanged.
    this.add.rectangle(0, 0, this.options.viewport.width, this.options.viewport.height, 0x10221e, .23).setOrigin(0).setScrollFactor(0).setDepth(50000)
    this.target = this.add.graphics().setDepth(environmentDepth('ground-item', 0) + 1)
    this.collision = this.add.graphics().setDepth(100000).setVisible(false)
    this.cameraFrame = this.add.graphics().setDepth(100001).setVisible(false)
    this.drawCollision()
    const canvas = this.game.canvas
    canvas.id = 'stage3-room'; canvas.tabIndex = 0
    canvas.setAttribute('aria-label', 'Gem Runner Inner Sanctuary. Hold arrows, WASD or directional controls to move.')
    canvas.dataset.collision = JSON.stringify(stageMap.collision.layout)
    canvas.dataset.gems = JSON.stringify(GEMS); canvas.dataset.world = '960,768'
    canvas.dataset.ready = 'true'
    canvas.dataset.state = JSON.stringify(this.state)
    this.events.once('shutdown', () => { this.unbind?.(); this.explorer?.destroy(); this.environment?.destroy() })
    this.options.onReady(this); this.options.onState(this.state)
  }
  start() { this.reset(); this.running = true; this.game.canvas.focus() }
  reset() {
    this.running = false; this.accumulator = 0; this.state = initialStageState(this.options.carry); this.transcript.length = 0
    this.tweens.killAll(); this.traversal?.reset()
    for (const effect of this.effects) effect.destroy()
    this.effects.clear()
    this.explorer?.sprite.setAlpha(1)
    for (const gem of this.gems.values()) gem.setVisible(true)
    for (const b of this.state.boulders) { const foot = tileToPixel(b); this.stones.get(b.id)?.setPosition(foot.x, foot.y - 8).setVisible(true) }
    this.bossAlpha = 1; this.strikeUntil = -1; this.recoilUntil = -1; this.syncActors(); this.target?.clear(); this.rocks.forEach(rock => rock.setVisible(false)); this.passage?.setTexture(angkorV2TextureKey('temple-passage-closed-height-v2'))
    this.scroll = cameraTarget(this.traversal!.foot, stageMap.world, this.options.viewport)
    this.cameras.main.setScroll(this.scroll.x, this.scroll.y); this.options.onState(this.state)
    this.game.canvas.dataset.state = JSON.stringify(this.state)
  }
  setDebug(visible: boolean) { this.debug = visible; this.collision?.setVisible(visible); this.cameraFrame?.setVisible(visible); this.options.onState(this.state) }
  exportReplay() {
    const blob = new Blob([JSON.stringify({ schema: 'angkor-stage3-local/v2', actions: this.transcript, result: this.state.result }, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = 'inner-sanctuary-local-replay.json'; link.click(); URL.revokeObjectURL(url)
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
  private animatePush(move: TraversalMove) {
    const plan = planStageMove(this.state, move.direction)
    if (!plan?.push) return
    const sprite = this.stones.get(plan.push.id)!, foot = tileToPixel(plan.push.to)
    this.tweens.add({ targets: sprite, x: foot.x, y: foot.y - 8, duration: ANGKOR_V2_MOVE_MS })
    this.effect('dust-push-v2', plan.push.from)
  }
  private effect(key: AngkorV2AssetKey, coord: GridCoord) {
    const foot = tileToPixel(coord), image = this.add.image(foot.x, foot.y - 8, angkorV2TextureKey(key)).setDisplaySize(32, 24).setDepth(environmentDepth('effect', foot.y))
    this.effects.add(image)
    this.tweens.add({ targets: image, alpha: 0, duration: this.reduced.matches ? 100 : 360, onComplete: () => { this.effects.delete(image); image.destroy() } })
  }
  private present(event: StageEvent) {
    if (event.type === 'GEM_COLLECTED') { this.gems.get(event.id)?.setVisible(false); this.effect('gem-sparkle-v2', this.state.player); this.options.onSound('gem') }
    if (event.type === 'EXIT_UNLOCKED') { this.passage?.setTexture(angkorV2TextureKey('temple-passage-open-height-v2')); this.options.onSound('unlock') }
    if (event.type === 'DAMAGE') { this.options.onSound('hurt'); if (!this.reduced.matches) this.cameras.main.flash(90, 90, 22, 15, false) }
    if (event.type === 'ANACONDA_EMERGED') { this.effect('dust-push-v2', PITS[event.pit]); this.bossAlpha = 1 }
    if (event.type === 'BOULDER_DROP_TRIGGERED') this.stones.get(event.id)?.setVisible(false)
    if (event.type === 'ANACONDA_RETALIATION_IMPACT') {
      this.strikeUntil = this.state.tick + 3
      for (const tile of event.tiles) this.effect('dust-push-v2', tile)
      if (!this.reduced.matches) this.cameras.main.shake(220, .006)
    }
    if (event.type === 'ANACONDA_HIT' || event.type === 'ANACONDA_DEFEATED') {
      this.recoilUntil = this.state.tick + 4
      const pit = PITS[this.state.anaconda.activePit]
      this.effect('rock-impact-v2', pit)
      for (const dx of [-1, 0, 1]) this.effect('dust-push-v2', { x: pit.x + dx, y: pit.y })
      if (!this.reduced.matches) this.cameras.main.shake(event.type === 'ANACONDA_DEFEATED' ? 500 : 260, event.type === 'ANACONDA_DEFEATED' ? .012 : .007)
    }
    if (event.type === 'REPLACEMENT_BOULDER_IMPACT') { this.effect('rock-impact-v2', event.tile); this.effect('dust-push-v2', event.tile) }
    if (event.type === 'REPLACEMENT_BOULDER_READY') {
      const foot = tileToPixel(event.tile)
      this.stones.get(event.id)?.setPosition(foot.x, foot.y - 8).setVisible(true)
    }
    if (event.type === 'RUBBLE_IMPACT') for (const tile of event.tiles) { this.effect('rock-impact-v2', tile); this.effect('dust-push-v2', tile) }
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
      const key = s.mode === 'dormant' ? 'snake-coiled-v2' : s.mode === 'alert' ? 'snake-alert-v2' : coord.x === this.state.player.x && coord.y === this.state.player.y ? 'snake-strike-v2' : s.index % 2 ? 'snake-slither-a-v2' : 'snake-slither-b-v2'
      const foot = tileToPixel(coord)
      image.setTexture(angkorV2TextureKey(key))
      if (!this.tweens.isTweening(image)) image.setPosition(foot.x, foot.y).setDepth(environmentDepth('actor', foot.y))
    })
    this.target?.clear()
    this.state.monkeys.forEach((m, i) => {
      const foot = tileToPixel(MONKEYS[i].perches[m.perch])
      this.monkeys[i]?.setTexture(angkorV2TextureKey(m.mode === 'tell' ? m.nextTick - this.state.tick <= 2 ? 'monkey-throw-v2' : 'monkey-alert-v2' : 'monkey-perched-v2')).setPosition(foot.x, foot.y - R.tallHeight).setDepth(environmentDepth('foreground', foot.y + R.tile / 2))
      if (m.mode === 'tell' && m.target) this.drawTell(m.target, (m.nextTick - this.state.tick) / MONKEYS[i].tellTicks, i ? 0xe9c276 : 0xec8864)
    })
    const boss = this.state.anaconda
    this.passageBody?.setVisible(boss.mode !== 'DEFEATED').setAlpha(.65)
    this.boss?.setTexture(angkorV2TextureKey(boss.mode === 'DEFEATED' || this.state.tick < this.recoilUntil ? 'anaconda-retreat-v2' : this.state.tick < this.strikeUntil ? 'anaconda-strike-v2' : boss.mode === 'RECOVERING' ? 'anaconda-retreat-v2' : 'anaconda-rise-v2'))
    if (boss.mode === 'RETALIATING') for (const tile of boss.targets) {
      // Whole horizontal lanes, not tiny target circles. North and south recesses stay clear.
      this.target?.fillStyle(0xea704f, .38).fillRect(tile.x * 32, tile.y * 32, 32, 32)
        .lineStyle(2, 0xf3b08c, .95).lineBetween(tile.x * 32, tile.y * 32 + 3, tile.x * 32 + 32, tile.y * 32 + 3)
        .lineBetween(tile.x * 32 + 5, tile.y * 32 + 25, tile.x * 32 + 23, tile.y * 32 + 7)
    }
    if (boss.mode === 'EMERGING' || boss.mode === 'VULNERABLE') {
      const track = BOULDERS.find(b => b.pit === boss.activePit)!, color = boss.mode === 'VULNERABLE' ? 0x88dfbe : 0xe9bb87
      this.target?.lineStyle(3, color, 1).strokeRect(track.x * 32 + 3, 10 * 32 + 3, 26, 26)
        .lineBetween(track.x * 32 + 16, 10 * 32 + 13, track.x * 32 + 16, 12 * 32 + 12)
        .lineBetween(track.x * 32 + 8, 12 * 32 + 4, track.x * 32 + 16, 12 * 32 + 12)
        .lineBetween(track.x * 32 + 24, 12 * 32 + 4, track.x * 32 + 16, 12 * 32 + 12)
    }
    if (boss.replacement?.mode === 'TELEGRAPH') {
      const track = BOULDERS.find(b => b.id === boss.replacement!.id)!
      this.drawTell(track, Math.max(0, (boss.replacement.impactTick - this.state.tick) / ANACONDA.phases[boss.phase - 1].replacementTicks), 0xe9c276)
    }
    if (this.state.rubble.mode === 'tell') for (const tile of RUBBLE.tiles) this.drawTell(tile, (this.state.rubble.nextTick - this.state.tick) / RUBBLE.tellTicks, 0xc9baa0)
  }
  private drawTell(tile: GridCoord, remaining: number, color: number) {
    const p = tileToPixel(tile)
    this.target?.fillStyle(color, .3).fillRect(tile.x * 32 + 2, tile.y * 32 + 2, 28, 28)
      .lineStyle(2, color, .95).strokeCircle(p.x, p.y, 12).lineBetween(p.x - 6, p.y, p.x + 6, p.y).lineBetween(p.x, p.y - 6, p.x, p.y + 6)
      .lineStyle(3, 0xf3ead7, 1).beginPath().arc(p.x, p.y, 14, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * remaining).strokePath()
  }
  private drawCollision() {
    this.collision?.clear().lineStyle(1, 0x63dbe0, .45)
    for (let y = 0; y < 24; y++) for (let x = 0; x < 30; x++) {
      if (stageMap.collision.layout[y][x] === '#') this.collision?.fillStyle(0xff8072, .16).fillRect(x * 32, y * 32, 32, 32)
      this.collision?.strokeRect(x * 32, y * 32, 32, 32)
    }
  }
  update(_time: number, delta: number) {
    if (!this.environment || !this.explorer || !this.traversal) return
    const active = this.running && !document.hidden && document.hasFocus()
    this.tweens.timeScale = active ? 1 : 0
    if (active) {
      this.traversal.update(delta)
      // At most one explicit tick per frame; suspension/slow frames cannot burst attacks.
      this.accumulator += Math.min(delta, 50)
      if (this.accumulator >= SIMULATION_TICK_MS && this.running) { this.accumulator -= SIMULATION_TICK_MS; this.dispatch({ type: 'TICK' }) }
    } else this.traversal.clearInput()
    this.explorer.update(active ? delta : 0, this.reduced.matches); this.environment.update(delta)
    this.state.monkeys.forEach((monkey, i) => {
      const throwing = monkey.mode === 'tell' && monkey.target !== null && monkey.nextTick - this.state.tick <= 2
      const rock = this.rocks[i]; rock?.setVisible(throwing)
      if (throwing && monkey.target) {
        const from = tileToPixel(MONKEYS[i].perches[monkey.perch]), to = tileToPixel(monkey.target)
        const t = this.reduced.matches ? 1 : Math.min(1, (2 - (monkey.nextTick - this.state.tick) + this.accumulator / SIMULATION_TICK_MS) / 2)
        const startY = from.y - R.tallHeight - 12
        rock?.setPosition(from.x + (to.x - from.x) * t, startY + (to.y - startY) * t - Math.sin(t * Math.PI) * 20)
      }
    })
    const falling = this.state.rubble.mode === 'tell' && this.state.rubble.nextTick - this.state.tick <= 2
    this.rubbleRocks.forEach((rock, i) => {
      rock.setVisible(falling)
      if (falling) { const tile = RUBBLE.tiles[i], t = Math.min(1, (2 - (this.state.rubble.nextTick - this.state.tick) + this.accumulator / SIMULATION_TICK_MS) / 2); rock.setY(tile.y * 32 + 16 - (1 - t) * 54) }
    })
    const boss = this.state.anaconda, pit = PITS[boss.activePit], pitFoot = tileToPixel(pit)
    const fraction = this.accumulator / SIMULATION_TICK_MS
    const emerge = boss.mode === 'EMERGING' ? Math.min(1, 1 - (boss.nextTick - this.state.tick - fraction) / ANACONDA.emergenceTicks) : 1
    const collapse = boss.mode === 'DEFEATED' ? Math.min(1, (this.state.tick - boss.defeatedAt! + fraction) / ANACONDA.defeatTicks) : boss.mode === 'RECOVERING' ? .35 : 0
    if (this.boss) {
      const base = pitFoot.y + 24, depth = environmentDepth('architecture', base)
      const y = base + (1 - emerge) * 32 + collapse * 42
      this.boss.setPosition(pitFoot.x + (this.reduced.matches || boss.mode !== 'EMERGING' ? 0 : Math.sin(emerge * Math.PI * 10) * 2), y)
        .setDisplaySize(112, 112 * (1 - collapse * .5)).setDepth(depth).setVisible(boss.mode !== 'DORMANT' && collapse < 1)
      // Reuse the renderer's alpha-aware readability rule for this moving boss.
      const image = this.boss, bounds = { x: image.x - 56, y: y - image.displayHeight * image.originY, width: 112, height: image.displayHeight }
      const covered = readabilityOccluders({ ...this.traversal.foot, width: 25, visibleHeight: 28 }, [{ bounds, depth,
        opaqueAt: (x, py) => (this.textures.getPixelAlpha(Math.floor((x - bounds.x) / 112 * 512), Math.floor((py - bounds.y) / bounds.height * 512), image.texture.key) ?? 0) > 32 }])
      const alpha = readabilityAlpha(covered.length)
      this.bossAlpha += (alpha - this.bossAlpha) * Math.min(1, delta / 100)
      image.setAlpha(this.bossAlpha * emerge * (1 - collapse))
    }
    if (this.bossRock) {
      this.bossRock.setVisible(Boolean(boss.pendingDrop))
      if (boss.pendingDrop) {
        const t = Math.min(1, 1 - (boss.pendingDrop.impactTick - this.state.tick - fraction) / ANACONDA.dropTicks)
        this.bossRock.setPosition(pitFoot.x, 11 * 32 + 8 + t * 48).setAngle(t * 100)
      }
    }
    if (this.replacementRock) {
      const replacement = boss.replacement
      this.replacementRock.setVisible(Boolean(replacement && replacement.mode !== 'WAITING'))
      if (replacement && replacement.mode !== 'WAITING') {
        const track = BOULDERS.find(b => b.id === replacement.id)!, ticks = ANACONDA.phases[boss.phase - 1].replacementTicks
        const t = replacement.mode === 'LANDED' ? 1 : Math.min(1, Math.max(0, 1 - (replacement.impactTick - this.state.tick - fraction) / ticks))
        this.replacementRock.setPosition(track.x * 32 + 16, track.y * 32 + 8 - (1 - t) * 110).setAlpha(t < .6 ? .45 : 1)
      }
    }
    this.explorer.sprite.setAlpha(this.state.tick < this.state.invulnerableUntil ? .7 : 1)
    this.scroll = followCamera(this.scroll, this.traversal.foot, stageMap.world, delta, this.reduced.matches, this.options.viewport)
    this.cameras.main.setScroll(this.scroll.x, this.scroll.y)
    if (this.debug) this.cameraFrame?.clear().lineStyle(2, 0x81b4ff, .9).strokeRect(this.scroll.x + 1, this.scroll.y + 1, this.options.viewport.width - 2, this.options.viewport.height - 2)
    const d = this.game.canvas.dataset
    d.logical = this.state.player.x + ',' + this.state.player.y; d.moving = String(this.traversal.moving); d.to = this.traversal.activeMove ? this.traversal.activeMove.to.x + ',' + this.traversal.activeMove.to.y : d.logical
    d.status = this.state.status; d.running = String(this.running); d.hp = String(this.state.hp); d.stageGems = String(this.state.stageGems); d.tick = String(this.state.tick)
    d.scroll = this.scroll.x + ',' + this.scroll.y; d.faded = String(this.environment.fadedStructureCount)
    this.reportMs += delta
    if (this.reportMs > 100) {
      d.state = JSON.stringify(this.state); d.transcript = JSON.stringify(this.transcript); this.reportMs = 0
      if (this.debug || this.state.anaconda.mode !== 'DORMANT') this.options.onState(this.state)
    }
  }
}
