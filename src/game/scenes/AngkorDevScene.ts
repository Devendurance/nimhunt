import Phaser from 'phaser'
import { Player } from '../entities/Player'
import { Goblin } from '../entities/Goblin'
import { createPuzzleState, resolvePuzzleMove, commitPuzzleMove, type PuzzleObjects } from '../systems/puzzle'
import { PUZZLE_TEXTURES } from '../rendering/puzzleArtwork'
import { ANGKOR_TEXTURES, ANGKOR_DEPTH } from '../assets/angkorAssets'
import {
  ANGKOR_ROOM_01,
  ROOM_01_CHESTS,
  ROOM_01_CONTENTS,
  ROOM_01_PUZZLE,
  ROOM_01_GOBLIN,
  ROOM_01_SWORD,
  ROOM_01_POTION,
} from '../world/room01'
import { createRunState } from '../domain/runState'
import { CHEST_HUNTER_TARGET, GEM_RUNNER_TARGET, type MissionType } from '../domain/mission'
import { createChestStates, openChest, type ChestInstance } from '../systems/chests'
import {
  createGoblinState,
  stepGoblin,
  resolveGoblinCombat,
  type GoblinState,
  type GoblinAIState,
} from '../systems/goblin'
import {
  createInitialItemState,
  checkSwordPickup,
  checkPotionConsumption,
  type ItemState,
} from '../systems/items'
import {
  type Direction,
  type GridCoord,
  type GridRoom,
  getTileAt,
  tileToPixel,
  TILE_SIZE,
} from '../world/grid'
import type { RoomContents } from '../systems/tileEntry.ts'
import type { ChestPlacement } from '../systems/chests.ts'
import type { GoblinSpawnConfig } from '../world/room01.ts'
import type { NimHuntGameBridge, PlayerHUDState } from '../events/gameEvents'
import type { ReplayCollapsingBoulderState, ReplayState, TimedHazard } from '../replay/types.ts'
import { TIMED_HAZARD_TICK_MS } from '../replay/types.ts'
import type { CreateGameOptions } from '../createNimHuntGame'
import type { ProductProofBridge } from '../productProof.ts'
import { mapProductBlueprint } from '../productBlueprint.ts'

interface OverlayItem {
  readonly x: number
  readonly y: number
  readonly key: string
  readonly alpha: number
}

const FLOOR_OVERLAYS: readonly OverlayItem[] = [
  { x: 1, y: 2, key: ANGKOR_TEXTURES.OVERLAY_MOSS, alpha: 0.65 },
  { x: 6, y: 1, key: ANGKOR_TEXTURES.OVERLAY_ROOTS, alpha: 0.70 },
  { x: 7, y: 1, key: ANGKOR_TEXTURES.OVERLAY_CRACKS, alpha: 0.60 },
  { x: 2, y: 7, key: ANGKOR_TEXTURES.OVERLAY_MOSS, alpha: 0.65 },
  { x: 7, y: 7, key: ANGKOR_TEXTURES.OVERLAY_FOLIAGE, alpha: 0.65 },
  { x: 10, y: 2, key: ANGKOR_TEXTURES.OVERLAY_ROOTS, alpha: 0.70 },
  { x: 10, y: 7, key: ANGKOR_TEXTURES.OVERLAY_FOLIAGE, alpha: 0.65 },
  { x: 1, y: 7, key: ANGKOR_TEXTURES.OVERLAY_MOSS, alpha: 0.60 },
  { x: 4, y: 5, key: ANGKOR_TEXTURES.OVERLAY_CRACKS, alpha: 0.55 },
]

const FOREGROUND_OVERLAYS: readonly OverlayItem[] = [
  { x: 1, y: 0.4, key: ANGKOR_TEXTURES.OVERLAY_FOLIAGE, alpha: 0.60 },
  { x: 10, y: 0.4, key: ANGKOR_TEXTURES.OVERLAY_FOLIAGE, alpha: 0.60 },
  { x: 0.4, y: 4.5, key: ANGKOR_TEXTURES.OVERLAY_MOSS, alpha: 0.65 },
  { x: 11.4, y: 4.5, key: ANGKOR_TEXTURES.OVERLAY_MOSS, alpha: 0.65 },
  { x: 2, y: 9.3, key: ANGKOR_TEXTURES.OVERLAY_ROOTS, alpha: 0.65 },
  { x: 7, y: 9.3, key: ANGKOR_TEXTURES.OVERLAY_ROOTS, alpha: 0.65 },
]

export class AngkorDevScene extends Phaser.Scene {
  private bridge?: NimHuntGameBridge
  private player?: Player
  private goblins: Goblin[] = []
  private goblinStates: GoblinState[] = [createGoblinState(ROOM_01_GOBLIN.spawn)]
  private items: ItemState = createInitialItemState()
  private swordSprite?: Phaser.GameObjects.Image
  private potionSprite?: Phaser.GameObjects.Image
  private chestSprites = new Map<string, Phaser.GameObjects.Image>()
  private chests: readonly ChestInstance[] = createChestStates(ROOM_01_CHESTS)
  private mission: MissionType = 'gem-runner'
  private stepCount = 0
  private run = createRunState()
  private generation = 0
  private puzzle = createPuzzleState(ROOM_01_PUZZLE)
  private roomContents: RoomContents = ROOM_01_CONTENTS
  private puzzleObjects: PuzzleObjects = ROOM_01_PUZZLE
  private goblinConfigs: readonly GoblinSpawnConfig[] = [ROOM_01_GOBLIN]
  private chestPlacements: readonly ChestPlacement[] = ROOM_01_CHESTS
  private swordCoord: GridCoord | null = ROOM_01_SWORD
  private potionCoord: GridCoord | null = ROOM_01_POTION
  private spawnCoord: GridCoord = ANGKOR_ROOM_01.playerStart
  private gemTarget = GEM_RUNNER_TARGET
  private chestTarget = CHEST_HUNTER_TARGET
  private initialState: ReplayState | null = null
  private productMode = false
  private proof: ProductProofBridge | null = null
  private vaultFlushNotified = false
  private transitioning = false
  private notice = ''
  private puzzleSprites = new Map<string, Phaser.GameObjects.Image>()
  private gateTimer?: Phaser.Time.TimerEvent
  private gems = new Map<string, Phaser.GameObjects.Image | Phaser.GameObjects.Arc>()
  private hazardObjects: (Phaser.GameObjects.Image | Phaser.GameObjects.Graphics)[] = []
  private overlaySprites: Phaser.GameObjects.Image[] = []
  private timedHazards: readonly TimedHazard[] = []
  private collapsingBoulders: ReplayCollapsingBoulderState[] = []
  private hazardTickTimer?: Phaser.Time.TimerEvent
  private collapsingBoulderSprites = new Map<string, {
    marker?: Phaser.GameObjects.Graphics
    text?: Phaser.GameObjects.Text
    boulder?: Phaser.GameObjects.Image
  }>()
  private readonly onMove = (direction: Direction) => this.handleMove(direction)
  private readonly onReset = () => this.handleReset()

