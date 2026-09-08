import type Phaser from 'phaser'

/** Development-only tiles. Replace these texture keys with approved art later. */
export const PUZZLE_TEXTURES = {
  boulder: 'dev_puzzle_boulder', key: 'dev_temple_key', gate: 'dev_temple_gate', shrine: 'dev_inner_shrine',
} as const

export function createPuzzleArtwork(scene: Phaser.Scene): void {
  const draw = scene.add.graphics()
  const save = (key: string) => {
    if (!scene.textures.exists(key)) draw.generateTexture(key, 32, 32)
    draw.clear()
  }
  draw.fillStyle(0x172a24).fillEllipse(16, 24, 29, 12)
  draw.fillStyle(0x8e9381).fillCircle(16, 15, 13)
  draw.fillStyle(0xb9b6a0).fillTriangle(6, 10, 16, 3, 25, 11)
  draw.lineStyle(2, 0x515c51).beginPath().moveTo(10, 13).lineTo(17, 18).lineTo(14, 25).strokePath()
  draw.lineStyle(1, 0xd4cfb6).strokeCircle(16, 15, 13)
  save(PUZZLE_TEXTURES.boulder)

  draw.lineStyle(3, 0x81b4ff).strokeCircle(12, 9, 5)
  draw.lineStyle(3, 0xf3ead7).beginPath().moveTo(15, 13).lineTo(24, 24).lineTo(27, 21).moveTo(20, 19).lineTo(23, 16).strokePath()
  save(PUZZLE_TEXTURES.key)

  draw.fillStyle(0x6e4b34).fillRect(2, 2, 5, 28).fillRect(25, 2, 5, 28).fillRect(2, 2, 28, 5)
  draw.lineStyle(2, 0xc0d0c6)
  for (const x of [10, 16, 22]) draw.lineBetween(x, 7, x, 28)
  draw.fillStyle(0x81b4ff).fillRoundedRect(12, 13, 8, 9, 2)
  draw.fillStyle(0x132a26).fillCircle(16, 16, 1.5).fillRect(15, 16, 2, 4)
  save(PUZZLE_TEXTURES.gate)

  draw.fillStyle(0x2d8c73).fillRoundedRect(2, 2, 28, 28, 4)
  draw.lineStyle(1.5, 0x83d8c0).strokeRoundedRect(3, 3, 26, 26, 4)
  draw.fillStyle(0x81b4ff).fillTriangle(16, 6, 8, 19, 24, 19)
  draw.lineStyle(2, 0xf3ead7).lineBetween(8, 24, 24, 24)
  save(PUZZLE_TEXTURES.shrine)
  draw.destroy()
}
