import { useState } from 'react'
import explorer from '../../assets/NimHunt Character.png'
import goblin from '../../assets/NimHunt Goblin.png'
import golem from '../../assets/NimHunt Golem.png'
import treasure from '../../assets/NimHunt Gem.png'
import type { CharacterId } from '../../data/marketing'
const characterAssets: Record<CharacterId, string> = { explorer, goblin, golem, treasure }
export function CharacterAsset({ character, hero = false }: { character: CharacterId; hero?: boolean }) {
  const [failed, setFailed] = useState(false)
  return <div className={`character-asset ${character} ${hero ? 'hero-asset' : ''}`} aria-hidden="true">
    {failed ? <span className="asset-placeholder">{character} artwork</span> : <img src={characterAssets[character]} alt="" width="1280" height="1280" loading={hero ? 'eager' : 'lazy'} decoding="async" onError={() => setFailed(true)} />}
  </div>
}
export function HeroExplorerAsset() { return <CharacterAsset character="explorer" hero /> }
export function HeroGoblinAsset() { return <CharacterAsset character="goblin" hero /> }
export function HeroGolemAsset() { return <CharacterAsset character="golem" hero /> }
export function HeroNimTreasureAsset() { return <CharacterAsset character="treasure" hero /> }
export function ExplorerAsset() { return <CharacterAsset character="explorer" /> }
export function GoblinAsset() { return <CharacterAsset character="goblin" /> }
export function GolemAsset() { return <CharacterAsset character="golem" /> }
export function NimTreasureAsset() { return <CharacterAsset character="treasure" /> }
