import Phaser from 'phaser'
import { AngkorV2Environment, preloadAngkorV2Environment } from '../game/rendering/angkorV2/environment'
import { environmentDepth, ANGKOR_V2_RENDER } from '../game/rendering/angkorV2/geometry'
import { environmentFixture, environmentPlacements, environmentPoses } from './angkorV2EnvironmentFixture'

if (import.meta.env.DEV) mountEnvironmentQA()

function mountEnvironmentQA() {
  const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
  const status = element<HTMLParagraphElement>('status'), phone = element<HTMLCanvasElement>('phone')
  const pose = element<HTMLSelectElement>('pose'), readable = element<HTMLInputElement>('readable'), grid = element<HTMLInputElement>('grid')
  const passage = element<HTMLInputElement>('passage'), alternate = element<HTMLInputElement>('alternate'), slider = element<HTMLInputElement>('door-pass')
  let active: { refresh: () => void; rebuild: () => void } | undefined, doorY: number | undefined
  let loadErrors: string[] = []
  class EnvironmentQA extends Phaser.Scene {
    private environment?: AngkorV2Environment
    private explorer?: Phaser.GameObjects.Image
    private footShadow?: Phaser.GameObjects.Ellipse
    private gridLines?: Phaser.GameObjects.Graphics
    private lastStatus = ''
    preload() {
      this.load.on('loaderror', (file: Phaser.Loader.File) => { loadErrors.push(file.key) })
      preloadAngkorV2Environment(this, environmentPlacements.map(p => p.key))
    }
    create() {
      active = { refresh: () => this.refresh(), rebuild: () => this.rebuild() }
      if (loadErrors.length) { status.dataset.error = 'true'; status.textContent = `Failed to load: ${loadErrors.join(', ')}`; return }
      this.rebuild()
      this.events.once('shutdown', () => { active = undefined; loadErrors = [] })
    }
    rebuild() {
      this.environment?.destroy(); this.footShadow?.destroy(); this.gridLines?.destroy()
      this.environment = new AngkorV2Environment(this, environmentFixture(alternate.checked))
      if (!alternate.checked) for (const placement of environmentPlacements) this.environment.addSprite({ ...placement, key: placement.key === 'temple-passage-open-height-v2' && !passage.checked ? 'temple-passage-closed-height-v2' : placement.key })
      this.explorer = this.environment.addSprite({ key: 'explorer-gameplay-down-v2', x: 272, y: 152 })
      this.environment.trackActor(this.explorer)
      this.footShadow = this.add.ellipse(272, 151, 14, 5, 0x24271b, .5)
      this.gridLines = this.add.graphics().setDepth(100000)
      this.gridLines.lineStyle(1, 0x63dbe0, .45)
      for (let i = 0; i <= 12; i++) { this.gridLines.lineBetween(i * 32, 0, i * 32, 384); this.gridLines.lineBetween(0, i * 32, 384, i * 32) }
      this.refresh()
    }
    refresh() {
      const selected = environmentPoses[pose.value as keyof typeof environmentPoses]
      this.explorer?.setPosition(doorY === undefined ? selected.x : 240, doorY ?? selected.y)
      this.environment?.setReadabilityEnabled(readable.checked)
      this.gridLines?.setVisible(grid.checked)
    }
    update(_time: number, delta: number) {
      if (!this.environment || !this.explorer) return
      this.environment.update(delta)
      this.footShadow?.setPosition(this.explorer.x, this.explorer.y - 1).setDepth(environmentDepth('actor', this.explorer.y) - .5)
      const text = `Phaser environment · ${this.environment.wallModules.length} reusable wall modules · Explorer foot (${this.explorer.x.toFixed(1)}, ${this.explorer.y.toFixed(1)}) · ${this.environment.fadedStructureCount} structures fading · no gameplay`
      if (text !== this.lastStatus) { status.textContent = text; this.lastStatus = text }
      const canvas = this.game.canvas
      canvas.id = 'room'; canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', 'Complete Angkor V2 environment composed by the reusable Phaser builder')
      canvas.dataset.ready = 'true'; canvas.dataset.faded = String(this.environment.fadedStructureCount)
      canvas.dataset.depth = String(this.explorer.depth); canvas.dataset.foot = `${this.explorer.x},${this.explorer.y}`
      canvas.dataset.settled = String(this.environment.readabilitySettled)
      canvas.dataset.runtimeTextures = String(this.textures.getTextureKeys().filter(key => key.startsWith('angkor-v2/runtime/')).length)
      canvas.dataset.objects = String(this.children.length)
      // Snapshot after Phaser renders, so the phone shows the very same frame.
    }
  }
  const game = new Phaser.Game({
    type: Phaser.CANVAS, parent: 'world', width: 384, height: 384,
    backgroundColor: '#132a26', render: { antialias: true, pixelArt: false },
    scale: { mode: Phaser.Scale.NONE }, scene: [EnvironmentQA], fps: { target: 30 },
  })
  const postRender = () => {
    const ctx = phone.getContext('2d')!
    ctx.clearRect(0, 0, 320, 384); ctx.drawImage(game.canvas, 32, 0, 320, 384, 0, 0, 320, 384)
  }
  game.events.on('postrender', postRender)
  pose.addEventListener('change', () => { doorY = undefined; active?.refresh() })
  readable.addEventListener('change', () => active?.refresh())
  grid.addEventListener('change', () => active?.refresh())
  passage.addEventListener('change', () => active?.rebuild())
  alternate.addEventListener('change', () => { doorY = undefined; active?.rebuild() })
  slider.addEventListener('input', () => { pose.value = 'doorway'; doorY = 6.65 * ANGKOR_V2_RENDER.tile + Number(slider.value) * .64; active?.refresh() })
  window.addEventListener('pagehide', () => { game.events.off('postrender', postRender); game.destroy(true) }, { once: true })
}
