import type { HuntLaunchConfig } from './marketing.types'

export type Mission = { name: string; objective: string; icon: 'gem' | 'chest' | 'key' }
export const missionPreviews: readonly Mission[] = [
  { name: 'Gem Runner', objective: 'Collect 6 gems and survive.', icon: 'gem' },
  { name: 'Chest Hunter', objective: 'Open 4 chests and survive.', icon: 'chest' },
  { name: 'Vault Breaker', objective: 'Find the key. Unlock the gate. Reach the vault.', icon: 'key' },
]
export const adventureSteps = [
  { name: 'Explore', text: 'Navigate compact rooms, find keys, push boulders, and choose your route.' },
  { name: 'Survive', text: 'Avoid hazards, outsmart the Goblin, and finish the mission alive.' },
  { name: 'Seal', text: 'Sign the claim in Nimiq Pay and watch the treasure move into your balance.' },
] as const
export const characters = [
  { id: 'explorer', name: 'Explorer', role: 'The adventurer', text: 'Your route. Your mission. Your seal.' },
  { id: 'goblin', name: 'Goblin', role: 'The troublemaker', text: 'The treasure thief who never stops watching.' },
  { id: 'golem', name: 'Golem', role: 'The ancient guardian', text: 'An ancient guardian from worlds still to come.' },
  { id: 'treasure', name: 'NIM Treasure', role: 'The real reward', text: 'Real NIM, discovered as treasure and sealed through Nimiq Pay.' },
] as const
export type CharacterId = typeof characters[number]['id']
export const heroCategories: readonly { title: string; category: string }[] = [
  { title: 'The Pathfinder', category: 'Most Active Expedition Time' },
  { title: 'The Relic Keeper', category: 'Most Points' },
  { title: 'The Unbroken', category: 'Highest Streak' },
  { title: 'The Golden Hand', category: 'Most NIM Collected' },
  { title: 'The Chestbreaker', category: 'Most Chests Opened' },
  { title: 'The Fallen Legend', category: 'Most Expeditions Failed' },
]
export const sealSteps = ['Mission completed', 'Treasure available', 'Choose “Seal treasure”', 'Nimiq Pay signature', 'Verified reward', 'NIM moves toward balance'] as const

// Set only after the published Mini App link has been verified. No wallet API on this route.
export const huntLaunchConfig: HuntLaunchConfig = { kind: 'unavailable' }
