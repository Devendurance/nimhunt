import Phaser from 'phaser'
import explorerAsset from '../../assets/NimHunt Character.png'
import sapphireAsset from '../../assets/sapphire shard gem.png'
import { frameArtwork } from '../rendering/frameArtwork'

export class BootScene extends Phaser.Scene {
  constructor() {
    super('BootScene')
  }

  preload(): void {
    // 1. Load player Explorer asset
    this.load.image('player_explorer', explorerAsset)
    this.load.image('sapphire_source', sapphireAsset)
  }

  create(): void {
    frameArtwork(this, 'player_explorer', 'explorer_framed')
    frameArtwork(this, 'sapphire_source', 'sapphire_collectible', true)
    // 2. Generate clean Angkor architectural textures for tile rendering
    this.generateFloorTexture()
    this.generateWallTexture()
    this.generateSpawnTexture()

    // 3. Launch the development room scene
    this.scene.start('AngkorDevScene')
  }

  private generateFloorTexture(): void {
    if (this.textures.exists('angkor_floor')) return

    const g = this.make.graphics({ x: 0, y: 0 })

    // Base Temple Night stone surface (#1B3833)
    g.fillStyle(0x1B3833, 1)
    g.fillRect(0, 0, 32, 32)

    // Subtle stone slab border (#132A26)
    g.lineStyle(1, 0x132A26, 0.8)
    g.strokeRect(0.5, 0.5, 31, 31)

    // Faint stone texture accent
    g.fillStyle(0x23443E, 0.5)
    g.fillRect(4, 4, 11, 10)
    g.fillRect(17, 16, 11, 11)

    g.generateTexture('angkor_floor', 32, 32)
    g.destroy()
  }

  private generateWallTexture(): void {
    if (this.textures.exists('angkor_wall')) return

    const g = this.make.graphics({ x: 0, y: 0 })

    // Base Ruin Brown stone (#6E4B34)
    g.fillStyle(0x6E4B34, 1)
    g.fillRect(0, 0, 32, 32)

    // Top & Left Sandstone highlight rim (#A56C43)
    g.fillStyle(0xA56C43, 1)
    g.fillRect(0, 0, 32, 3)
    g.fillRect(0, 0, 3, 32)

    // Bottom & Right deep shadow rim (#3A2417)
    g.fillStyle(0x3A2417, 1)
    g.fillRect(0, 29, 32, 3)
    g.fillRect(29, 0, 3, 32)

    // Ancient stone block center line
    g.lineStyle(1, 0x3A2417, 0.7)
    g.lineBetween(0, 16, 32, 16)
    g.lineBetween(16, 16, 16, 29)
    g.lineBetween(12, 3, 12, 16)

    g.generateTexture('angkor_wall', 32, 32)
    g.destroy()
  }

  private generateSpawnTexture(): void {
    if (this.textures.exists('angkor_spawn')) return

    const g = this.make.graphics({ x: 0, y: 0 })

    // Floor base
    g.fillStyle(0x1B3833, 1)
    g.fillRect(0, 0, 32, 32)

    // Floor outline
    g.lineStyle(1, 0x132A26, 0.8)
    g.strokeRect(0.5, 0.5, 31, 31)

    // Ancient sanctuary seal ring (Jungle Jade #2D8C73)
    g.lineStyle(1.5, 0x2D8C73, 0.9)
    g.strokeCircle(16, 16, 10)

    // Inner marker
    g.fillStyle(0x2D8C73, 0.4)
    g.fillCircle(16, 16, 4)

    g.generateTexture('angkor_spawn', 32, 32)
    g.destroy()
  }
}
