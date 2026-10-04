import type Phaser from 'phaser'
interface LocalItems {
  collected?: readonly string[]; chests?: readonly { id: string; state: string }[]
  keyCollected?: boolean; bronzeKeyCollected?: boolean; potionCollected?: boolean
  gateUnlocked?: boolean; outerSealUnlocked?: boolean; pressureGateOpen?: boolean; mechanismGateOpen?: boolean
  pressurePlateActive?: boolean; pressurePlateA?: boolean; pressurePlateB?: boolean; exitUnlocked?: boolean
}
interface Sprites {
  gems?: ReadonlyMap<string, Phaser.GameObjects.Image>; chests?: ReadonlyMap<string, Phaser.GameObjects.Image>
  key?: Phaser.GameObjects.Image; potion?: Phaser.GameObjects.Image; gate?: Phaser.GameObjects.Image
  pressureGate?: Phaser.GameObjects.Image; plate?: Phaser.GameObjects.Image; plates?: readonly Phaser.GameObjects.Image[]
  passage?: Phaser.GameObjects.Image
}
/** Restore static presentation without replaying historical dust/audio/tweens. */
export function restorePresentation(s: LocalItems, sprites: Sprites): void {
  const texture = (key: string) => `angkor-v2/${key}`
  sprites.gems?.forEach((image, id) => image.setVisible(!s.collected?.includes(id)))
  sprites.chests?.forEach((image, id) => {
    const royal = image.texture.key.includes('royal-cache'), open = s.chests?.some(c => c.id === id && c.state === 'OPEN')
    image.setTexture(texture(royal ? open ? 'royal-cache-open-v2' : 'royal-cache-closed-v2' : open ? 'chest-open-v2' : 'chest-closed-v2'))
  })
  sprites.key?.setVisible(!(s.keyCollected || s.bronzeKeyCollected))
  sprites.potion?.setVisible(!s.potionCollected)
  sprites.gate?.setTexture(texture(s.gateUnlocked || s.outerSealUnlocked ? 'side-gate-open-v2' : 'side-gate-locked-v2'))
  sprites.pressureGate?.setTexture(texture(s.pressureGateOpen || s.mechanismGateOpen ? 'side-gate-open-v2' : 'side-gate-locked-v2'))
  if (s.pressurePlateActive) sprites.plate?.setTint(0xc8dbb8)
  sprites.plates?.forEach((p, i) => { if (i === 0 ? s.pressurePlateA : s.pressurePlateB) p.setTint(0xc8dbb8); else p.clearTint() })
  if (s.exitUnlocked) sprites.passage?.setTexture(texture('temple-passage-open-height-v2'))
}
