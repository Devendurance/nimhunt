import Phaser from 'phaser'
import { Player } from '../entities/Player'
import { createPuzzleState, resolvePuzzleMove, commitPuzzleMove } from '../systems/puzzle'
import { createPuzzleArtwork, PUZZLE_TEXTURES } from '../rendering/puzzleArtwork'
import { ANGKOR_ROOM_01, ROOM_01_CONTENTS, ROOM_01_PUZZLE } from '../world/room01'
import { createRunState } from '../domain/runState'
import { GEM_RUNNER_TARGET } from '../domain/mission'
import {
  type Direction,
  type GridCoord,
  getTileAt,
  tileToPixel,
} from '../world/grid'
import type { NimHuntGameBridge, PlayerHUDState } from '../events/gameEvents'

export class AngkorDevScene extends Phaser.Scene {
  private bridge?: NimHuntGameBridge
  private player?: Player
  private stepCount = 0
  private run = createRunState()
  private generation = 0
  private puzzle = createPuzzleState(ROOM_01_PUZZLE)
  private transitioning = false
  private notice = ''
  private puzzleSprites = new Map<string, Phaser.GameObjects.Image>()
  private gateTimer?: Phaser.Time.TimerEvent
  private gems = new Map<string, Phaser.GameObjects.Image | Phaser.GameObjects.Arc>()
  private readonly onMove = (direction: Direction) => this.handleMove(direction)
  private readonly onReset = () => this.handleReset()

  constructor(bridge?: NimHuntGameBridge) {
    super('AngkorDevScene')
    this.bridge = bridge
  }

  create(): void {
    if (!this.bridge) {
      this.bridge = this.game.registry.get('bridge') as NimHuntGameBridge | undefined
    }

    this.stepCount = 0
    this.run = createRunState()
    this.puzzle = createPuzzleState(ROOM_01_PUZZLE)
    this.transitioning = false
    this.notice = ''
    createPuzzleArtwork(this)
    this.renderPuzzle()
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.shutdown, this)

    // 1. Render Angkor Room 01 Grid
    this.renderRoomTiles()
    this.renderContents()

    // 2. Spawn Player at deterministic start position
    this.player = new Player(this, ANGKOR_ROOM_01.playerStart)