  constructor(bridge?: NimHuntGameBridge, options?: CreateGameOptions) {
    super('AngkorDevScene')
    this.bridge = bridge
    if (options?.blueprint) {
      const runtime = mapProductBlueprint(options.blueprint)
      if (options.mode === 'product') {
        this.productMode = true
        this.proof = options.proof ?? null
        this.initialState = options.initialState
      }
      this.roomContents = runtime.contents
      this.puzzleObjects = runtime.puzzle
      this.goblinConfigs = runtime.goblins
      this.chestPlacements = runtime.chests
      this.swordCoord = runtime.sword
      this.potionCoord = runtime.potion
      this.spawnCoord = runtime.spawn
      this.gemTarget = runtime.gemTarget
      this.chestTarget = runtime.chestTarget
      this.puzzle = createPuzzleState(runtime.puzzle)
      this.chests = createChestStates(runtime.chests)
      this.goblinStates = runtime.goblins.map(g => createGoblinState(g.spawn))
      this.mission = options.mission
      this.timedHazards = runtime.timedHazards
      this.collapsingBoulders = (this.initialState?.collapsingBoulders && this.initialState.collapsingBoulders.length > 0)
        ? this.initialState.collapsingBoulders.map(b => ({ ...b }))
        : this.timedHazards
          .filter(h => h.type === 'COLLAPSING_BOULDER')
          .map(h => ({
            id: h.id,
            state: 'ARMED' as const,
            triggeredAtTick: null,
            elapsedTicks: 0,
            targetTicks: h.warningTicks ?? h.delay,
            collapseAtTick: h.warningTicks ?? h.delay,
          }))
    }
  }

  private hasTexture(key: string): boolean {
    return Boolean(this.textures?.exists(key))
  }

  create(): void {
    if (!this.bridge) {
      this.bridge = this.game.registry.get('bridge') as NimHuntGameBridge | undefined
    }
    this.mission = this.initialState?.mission ?? this.bridge?.getState().selectedMission ?? this.mission

    this.stepCount = this.initialState?.seq ?? 0
    this.run = this.initialState?.run ?? createRunState()
    this.puzzle = this.initialState?.puzzle ?? createPuzzleState(this.puzzleObjects)
    this.items = this.initialState?.items ?? createInitialItemState()
    this.chests = this.initialState?.chests.map(chest => ({ ...chest })) ?? createChestStates(this.chestPlacements)
    this.goblinStates = this.initialState?.goblins.map(g => ({ ...g }))
      ?? this.goblinConfigs.map(c => createGoblinState(c.spawn))
    if (this.initialState?.collapsingBoulders && this.initialState.collapsingBoulders.length > 0) {
      this.collapsingBoulders = this.initialState.collapsingBoulders.map(b => ({ ...b }))
    } else if (this.collapsingBoulders.length === 0 && this.timedHazards.length > 0) {
      this.collapsingBoulders = this.timedHazards
        .filter(h => h.type === 'COLLAPSING_BOULDER')
        .map(h => ({
          id: h.id,
          state: 'ARMED' as const,
          triggeredAtTick: null,
          elapsedTicks: 0,
          targetTicks: h.warningTicks ?? h.delay,
          collapseAtTick: h.warningTicks ?? h.delay,
        }))
    }
    this.startHazardTickTimerIfNeeded()
    this.transitioning = false
    this.notice = ''
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.shutdown, this)

    // 1. Render Angkor Room 01 Architecture & Overlays
    this.renderRoomTiles()
    this.renderOverlays()

    // 2. Render Hazards & Collectibles
    this.renderContents()

    // 3. Render Puzzle Objects (Boulder, Key, Gate, Shrine)
    this.renderPuzzle()

    // 4. Render Items (Sword, Potion) + Chests + Collapsing Boulders
    this.renderItems()
    this.renderChests()
    this.renderCollapsingBoulders()

    // 5. Spawn Goblins
    this.goblins = []
    for (let i = 0; i < this.goblinConfigs.length; i += 1) {
      const config = this.goblinConfigs[i]!
      const existing = this.goblinStates[i]
      const goblinStart = existing ? { x: existing.gridX, y: existing.gridY } : config.spawn
      const goblin = new Goblin(this, goblinStart)
      if (existing) goblin.setAIState(existing.state)
      this.goblins.push(goblin)
    }

    // 6. Spawn Player at deterministic start position
    this.player = new Player(this, this.initialState?.player ?? this.spawnCoord)

    // 5. Setup Camera: zoom to ~8.5-9 tiles horizontally and follow Explorer smoothly
    if (this.cameras?.main && this.player) {
      const cam = this.cameras.main
      cam.setBounds(0, 0, ANGKOR_ROOM_01.width * TILE_SIZE, ANGKOR_ROOM_01.height * TILE_SIZE)
      cam.setZoom(1.35)
      cam.startFollow(this.player.getContainer(), true, 0.09, 0.09)
      const startPixel = tileToPixel({ x: this.player.gridX, y: this.player.gridY })
      cam.centerOn(startPixel.x, startPixel.y)
    }

