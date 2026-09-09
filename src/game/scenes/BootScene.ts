import Phaser from 'phaser'
import explorerAsset from '../../assets/NimHunt Character.png'
import goblinAsset from '../../assets/NimHunt Goblin.png'
import sapphireAsset from '../../assets/sapphire shard gem.png'
import { frameArtwork } from '../rendering/frameArtwork'
import { ANGKOR_ASSETS } from '../assets/angkorAssets'
import { createDevFallbackArtwork } from '../rendering/puzzleArtwork'

export class BootScene extends Phaser.Scene {
  constructor() {
    super('BootScene')
  }

  preload(): void {
    // 1. Load player Explorer asset and legacy sapphire source as fallback
    this.load.image('player_explorer', explorerAsset)
    this.load.image('goblin_source', goblinAsset)
    this.load.image('sapphire_source', sapphireAsset)

    // 2. Preload all approved production Angkor assets from manifest (including sword & potion)
    for (const asset of ANGKOR_ASSETS) {
      this.load.image(asset.key, asset.path)
    }
  }

  create(): void {
    frameArtwork(this, 'player_explorer', 'explorer_framed')
    frameArtwork(this, 'goblin_source', 'goblin_framed', true)
    frameArtwork(this, 'sapphire_source', 'sapphire_collectible', true)

    // Generate dev fallback textures for resilience
    this.generateFallbackFloorTexture()
    this.generateFallbackWallTexture()
    this.generateFallbackSpawnTexture()
    this.generateFallbackGoblinTexture()
    createDevFallbackArtwork(this)

    // Launch the development room scene
    this.scene.start('AngkorDevScene')
  }

  private generateFallbackFloorTexture(): void {
    if (this.textures.exists('angkor_floor')) return

    const g = this.make.graphics({ x: 0, y: 0 })
    g.fillStyle(0x1B3833, 1)
    g.fillRect(0, 0, 32, 32)
    g.lineStyle(1, 0x132A26, 0.8)
    g.strokeRect(0.5, 0.5, 31, 31)
    g.fillStyle(0x23443E, 0.5)
    g.fillRect(4, 4, 11, 10)
    g.fillRect(17, 16, 11, 11)
    g.generateTexture('angkor_floor', 32, 32)
    g.destroy()
  }

  private generateFallbackWallTexture(): void {
    if (this.textures.exists('angkor_wall')) return

    const g = this.make.graphics({ x: 0, y: 0 })
    g.fillStyle(0x6E4B34, 1)
    g.fillRect(0, 0, 32, 32)
    g.fillStyle(0xA56C43, 1)
    g.fillRect(0, 0, 32, 3)
    g.fillRect(0, 0, 3, 32)
    g.fillStyle(0x3A2417, 1)
    g.fillRect(0, 29, 32, 3)
    g.fillRect(29, 0, 3, 32)
    g.lineStyle(1, 0x3A2417, 0.7)
    g.lineBetween(0, 16, 32, 16)
    g.lineBetween(16, 16, 16, 29)
    g.lineBetween(12, 3, 12, 16)
    g.generateTexture('angkor_wall', 32, 32)
    g.destroy()
  }

  private generateFallbackSpawnTexture(): void {
    if (this.textures.exists('angkor_spawn')) return

    const g = this.make.graphics({ x: 0, y: 0 })
    g.fillStyle(0x1B3833, 1)
    g.fillRect(0, 0, 32, 32)
    g.lineStyle(1, 0x132A26, 0.8)
    g.strokeRect(0.5, 0.5, 31, 31)
    g.lineStyle(1.5, 0x2D8C73, 0.9)
    g.strokeCircle(16, 16, 10)
    g.fillStyle(0x2D8C73, 0.4)
    g.fillCircle(16, 16, 4)
    g.generateTexture('angkor_spawn', 32, 32)
    g.destroy()
  }

  private generateFallbackGoblinTexture(): void {
    if (this.textures.exists('goblin_framed')) return

    const g = this.make.graphics({ x: 0, y: 0 })
    // Dark green body
    g.fillStyle(0x3B6B35, 1)
    g.fillCircle(16, 18, 9)
    // Goblin ears
    g.fillTriangle(7, 14, 4, 8, 12, 12)
    g.fillTriangle(25, 14, 28, 8, 20, 12)
    // Red glowing eyes
    g.fillStyle(0xE03E3E, 1)
    g.fillCircle(13, 16, 2)
    g.fillCircle(19, 16, 2)
    g.generateTexture('goblin_framed', 32, 32)
    g.destroy()
  }
}
