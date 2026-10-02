import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import Phaser from 'phaser'
import { DirectionalDpad } from '../components/play/DirectionalDpad'
import { AngkorV2Environment, preloadAngkorV2Environment } from '../game/rendering/angkorV2/environment'
import { TileTraversal, type TraversalMove } from '../game/traversal/angkorV2/movement'
import { TraversalPlayer } from '../game/traversal/angkorV2/player'
import { bindTraversalKeyboard } from '../game/traversal/angkorV2/input'
import { traversalViewport, cameraTarget, followCamera } from '../game/traversal/angkorV2/camera'
import { traversalMap, traversalNature } from './angkorV2TraversalFixture'
import { TILE_SIZE } from '../game/world/grid'
import './angkorV2Traversal.css'

interface SceneBridge { reset: () => void; setDebug: (visible: boolean) => void }

export function TraversalQA() {
  const host = useRef<HTMLDivElement>(null), controller = useRef<TileTraversal | null>(null)
  const bridge = useRef<SceneBridge | null>(null)
  const [ready, setReady] = useState(false), [error, setError] = useState(''), [debug, setDebug] = useState(false)
  const [stats, setStats] = useState('')
  useEffect(() => {
    if (!host.current) return
    let mounted = true
    const viewport = traversalViewport(window.innerWidth, window.innerHeight)
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    class TraversalScene extends Phaser.Scene {
      private environment?: AngkorV2Environment
      private player?: TraversalPlayer
      private traversal?: TileTraversal
      private unbind?: () => void
      private collisionGrid?: Phaser.GameObjects.Graphics
      private cameraFrame?: Phaser.GameObjects.Graphics
      private scroll = { x: 0, y: 0 }
      private debugVisible = false
      private reportElapsed = 0
      private moves: TraversalMove[] = []
      private lastSeq = -1
      private failures: string[] = []
      preload() {
        this.load.on('loaderror', (file: Phaser.Loader.File) => this.failures.push(file.key))
        preloadAngkorV2Environment(this, traversalNature.map(p => p.key))
      }
      create() {
        if (this.failures.length) { if (mounted) setError('Could not load traversal assets. Reload to retry.'); return }
        this.environment = new AngkorV2Environment(this, traversalMap.visual)
        for (const placement of [...traversalMap.structures, ...traversalNature]) this.environment.addSprite(placement)
        this.traversal = new TileTraversal(traversalMap.collision, move => {
          this.moves.push(move); if (this.moves.length > 256) this.moves.shift()
        })
        controller.current = this.traversal
        this.player = new TraversalPlayer(this, this.environment, this.traversal)
        this.unbind = bindTraversalKeyboard(this.traversal)
        this.scroll = cameraTarget(this.traversal.foot, traversalMap.world, viewport)
        this.cameras.main.setBounds(0, 0, traversalMap.world.width, traversalMap.world.height).setScroll(this.scroll.x, this.scroll.y)
        this.collisionGrid = this.add.graphics().setDepth(100000).setVisible(false)
        this.collisionGrid.lineStyle(1, 0x63dbe0, .5)
        for (let y = 0; y < traversalMap.collision.height; y++) for (let x = 0; x < traversalMap.collision.width; x++) {
          if (traversalMap.collision.layout[y][x] === '#') { this.collisionGrid.fillStyle(0xff8072, .16); this.collisionGrid.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE) }
          this.collisionGrid.strokeRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE)
        }
        this.cameraFrame = this.add.graphics().setDepth(100001).setVisible(false)
        bridge.current = { reset: () => this.resetTraversal(), setDebug: visible => {
          this.debugVisible = visible; this.collisionGrid?.setVisible(visible); this.cameraFrame?.setVisible(visible)
        } }
        const canvas = this.game.canvas
        canvas.id = 'traversal-room'; canvas.tabIndex = 0
        canvas.setAttribute('aria-label', 'Playable Angkor traversal. Use directional controls or arrows and WASD.')
        canvas.dataset.world = traversalMap.world.width + ',' + traversalMap.world.height; canvas.dataset.viewport = viewport.width + ',' + viewport.height
        canvas.dataset.collision = JSON.stringify(traversalMap.collision.layout)
        if (mounted) setReady(true)
        this.events.once('shutdown', () => {
          this.unbind?.(); this.player?.destroy(); this.environment?.destroy()
          controller.current = null; bridge.current = null
        })
      }
      update(_time: number, delta: number) {
        if (!this.environment || !this.player || !this.traversal) return
        this.traversal.update(delta)
        this.player.update(delta, media.matches)
        this.environment.update(delta)
        this.scroll = followCamera(this.scroll, this.traversal.foot, traversalMap.world, delta, media.matches, viewport)
        this.cameras.main.setScroll(this.scroll.x, this.scroll.y)
        if (this.debugVisible) {
          this.cameraFrame?.clear().lineStyle(2, 0x81b4ff, .9).strokeRect(this.scroll.x + 1, this.scroll.y + 1, viewport.width - 2, viewport.height - 2)
          this.reportElapsed += delta
          if (this.reportElapsed > 100 && mounted) {
            setStats('Tile ' + this.traversal.position.x + ', ' + this.traversal.position.y + ' · MOVE ' + this.traversal.seq + ' · buffer ' + (this.traversal.bufferedDirection ?? 'empty') + ' · camera ' + this.scroll.x.toFixed(1) + ', ' + this.scroll.y.toFixed(1))
            this.reportElapsed = 0
          }
        }
        const d = this.game.canvas.dataset, coord = this.traversal.position, to = this.traversal.activeMove?.to ?? coord
        d.ready = 'true'; d.logical = coord.x + ',' + coord.y; d.to = to.x + ',' + to.y
        d.moving = String(this.traversal.moving); d.facing = this.traversal.facing
        d.frame = String(this.player.sprite.frame.name); d.scroll = this.scroll.x + ',' + this.scroll.y
        d.foot = this.traversal.foot.x + ',' + this.traversal.foot.y
        d.faded = String(this.environment.fadedStructureCount); d.settled = String(this.environment.readabilitySettled)
        d.buffer = this.traversal.bufferedDirection ?? ''
        d.reducedMotion = String(media.matches)
        if (this.lastSeq !== this.traversal.seq) { d.seq = String(this.traversal.seq); d.moves = JSON.stringify(this.moves); this.lastSeq = this.traversal.seq }
      }
      private resetTraversal() {
        this.traversal?.reset(); this.moves = []; this.lastSeq = -1
        this.scroll = cameraTarget(this.traversal!.foot, traversalMap.world, viewport)
        this.cameras.main.setScroll(this.scroll.x, this.scroll.y)
      }
    }
    const game = new Phaser.Game({
      type: Phaser.CANVAS, parent: host.current, ...viewport, backgroundColor: '#132a26',
      render: { antialias: true, pixelArt: false }, scale: { mode: Phaser.Scale.NONE },
      fps: { target: 60 }, scene: [TraversalScene],
    })
    return () => { mounted = false; controller.current?.clearInput(); game.destroy(true) }
  }, [])
  useEffect(() => { bridge.current?.setDebug(debug) }, [debug])
  return <main>
    <header><h1>Angkor V2 · Traversal</h1><label><input type="checkbox" checked={debug} disabled={!ready} onChange={event => setDebug(event.target.checked)} /> Debug</label></header>
    <p className="instructions">Hold the D-pad or arrows/WASD. Explore connected ruins.</p>
    <div className="viewport" ref={host} />
    {error && <p role="alert">{error}</p>}
    {!ready && !error && <p role="status">Loading traversal…</p>}
    <div className="controls"><DirectionalDpad inputLocked={!ready || Boolean(error)} onMove={direction => controller.current?.tap(direction)}
      heldInput={{ press: (source, direction) => controller.current?.press(source, direction), release: source => controller.current?.release(source), cancel: source => controller.current?.cancel(source) }}
      onReset={() => bridge.current?.reset()} /></div>
    <output hidden={!debug} className="debug">{stats}<br />30×24 tiles · 960×768 world · bounded 11–12×9–10-tile view · 145ms/tile</output>
    <footer>Development traversal only · <a href="/dev/angkor-v2-environment.html">Environment QA</a></footer>
  </main>
}
if (import.meta.env.DEV) createRoot(document.getElementById('root')!).render(<TraversalQA />)