    // 3. Bind bridge command handlers if bridge is present
    if (this.bridge) {
      this.game.events.on('cmd_move', this.onMove)
      this.game.events.on('cmd_reset', this.onReset)
      this.emitState()
    }
  }

  public handleMove(direction: Direction): void {
    if (!this.player || this.transitioning || this.player.isMoving || this.run.runStatus !== 'PLAYING') return
    const transition = resolvePuzzleMove(ANGKOR_ROOM_01, ROOM_01_CONTENTS, ROOM_01_PUZZLE, this.run, this.puzzle, { x: this.player.gridX, y: this.player.gridY }, direction)
    const generation = this.generation
    this.notice = ''
    if (!transition.move.success) {
      this.notice = transition.blockedReason === 'KEY_REQUIRED' ? 'Temple Key required.' : transition.blockedReason === 'BOULDER_BLOCKED' ? 'The boulder needs an empty tile.' : ''
      this.player.bump(direction, () => { if (generation === this.generation) this.emitState() })
      this.emitState()
      return
    }
    this.transitioning = true
    const beginStep = () => {
      if (generation !== this.generation || !this.player) return
      let remaining = transition.pushed ? 2 : 1
      const finishPart = () => {
        if (generation !== this.generation || --remaining !== 0) return
        const previousHP = this.run.hp
        const hadKey = this.puzzle.hasTempleKey
        const next = commitPuzzleMove(this.run, this.puzzle, transition, ROOM_01_CONTENTS, ROOM_01_PUZZLE)
        this.run = next.run
        this.puzzle = next.puzzle
        this.stepCount += 1
        this.transitioning = false
        if (!hadKey && this.puzzle.hasTempleKey) this.notice = 'Temple Key found.'
        else if (transition.opensGate) this.notice = 'Temple Gate open.'
        this.renderPuzzle()
        for (const id of this.run.collectedGemIds) {
          this.gems.get(id)?.destroy()
          this.gems.delete(id)
        }
        if (this.run.hp < previousHP) this.player?.showHit()
        this.emitState()
      }
      if (transition.pushed) {
        const sprite = this.puzzleSprites.get(transition.pushed.id)
        this.tweens.add({ targets: sprite, ...tileToPixel(transition.pushed.to), duration: 160, ease: 'Sine.easeInOut', onComplete: finishPart })
      }
      this.player.moveTo(transition.move.to, direction, finishPart)
    }
    if (transition.opensGate) {
      const gate = this.puzzleSprites.get('gate')
      if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) this.tweens.add({ targets: gate, alpha: 0.25, duration: 120 })
      this.gateTimer = this.time.delayedCall(120, beginStep)
    } else beginStep()
    this.emitState()
  }

  public handleReset(): void {
    if (!this.player) return
    this.generation++
    this.gateTimer?.remove(false)
    this.gateTimer = undefined
    this.transitioning = false
    this.notice = ''
    this.puzzle = createPuzzleState(ROOM_01_PUZZLE)
    this.renderPuzzle()
    this.run = createRunState()
    this.renderGems()
    this.player.reset(ANGKOR_ROOM_01.playerStart)
    this.stepCount = 0
    this.emitState()
  }

  private renderPuzzle(): void {
    for (const sprite of this.puzzleSprites.values()) {
      this.tweens.killTweensOf(sprite)
      sprite.destroy()
    }
    this.puzzleSprites.clear()
    const add = (id: string, coord: GridCoord, texture: string, alpha = 1) => {
      const { x, y } = tileToPixel(coord)
      this.puzzleSprites.set(id, this.add.image(x, y, texture).setDepth(4).setAlpha(alpha))
    }
    for (const boulder of this.puzzle.boulderPositions) add(boulder.id, boulder, PUZZLE_TEXTURES.boulder)
    if (!this.puzzle.hasTempleKey) add('key', ROOM_01_PUZZLE.key, PUZZLE_TEXTURES.key)
    if (this.puzzle.gateState === 'LOCKED') add('gate', ROOM_01_PUZZLE.gate, PUZZLE_TEXTURES.gate)
    add('shrine', ROOM_01_PUZZLE.shrine, PUZZLE_TEXTURES.shrine)
  }

  private renderGems(): void {
    for (const gem of this.gems.values()) gem.destroy()
    this.gems.clear()
    for (const gem of ROOM_01_CONTENTS.gems) {
      const { x, y } = tileToPixel(gem)
      const sprite = this.textures.exists('sapphire_collectible')
        ? this.add.image(x, y, 'sapphire_collectible')
        : this.add.circle(x, y, 7, 0x3e88f7).setStrokeStyle(2, 0xf3ead7)
      if (sprite instanceof Phaser.GameObjects.Image) sprite.setScale(19 / sprite.height)
      sprite.setDepth(3)
      this.gems.set(gem.id, sprite)
    }
  }

  private renderContents(): void {
    this.renderGems()
    const graphics = this.add.graphics().setDepth(2)
    for (const hazard of ROOM_01_CONTENTS.hazards) {
      const { x, y } = tileToPixel(hazard)
      if (hazard.type === 'SPIKES') {
        graphics.fillStyle(0x6e4b34).fillRoundedRect(x - 13, y - 12, 26, 24, 3)
        graphics.fillStyle(0xf3ead7)
        for (const dx of [-8, 0, 8]) graphics.fillTriangle(x + dx - 3, y + 8, x + dx, y - 9, x + dx + 3, y + 8)
      } else {
        graphics.fillStyle(0x2d8c73).fillEllipse(x, y + 3, 27, 17)
        graphics.lineStyle(1.5, 0xf3ead7).strokeCircle(x - 5, y, 3).strokeCircle(x + 5, y - 7, 2)
      }
    }
  }

  private renderRoomTiles(): void {
    for (let y = 0; y < ANGKOR_ROOM_01.height; y++) {
      for (let x = 0; x < ANGKOR_ROOM_01.width; x++) {
        const coord: GridCoord = { x, y }
        const tileType = getTileAt(ANGKOR_ROOM_01, coord)
        const { x: pixelX, y: pixelY } = tileToPixel(coord)

        let textureKey = 'angkor_floor'
        if (tileType === 'WALL') {
          textureKey = 'angkor_wall'
        } else if (tileType === 'PLAYER_START') {
          textureKey = 'angkor_spawn'
        }

        const tileSprite = this.add.image(pixelX, pixelY, textureKey)
        tileSprite.setOrigin(0.5, 0.5)
        tileSprite.setDepth(1)
      }
    }
  }

  private emitState(): void {
    if (!this.bridge || !this.player) return

    const state: PlayerHUDState = {
      hasTempleKey: this.puzzle.hasTempleKey,
      gateState: this.puzzle.gateState,
      objectiveReached: this.puzzle.objectiveReached,
      notice: this.notice,
      hp: this.run.hp,
      gemsCollected: this.run.gemsCollected,
      gemTarget: GEM_RUNNER_TARGET,
      missionStatus: this.run.missionStatus,
      runStatus: this.run.runStatus,
      gridX: this.player.gridX,
      gridY: this.player.gridY,
      facing: this.player.facing,
      isMoving: this.transitioning || this.player.isMoving,
      stepCount: this.stepCount,
      roomName: ANGKOR_ROOM_01.name,
    }

    this.bridge.emitState(state)
  }

  shutdown(): void {
    this.generation++
    this.gateTimer?.remove(false)
    this.gateTimer = undefined
    for (const sprite of this.puzzleSprites.values()) this.tweens.killTweensOf(sprite)
    this.puzzleSprites.clear()
    this.transitioning = false
    this.game.events.off('cmd_move', this.onMove)
    this.game.events.off('cmd_reset', this.onReset)
    this.player?.destroy()
    this.player = undefined
    this.gems.clear()
  }
}