    // 6. Bind bridge command handlers if bridge is present
    if (this.bridge) {
      this.game.events.on('cmd_move', this.onMove)
      this.game.events.on('cmd_reset', this.onReset)
      this.emitState()
    }
  }

  public handleMove(direction: Direction): void {
    if (!this.player || this.transitioning || this.player.isMoving || this.run.runStatus !== 'PLAYING') return
    if (this.productMode && this.proof && !this.proof.canAcceptMove()) return
    const chestTiles = this.chests.filter(c => c.state === 'CLOSED').map(c => ({ x: c.x, y: c.y }))
    const fallenBoulders = this.collapsingBoulders
      .filter(b => b.state === 'FALLEN')
      .map(b => {
        const hazard = this.timedHazards.find(th => th.id === b.id)
        return hazard ? { x: hazard.x, y: hazard.y } : null
      })
      .filter((c): c is GridCoord => c !== null)
    const transition = resolvePuzzleMove(
      ANGKOR_ROOM_01,
      this.roomContents,
      this.puzzleObjects,
      this.run,
      this.puzzle,
      { x: this.player.gridX, y: this.player.gridY },
      direction,
      chestTiles,
      this.mission,
      fallenBoulders,
    )
    const generation = this.generation
    this.notice = ''
    if (!transition.move.success) {
      this.notice = transition.blockedReason === 'KEY_REQUIRED' ? 'Temple Key required.' : transition.blockedReason === 'BOULDER_BLOCKED' ? 'The boulder needs an empty tile.' : ''
      this.player.bump(direction, () => { if (generation === this.generation) this.emitState() })
      this.emitState()
      return
    }
    this.proof?.recordAcceptedMove(direction)
    this.transitioning = true
    const beginStep = () => {
      if (generation !== this.generation || !this.player) return
      let remaining = transition.pushed ? 2 : 1
      const finishPart = () => {
        if (generation !== this.generation || --remaining !== 0) return
        const previousHP = this.run.hp
        const hadKey = this.puzzle.hasTempleKey
        const next = commitPuzzleMove(this.run, this.puzzle, transition, this.roomContents, this.puzzleObjects, this.mission)
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

        // Check sword pickup
        const swordRes = this.swordCoord
          ? checkSwordPickup(this.items, transition.move.to, this.swordCoord)
          : { nextItems: this.items, collected: false, notice: '' }
        if (swordRes.collected) {
          this.items = swordRes.nextItems
          this.swordSprite?.destroy()
          this.swordSprite = undefined
          this.notice = swordRes.notice
        }

        // Check potion consumption
        const potionRes = this.potionCoord
          ? checkPotionConsumption(this.run, this.items, transition.move.to, this.potionCoord)
          : { nextRun: this.run, nextItems: this.items, consumed: false, notice: '' }
        if (potionRes.consumed) {
          this.run = potionRes.nextRun
          this.items = potionRes.nextItems
          this.potionSprite?.destroy()
          this.potionSprite = undefined
          this.notice = potionRes.notice
        }

        // Check chest opening (step-onto tile, deterministic, exactly once)
        const chestAtDestination = this.chests.find(c => c.state === 'CLOSED' && c.x === transition.move.to.x && c.y === transition.move.to.y)
        if (chestAtDestination && this.run.runStatus === 'PLAYING') {
          const chestRes = openChest(this.run, this.items, this.chests, chestAtDestination.id, this.mission)
          if (chestRes.opened) {
            const chestPrevHP = this.run.hp
            this.run = chestRes.nextRun
            this.items = chestRes.nextItems
            this.chests = chestRes.nextChests
            this.notice = chestRes.notice
            this.renderChests(true, chestAtDestination.id)
            if (this.run.hp < chestPrevHP) this.player?.showHit()
          }
        }

        // Collapsing Boulder Hazard trigger check
        const currentTick = this.stepCount
        this.collapsingBoulders = this.collapsingBoulders.map(boulder => {
          const hazard = this.timedHazards.find(th => th.id === boulder.id)
          if (!hazard) return boulder

          if (boulder.state === 'ARMED') {
            const triggerCells = hazard.triggerCells && hazard.triggerCells.length > 0
              ? hazard.triggerCells
              : [{ x: hazard.x, y: hazard.y }]
            const hitTrigger = triggerCells.some(
              tc => tc.x === transition.move.to.x && tc.y === transition.move.to.y
            )
            if (hitTrigger) {
              const targetTicks = hazard.warningTicks ?? hazard.delay
              this.notice = 'The ruins tremble — get clear of the marked stone!'
              return {
                ...boulder,
                state: 'WARNING' as const,
                triggeredAtTick: currentTick,
                elapsedTicks: 0,
                targetTicks,
                collapseAtTick: targetTicks,
              }
            }
            return boulder
          }

          return boulder
        })

        // Render collapsing boulders with update and start timer if needed
        this.renderCollapsingBoulders(false)
        this.startHazardTickTimerIfNeeded()

        // Updated fallen boulders for goblin pathing
        const updatedFallenBoulders = this.collapsingBoulders
          .filter(b => b.state === 'FALLEN')
          .map(b => {
            const hazard = this.timedHazards.find(th => th.id === b.id)
            return hazard ? { x: hazard.x, y: hazard.y } : null
          })
          .filter((c): c is GridCoord => c !== null)

        // Check Goblin combat + movement sequentially across all Goblins
        for (let i = 0; i < this.goblinConfigs.length; i += 1) {
          const config = this.goblinConfigs[i]
          const goblinEntity = this.goblins[i]
          const activeState = this.goblinStates[i]
          if (!config || !goblinEntity || !activeState || activeState.state === 'DEFEATED' || this.run.runStatus !== 'PLAYING') {
            continue
          }

          // Pre-combat: player stepped onto Goblin
          const preCombat = resolveGoblinCombat(this.run, this.items.hasSword, activeState, transition.move.to)
          if (preCombat.damageDealt > 0 || preCombat.swordUsed) {
            this.run = preCombat.nextRun
            this.items = { ...this.items, hasSword: preCombat.hasSword }
            this.goblinStates[i] = preCombat.nextGoblin
            goblinEntity.setAIState(preCombat.nextGoblin.state)
            if (preCombat.damageDealt > 0) this.player?.showHit()
            if (preCombat.notice) this.notice = preCombat.notice
          }

          // If Goblin is active and player is still playing, Goblin takes turn
          const afterPreState = this.goblinStates[i]
          if (afterPreState && afterPreState.state !== 'DEFEATED' && this.run.runStatus === 'PLAYING') {
            const nextGoblin = stepGoblin(
              ANGKOR_ROOM_01,
              this.puzzle,
              afterPreState,
              transition.move.to,
              config.patrolRoute,
              this.puzzleObjects.gate,
              updatedFallenBoulders,
            )
            this.goblinStates[i] = nextGoblin
            goblinEntity.setAIState(nextGoblin.state)
            goblinEntity.moveTo({ x: nextGoblin.gridX, y: nextGoblin.gridY }, nextGoblin.facing)

            // Check Goblin combat after Goblin moves onto player
            const postCombat = resolveGoblinCombat(this.run, this.items.hasSword, nextGoblin, transition.move.to)
            if (postCombat.damageDealt > 0 || postCombat.swordUsed) {
              this.run = postCombat.nextRun
              this.items = { ...this.items, hasSword: postCombat.hasSword }
              this.goblinStates[i] = postCombat.nextGoblin
              goblinEntity.setAIState(postCombat.nextGoblin.state)
              if (postCombat.damageDealt > 0) this.player?.showHit()
              if (postCombat.notice) this.notice = postCombat.notice
            }
          }
        }

        this.emitState()
        this.notifyProductTerminal()
      }
      if (transition.pushed) {
        const sprite = this.puzzleSprites.get(transition.pushed.id)
        this.tweens.add({ targets: sprite, ...tileToPixel(transition.pushed.to), duration: 160, ease: 'Sine.easeInOut', onComplete: finishPart })
      }
      this.player.moveTo(transition.move.to, direction, finishPart)
    }
    if (transition.opensGate) {
      const gate = this.puzzleSprites.get('gate')
      if (gate && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        this.tweens.add({ targets: gate, alpha: 0.3, duration: 120 })
      }
      this.gateTimer = this.time.delayedCall(120, beginStep)
    } else {
      beginStep()
    }
    this.emitState()
  }

  public handleReset(): void {
    if (this.productMode || !this.player) return
    this.generation++
    this.gateTimer?.remove(false)
    this.gateTimer = undefined
    this.transitioning = false
    this.notice = ''
    this.puzzle = createPuzzleState(this.puzzleObjects)
    this.renderPuzzle()
    this.run = createRunState()
    this.renderGems()
    this.items = createInitialItemState()
    this.renderItems()
    this.chests = createChestStates(this.chestPlacements)
    this.renderChests()
    this.collapsingBoulders = this.timedHazards
      .filter(h => h.type === 'COLLAPSING_BOULDER')
      .map(h => ({
        id: h.id,
        state: 'ARMED' as const,
        triggeredAtTick: null,
        elapsedTicks: 0,
        targetTicks: h.warningTicks ?? h.delay,
        collapseAtTick: h.warningTicks ?? h.delay,
      }))
    this.renderCollapsingBoulders()
    this.goblinStates = this.goblinConfigs.map(c => createGoblinState(c.spawn))
    for (let i = 0; i < this.goblins.length; i += 1) {
      const g = this.goblins[i]
      const config = this.goblinConfigs[i]
      if (g && config) {
        g.reset(config.spawn)
      }
    }
    this.player.reset(this.spawnCoord)
    if (this.cameras?.main) {
      const startPixel = tileToPixel(this.spawnCoord)
      this.cameras.main.centerOn(startPixel.x, startPixel.y)
    }
    this.stepCount = 0
    this.emitState()
  }

  public renderCollapsingBoulders(justFallen = false): void {
    const boulderTexture = this.hasTexture(ANGKOR_TEXTURES.BOULDER)
      ? ANGKOR_TEXTURES.BOULDER
      : PUZZLE_TEXTURES.boulder
    const boulderScale = this.hasTexture(ANGKOR_TEXTURES.BOULDER) ? (28 / 256) : 1

    for (const hazard of this.timedHazards) {
      if (hazard.type !== 'COLLAPSING_BOULDER') continue

      const state = this.collapsingBoulders.find(b => b.id === hazard.id)
      const currentState = state?.state ?? 'ARMED'
      const { x, y } = tileToPixel(hazard)

      let entry = this.collapsingBoulderSprites.get(hazard.id)
      if (entry) {
        entry.marker?.destroy()
        entry.text?.destroy()
        entry.marker = undefined
        entry.text = undefined
      } else {
        entry = {}
        this.collapsingBoulderSprites.set(hazard.id, entry)
      }

      if (currentState === 'ARMED') {
        if (entry.boulder) {
          entry.boulder.destroy()
          entry.boulder = undefined
        }
        // Subtle cracked rune / ancient floor outline
        const marker = this.add.graphics().setDepth(ANGKOR_DEPTH.FLOOR_OVERLAYS)
        marker.lineStyle(1.5, 0x8b6534, 0.45)
        marker.strokeRect(x - 13, y - 13, 26, 26)
        marker.lineBetween(x - 6, y - 6, x + 6, y + 6)
        marker.lineBetween(x + 6, y - 6, x - 6, y + 6)
        entry.marker = marker
      } else if (currentState === 'WARNING') {
        if (entry.boulder) {
          entry.boulder.destroy()
          entry.boulder = undefined
        }
        // Pulsing warning border / danger fill
        const marker = this.add.graphics().setDepth(ANGKOR_DEPTH.HAZARDS)
        marker.fillStyle(0xd9534f, 0.28)
        marker.fillRoundedRect(x - 14, y - 14, 28, 28, 3)
        marker.lineStyle(2, 0xffa500, 0.9)
        marker.strokeRoundedRect(x - 14, y - 14, 28, 28, 3)
        if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
          try {
            this.tweens?.add({
              targets: marker,
              alpha: 0.45,
              duration: 220,
              yoyo: true,
              repeat: -1,
            })
          } catch { /* headless */ }
        }
        entry.marker = marker

        // Countdown text
        const target = state?.targetTicks ?? hazard.warningTicks ?? hazard.delay ?? 4
        const elapsed = state?.elapsedTicks ?? 0
        const remaining = Math.max(0, target - elapsed)
        const displayText = remaining > 1 ? String(remaining - 1) : '!'
        const text = this.add.text(x, y, displayText, {
          fontFamily: 'Cinzel, Georgia, serif',
          fontSize: '14px',
          fontStyle: 'bold',
          color: '#ffecb3',
          stroke: '#3e1a00',
          strokeThickness: 3,
        }).setOrigin(0.5, 0.5).setDepth(ANGKOR_DEPTH.EFFECTS)
        entry.text = text
      } else if (currentState === 'FALLEN') {
        if (!entry.boulder) {
          const sprite = this.add.image(x, y, boulderTexture)
            .setOrigin(0.5, 0.5)
            .setScale(boulderScale)
            .setDepth(ANGKOR_DEPTH.BOULDER)
          entry.boulder = sprite

          if (justFallen && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            try {
              this.cameras?.main?.shake(120, 0.005)
              this.tweens?.add({
                targets: sprite,
                scaleY: boulderScale * 0.88,
                y: y + 2,
                duration: 60,
                yoyo: true,
                ease: 'Sine.easeOut',
              })
            } catch { /* headless */ }
          }
        }
      }
    }
  }

  private startHazardTickTimerIfNeeded(): void {
    if (this.hazardTickTimer) return
    const hasWarning = this.collapsingBoulders.some(b => b.state === 'WARNING')
    if (!hasWarning) return

    this.hazardTickTimer = this.time.addEvent({
      delay: TIMED_HAZARD_TICK_MS,
      callback: () => this.handleHazardTick(),
      loop: true,
    })
  }

  private stopHazardTickTimer(): void {
    if (this.hazardTickTimer) {
      this.hazardTickTimer.destroy()
      this.hazardTickTimer = undefined
    }
  }

  private handleHazardTick(): void {
    if (this.run.runStatus !== 'PLAYING') {
      this.stopHazardTickTimer()
      return
    }

    const hasWarning = this.collapsingBoulders.some(b => b.state === 'WARNING')
    if (!hasWarning) {
      this.stopHazardTickTimer()
      return
    }

    this.proof?.recordAcceptedTick()
    this.stepCount += 1

    const prevCollapsingBoulders = this.collapsingBoulders
    this.collapsingBoulders = this.collapsingBoulders.map(boulder => {
      if (boulder.state !== 'WARNING') return boulder
      const target = boulder.targetTicks ?? 4
      const nextElapsed = boulder.elapsedTicks + 1
      if (nextElapsed >= target) {
        return {
          ...boulder,
          state: 'FALLEN' as const,
          elapsedTicks: nextElapsed,
        }
      }
      return {
        ...boulder,
        elapsedTicks: nextElapsed,
      }
    })

    const newlyFallenBoulders = this.collapsingBoulders.filter(b => {
      const prev = prevCollapsingBoulders.find(p => p.id === b.id)
      return b.state === 'FALLEN' && prev?.state === 'WARNING'
    })

    for (const fallen of newlyFallenBoulders) {
      const hazard = this.timedHazards.find(th => th.id === fallen.id)
      const playerCoord = this.player ? { x: this.player.gridX, y: this.player.gridY } : null
      if (hazard && playerCoord && playerCoord.x === hazard.x && playerCoord.y === hazard.y) {
        this.run = {
          ...this.run,
          hp: 0,
          runStatus: 'FAILED',
          missionStatus: 'FAILED',
        }
        this.player?.showHit()
        this.notice = 'Crushed by collapsing boulder!'
        this.proof?.notifyGameplayEvent('DEATH')
      }
    }

    this.renderCollapsingBoulders(newlyFallenBoulders.length > 0)

    const stillWarning = this.collapsingBoulders.some(b => b.state === 'WARNING')
    if (!stillWarning) {
      this.stopHazardTickTimer()
    }

    this.emitState()
  }

  public renderChests(pop: boolean = false, poppedId?: string): void {
    for (const sprite of this.chestSprites.values()) {
      try { this.tweens?.killTweensOf(sprite) } catch { /* headless */ }
      sprite.destroy()
    }
    this.chestSprites.clear()
    for (const chest of this.chests) {
      const { x, y } = tileToPixel(chest)
      const isOpen = chest.state === 'OPEN'
      const texture = isOpen
        ? (this.hasTexture(ANGKOR_TEXTURES.CHEST_OPEN) ? ANGKOR_TEXTURES.CHEST_OPEN : PUZZLE_TEXTURES.shrine)
        : (this.hasTexture(ANGKOR_TEXTURES.CHEST_CLOSED) ? ANGKOR_TEXTURES.CHEST_CLOSED : PUZZLE_TEXTURES.key)
      // Identical anchor + footprint for closed/open: no visual jump on swap.
      const sprite = this.add.image(x, y, texture)
        .setOrigin(0.5, 0.5)
        .setScale(28 / 256)
        .setDepth(ANGKOR_DEPTH.PROPS)
      this.chestSprites.set(chest.id, sprite)
      if (pop && poppedId === chest.id && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        try { this.tweens?.add({ targets: sprite, scale: (28 / 256) * 1.12, duration: 90, yoyo: true, ease: 'Sine.easeInOut' }) } catch { /* headless */ }
      }
    }
  }

  public renderPuzzle(): void {
    for (const sprite of this.puzzleSprites.values()) {
      this.tweens.killTweensOf(sprite)
      sprite.destroy()
    }
    this.puzzleSprites.clear()

    // 1. Boulder (~88% of 1 tile)
    const boulderTexture = this.hasTexture(ANGKOR_TEXTURES.BOULDER)
      ? ANGKOR_TEXTURES.BOULDER
      : PUZZLE_TEXTURES.boulder
    const boulderScale = this.hasTexture(ANGKOR_TEXTURES.BOULDER) ? (28 / 256) : 1
    for (const boulder of this.puzzle.boulderPositions) {
      const { x, y } = tileToPixel(boulder)
      const sprite = this.add.image(x, y, boulderTexture)
        .setOrigin(0.5, 0.5)
        .setScale(boulderScale)
        .setDepth(ANGKOR_DEPTH.BOULDER)
      this.puzzleSprites.set(boulder.id, sprite)
    }

    // 2. Temple Key
    if (!this.puzzle.hasTempleKey) {
      const keyTexture = this.hasTexture(ANGKOR_TEXTURES.KEY)
        ? ANGKOR_TEXTURES.KEY
        : PUZZLE_TEXTURES.key
      const keyScale = this.hasTexture(ANGKOR_TEXTURES.KEY) ? (24 / 256) : 1
      const { x, y } = tileToPixel(this.puzzleObjects.key)
      const sprite = this.add.image(x, y, keyTexture)
        .setOrigin(0.5, 0.5)
        .setScale(keyScale)
        .setDepth(ANGKOR_DEPTH.COLLECTIBLES)
      this.puzzleSprites.set('key', sprite)
    }

    // 3. Temple Gate (Locked or Open, ~1.8 tiles tall, bottom-center anchored)
    const gateCoord = this.puzzleObjects.gate
    const gatePixel = tileToPixel(gateCoord)
    const isGateProd = this.hasTexture(ANGKOR_TEXTURES.GATE_LOCKED)
    const gateScale = isGateProd ? (58 / 512) : 1
    const gateY = isGateProd ? (gateCoord.y * TILE_SIZE + TILE_SIZE) : gatePixel.y

    if (this.puzzle.gateState === 'LOCKED') {
      const gateLockedTexture = isGateProd
        ? ANGKOR_TEXTURES.GATE_LOCKED
        : PUZZLE_TEXTURES.gate
      const sprite = this.add.image(gatePixel.x, gateY, gateLockedTexture)
        .setOrigin(0.5, isGateProd ? 1.0 : 0.5)
        .setScale(gateScale)
        .setDepth(ANGKOR_DEPTH.PROPS)
      this.puzzleSprites.set('gate', sprite)
    } else {
      // Render open gate archway if production asset exists (identical scale/origin)
      if (this.hasTexture(ANGKOR_TEXTURES.GATE_OPEN)) {
        const sprite = this.add.image(gatePixel.x, gateY, ANGKOR_TEXTURES.GATE_OPEN)
          .setOrigin(0.5, 1.0)
          .setScale(gateScale)
          .setDepth(ANGKOR_DEPTH.PROPS)
        this.puzzleSprites.set('gate', sprite)
      }
    }

    // 4. Inner Shrine (1.5 tiles tall, bottom-center anchored)
    const shrineCoord = this.puzzleObjects.shrine
    const shrinePixel = tileToPixel(shrineCoord)
    const isShrineProd = this.hasTexture(ANGKOR_TEXTURES.SHRINE)
    const shrineTexture = isShrineProd
      ? ANGKOR_TEXTURES.SHRINE
      : PUZZLE_TEXTURES.shrine
    const shrineScale = isShrineProd ? (48 / 384) : 1
    const shrineY = isShrineProd ? (shrineCoord.y * TILE_SIZE + TILE_SIZE) : shrinePixel.y
    const shrineSprite = this.add.image(shrinePixel.x, shrineY, shrineTexture)
      .setOrigin(0.5, isShrineProd ? 1.0 : 0.5)
      .setScale(shrineScale)
      .setDepth(ANGKOR_DEPTH.PROPS)
    this.puzzleSprites.set('shrine', shrineSprite)
  }

  public renderGems(): void {
    for (const gem of this.gems.values()) gem.destroy()
    this.gems.clear()

    const useProdGem = this.hasTexture(ANGKOR_TEXTURES.BLUE_GEM)
    const useFramedSapphire = this.hasTexture('sapphire_collectible')

    for (const gem of this.roomContents.gems) {
      const { x, y } = tileToPixel(gem)
      let sprite: Phaser.GameObjects.Image | Phaser.GameObjects.Arc

      if (useProdGem) {
        sprite = this.add.image(x, y, ANGKOR_TEXTURES.BLUE_GEM)
          .setOrigin(0.5, 0.5)
          .setScale(22 / 256)
          .setDepth(ANGKOR_DEPTH.COLLECTIBLES)
      } else if (useFramedSapphire) {
        const img = this.add.image(x, y, 'sapphire_collectible')
        img.setScale(19 / img.height)
        img.setDepth(ANGKOR_DEPTH.COLLECTIBLES)
        sprite = img
      } else {
        sprite = this.add.circle(x, y, 7, 0x3e88f7)
          .setStrokeStyle(2, 0xf3ead7)
          .setDepth(ANGKOR_DEPTH.COLLECTIBLES)
      }

      this.gems.set(gem.id, sprite)
    }
  }

  public renderContents(): void {
    this.renderGems()

    // Clean up existing hazard objects
    for (const obj of this.hazardObjects) obj.destroy()
    this.hazardObjects = []

    const useProdSpikes = this.hasTexture(ANGKOR_TEXTURES.SPIKES)
    const useProdPoison = this.hasTexture(ANGKOR_TEXTURES.POISON)

    // Fallback graphics layer if production hazard textures aren't loaded
    let fallbackGraphics: Phaser.GameObjects.Graphics | null = null

    for (const hazard of this.roomContents.hazards) {
      const { x, y } = tileToPixel(hazard)

      if (hazard.type === 'SPIKES') {
        if (useProdSpikes) {
          const sprite = this.add.image(x, y, ANGKOR_TEXTURES.SPIKES)
            .setOrigin(0.5, 0.5)
            .setScale(30 / 256)
            .setDepth(ANGKOR_DEPTH.HAZARDS)
          this.hazardObjects.push(sprite)
        } else {
          if (!fallbackGraphics) {
            fallbackGraphics = this.add.graphics().setDepth(ANGKOR_DEPTH.HAZARDS)
            this.hazardObjects.push(fallbackGraphics)
          }
          fallbackGraphics.fillStyle(0x6e4b34).fillRoundedRect(x - 13, y - 12, 26, 24, 3)
          fallbackGraphics.fillStyle(0xf3ead7)
          for (const dx of [-8, 0, 8]) fallbackGraphics.fillTriangle(x + dx - 3, y + 8, x + dx, y - 9, x + dx + 3, y + 8)
        }
      } else if (hazard.type === 'POISON') {
        if (useProdPoison) {
          const sprite = this.add.image(x, y, ANGKOR_TEXTURES.POISON)
            .setOrigin(0.5, 0.5)
            .setScale(30 / 256)
            .setDepth(ANGKOR_DEPTH.HAZARDS)
          this.hazardObjects.push(sprite)
        } else {
          if (!fallbackGraphics) {
            fallbackGraphics = this.add.graphics().setDepth(ANGKOR_DEPTH.HAZARDS)
            this.hazardObjects.push(fallbackGraphics)
          }
          fallbackGraphics.fillStyle(0x2d8c73).fillEllipse(x, y + 3, 27, 17)
          fallbackGraphics.lineStyle(1.5, 0xf3ead7).strokeCircle(x - 5, y, 3).strokeCircle(x + 5, y - 7, 2)
        }
      }
    }
  }

  public renderItems(): void {
    this.swordSprite?.destroy()
    this.swordSprite = undefined
    this.potionSprite?.destroy()
    this.potionSprite = undefined

    if (!this.items.swordPickedUp && this.swordCoord) {
      const swordTexture = this.hasTexture(ANGKOR_TEXTURES.SWORD)
        ? ANGKOR_TEXTURES.SWORD
        : PUZZLE_TEXTURES.key
      const { x, y } = tileToPixel(this.swordCoord)
      this.swordSprite = this.add.image(x, y, swordTexture)
        .setOrigin(0.5, 0.5)
        .setScale(24 / 256)
        .setDepth(ANGKOR_DEPTH.COLLECTIBLES)
    }

    if (!this.items.potionConsumed && this.potionCoord) {
      const potionTexture = this.hasTexture(ANGKOR_TEXTURES.POTION)
        ? ANGKOR_TEXTURES.POTION
        : PUZZLE_TEXTURES.shrine
      const { x, y } = tileToPixel(this.potionCoord)
      this.potionSprite = this.add.image(x, y, potionTexture)
        .setOrigin(0.5, 0.5)
        .setScale(24 / 256)
        .setDepth(ANGKOR_DEPTH.COLLECTIBLES)
    }
  }

  public renderRoomTiles(): void {
    const hasProdCleanFloor = this.hasTexture(ANGKOR_TEXTURES.FLOOR_CLEAN)
    const hasProdStraightWall = this.hasTexture(ANGKOR_TEXTURES.WALL_STRAIGHT)

    for (let y = 0; y < ANGKOR_ROOM_01.height; y++) {
      for (let x = 0; x < ANGKOR_ROOM_01.width; x++) {
        const coord: GridCoord = { x, y }
        const tileType = getTileAt(ANGKOR_ROOM_01, coord)
        const { x: pixelX, y: pixelY } = tileToPixel(coord)

        if (tileType === 'WALL') {
          if (hasProdStraightWall) {
            const config = this.getWallConfig(ANGKOR_ROOM_01, x, y)
            const wallKey = this.hasTexture(config.key) ? config.key : ANGKOR_TEXTURES.WALL_STRAIGHT
            const sprite = this.add.image(pixelX, pixelY, wallKey)
            sprite.setOrigin(0.5, 0.5)
            sprite.setAngle(config.angle)
            sprite.setScale(32 / 256)
            sprite.setDepth(ANGKOR_DEPTH.WALLS)
          } else {
            const sprite = this.add.image(pixelX, pixelY, 'angkor_wall')
            sprite.setOrigin(0.5, 0.5)
            sprite.setDepth(ANGKOR_DEPTH.WALLS)
          }
        } else {
          // Walkable floor or player start
          if (hasProdCleanFloor) {
            const floorKey = this.selectFloorTexture(x, y)
            const floorSprite = this.add.image(pixelX, pixelY, floorKey)
            floorSprite.setOrigin(0.5, 0.5)
            floorSprite.setScale(32 / 256)
            floorSprite.setDepth(ANGKOR_DEPTH.BASE_FLOOR)
          } else {
            let textureKey = 'angkor_floor'
            if (tileType === 'PLAYER_START') textureKey = 'angkor_spawn'
            const floorSprite = this.add.image(pixelX, pixelY, textureKey)
            floorSprite.setOrigin(0.5, 0.5)
            floorSprite.setDepth(ANGKOR_DEPTH.BASE_FLOOR)
          }

          // If start tile and spawn seal texture exists, layer it subtly on floor
          if (tileType === 'PLAYER_START' && this.hasTexture('angkor_spawn')) {
            const spawnSeal = this.add.image(pixelX, pixelY, 'angkor_spawn')
            spawnSeal.setOrigin(0.5, 0.5)
            spawnSeal.setAlpha(0.6)
            spawnSeal.setDepth(ANGKOR_DEPTH.BASE_FLOOR + 0.5)
          }
        }
      }
    }
  }

  public renderOverlays(): void {
    for (const spr of this.overlaySprites) spr.destroy()
    this.overlaySprites = []

    // 1. Ground floor overlays (moss, cracks, roots at depth 2)
    for (const ov of FLOOR_OVERLAYS) {
      if (this.hasTexture(ov.key)) {
        const { x, y } = tileToPixel({ x: ov.x, y: ov.y })
        const spr = this.add.image(x, y, ov.key)
          .setOrigin(0.5, 0.5)
          .setScale(32 / 256)
          .setAlpha(ov.alpha)
          .setDepth(ANGKOR_DEPTH.FLOOR_OVERLAYS)
        this.overlaySprites.push(spr)
      }
    }

    // 2. Foreground overlays (creeping foliage & roots at depth 9 along perimeter walls)
    for (const fov of FOREGROUND_OVERLAYS) {
      if (this.hasTexture(fov.key)) {
        const x = fov.x * TILE_SIZE + TILE_SIZE / 2
        const y = fov.y * TILE_SIZE + TILE_SIZE / 2
        const spr = this.add.image(x, y, fov.key)
          .setOrigin(0.5, 0.5)
          .setScale(32 / 256)
          .setAlpha(fov.alpha)
          .setDepth(ANGKOR_DEPTH.FOREGROUND_OVERLAYS)
        this.overlaySprites.push(spr)
      }
    }
  }

  /** Deterministic coordinate-based floor variation: Clean 60%, VarA 15%, VarB 15%, Cracked 5%, Mossy 5% */
  private selectFloorTexture(x: number, y: number): string {
    const hash = ((x * 17) ^ (y * 23) + (x + y) * 7) % 20
    if (hash < 12) return ANGKOR_TEXTURES.FLOOR_CLEAN
    if (hash < 15) return this.hasTexture(ANGKOR_TEXTURES.FLOOR_A) ? ANGKOR_TEXTURES.FLOOR_A : ANGKOR_TEXTURES.FLOOR_CLEAN
    if (hash < 18) return this.hasTexture(ANGKOR_TEXTURES.FLOOR_B) ? ANGKOR_TEXTURES.FLOOR_B : ANGKOR_TEXTURES.FLOOR_CLEAN
    if (hash === 18) return this.hasTexture(ANGKOR_TEXTURES.FLOOR_CRACKED) ? ANGKOR_TEXTURES.FLOOR_CRACKED : ANGKOR_TEXTURES.FLOOR_CLEAN
    return this.hasTexture(ANGKOR_TEXTURES.FLOOR_MOSSY) ? ANGKOR_TEXTURES.FLOOR_MOSSY : ANGKOR_TEXTURES.FLOOR_CLEAN
  }

  /** Autotile wall geometry selection and orientation */
  public getWallConfig(room: GridRoom, x: number, y: number): { key: string; angle: number } {
    const isWall = (nx: number, ny: number) => {
      if (nx < 0 || nx >= room.width || ny < 0 || ny >= room.height) return true
      return getTileAt(room, { x: nx, y: ny }) === 'WALL'
    }

    const north = isWall(x, y - 1)
    const south = isWall(x, y + 1)
    const west = isWall(x - 1, y)
    const east = isWall(x + 1, y)

    // 1. Outer 4 perimeter corners
    if (x === 0 && y === 0) return { key: ANGKOR_TEXTURES.WALL_CORNER, angle: 0 }
    if (x === room.width - 1 && y === 0) return { key: ANGKOR_TEXTURES.WALL_CORNER, angle: 90 }
    if (x === room.width - 1 && y === room.height - 1) return { key: ANGKOR_TEXTURES.WALL_CORNER, angle: 180 }
    if (x === 0 && y === room.height - 1) return { key: ANGKOR_TEXTURES.WALL_CORNER, angle: 270 }

    // 2. Outer boundary perimeter runs
    if (y === 0 || y === room.height - 1) return { key: ANGKOR_TEXTURES.WALL_STRAIGHT, angle: 0 }
    if (x === 0 || x === room.width - 1) return { key: ANGKOR_TEXTURES.WALL_STRAIGHT, angle: 90 }

    const wallNeighbors = (north ? 1 : 0) + (south ? 1 : 0) + (west ? 1 : 0) + (east ? 1 : 0)

    // 3. Isolated columns/pillars (0 neighbors)
    if (wallNeighbors === 0) {
      return { key: ANGKOR_TEXTURES.WALL_INNER_PILLAR, angle: 0 }
    }

    // 4. Single-neighbor end caps / edge terminals
    if (wallNeighbors === 1) {
      if (north) return { key: ANGKOR_TEXTURES.WALL_EDGE, angle: 90 }
      if (south) return { key: ANGKOR_TEXTURES.WALL_EDGE, angle: 270 }
      if (west) return { key: ANGKOR_TEXTURES.WALL_EDGE, angle: 0 }
      return { key: ANGKOR_TEXTURES.WALL_EDGE, angle: 180 }
    }

    // 5. Two-neighbor connections
    if (wallNeighbors === 2) {
      if (north && south) return { key: ANGKOR_TEXTURES.WALL_STRAIGHT, angle: 90 }
      if (west && east) return { key: ANGKOR_TEXTURES.WALL_STRAIGHT, angle: 0 }
      if (south && east) return { key: ANGKOR_TEXTURES.WALL_CORNER, angle: 0 }
      if (south && west) return { key: ANGKOR_TEXTURES.WALL_CORNER, angle: 90 }
      if (north && west) return { key: ANGKOR_TEXTURES.WALL_CORNER, angle: 180 }
      if (north && east) return { key: ANGKOR_TEXTURES.WALL_CORNER, angle: 270 }
    }

    // 6. Three or Four neighbors (T-junctions / crosses)
    if (north && south) return { key: ANGKOR_TEXTURES.WALL_STRAIGHT, angle: 90 }
    return { key: ANGKOR_TEXTURES.WALL_STRAIGHT, angle: 0 }
  }

  public selectWallTexture(room: GridRoom, x: number, y: number): string {
    return this.getWallConfig(room, x, y).key
  }

  private emitState(): void {
    if (!this.bridge || !this.player) return

    let aggregateGoblinState: GoblinAIState = 'PATROL'
    if (this.goblinStates.length > 0) {
      if (this.goblinStates.some(g => g.state === 'CHASE')) {
        aggregateGoblinState = 'CHASE'
      } else if (this.goblinStates.every(g => g.state === 'DEFEATED')) {
        aggregateGoblinState = 'DEFEATED'
      } else {
        aggregateGoblinState = 'PATROL'
      }
    }

    const state: PlayerHUDState = {
      hasTempleKey: this.puzzle.hasTempleKey,
      hasSword: this.items.hasSword,
      goblinState: aggregateGoblinState,
      gateState: this.puzzle.gateState,
      objectiveReached: this.puzzle.objectiveReached,
      notice: this.notice,
      hp: this.run.hp,
      gemsCollected: this.run.gemsCollected,
      gemTarget: this.gemTarget,
      chestsOpened: this.run.chestsOpened ?? 0,
      chestTarget: this.chestTarget,
      selectedMission: this.mission,
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

  private notifyProductTerminal(): void {
    if (!this.productMode || !this.proof) return
    if (this.run.hp === 0 || this.run.runStatus === 'FAILED') {
      this.proof.notifyGameplayEvent('DEATH')
      return
    }
    if (this.run.runStatus === 'MISSION_COMPLETE') {
      this.proof.notifyGameplayEvent('MISSION_COMPLETE')
      return
    }
    if (this.mission === 'vault-breaker' && this.puzzle.objectiveReached && !this.vaultFlushNotified) {
      this.vaultFlushNotified = true
      this.proof.notifyGameplayEvent('VAULT_REACHED')
    }
  }

  shutdown(): void {
    this.generation++
    this.gateTimer?.remove(false)
    this.gateTimer = undefined
    for (const sprite of this.puzzleSprites.values()) this.tweens.killTweensOf(sprite)
    this.puzzleSprites.clear()
    for (const sprite of this.chestSprites.values()) {
      try { this.tweens?.killTweensOf(sprite) } catch { /* headless */ }
    }
    this.chestSprites.clear()
    this.transitioning = false
    this.game.events.off('cmd_move', this.onMove)
    this.game.events.off('cmd_reset', this.onReset)
    this.player?.destroy()
    this.player = undefined
    for (const g of this.goblins) g.destroy()
    this.goblins = []
    this.swordSprite?.destroy()
    this.swordSprite = undefined
    this.potionSprite?.destroy()
    this.potionSprite = undefined
    this.gems.clear()
    for (const obj of this.hazardObjects) obj.destroy()
    this.hazardObjects = []
    for (const spr of this.overlaySprites) spr.destroy()
    this.overlaySprites = []
    for (const entry of this.collapsingBoulderSprites.values()) {
      entry.marker?.destroy()
      entry.text?.destroy()
      if (entry.boulder) {
        try { this.tweens?.killTweensOf(entry.boulder) } catch { /* headless */ }
        entry.boulder.destroy()
      }
    }
    this.collapsingBoulderSprites.clear()
  }
}
