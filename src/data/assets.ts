import scenery from '../assets/Nimiq Treasure Hunt Scenery.png'
import world from '../assets/Angkor world environment.png'
import gate from '../assets/Angkor world gate.png'
import explorer from '../assets/NimHunt Character.png'
import nimhuntWordmark from '../assets/nimhunt-wordmark.png'

export const environmentAssets = { scenery, world, gate }
export const brandAssets = { wordmark: nimhuntWordmark }
export const playAssets = { angkor: world, explorer }

/**
 * Replace these entries with approved delivery artwork when the final mascot pack arrives.
 * Components use these named slots so a replacement never changes the layout contract.
 */
export const characterAssetManifest = {
  heroExplorer: 'hero-explorer.webp',
  heroGoblin: 'hero-goblin.webp',
  heroGolem: 'hero-golem.webp',
  heroNimTreasure: 'hero-nim-treasure.webp',
  explorer: 'explorer.webp',
  goblin: 'goblin.webp',
  golem: 'golem.webp',
  nimTreasure: 'nim-treasure.webp',
} as const

export const brandAssetManifest = {
  wordmark: 'nimhunt-wordmark.png',
} as const
