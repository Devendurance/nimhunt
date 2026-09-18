import type {
  BlueprintBoulder,
  BlueprintChest,
  BlueprintGem,
  BlueprintGoblin,
  BlueprintHazard,
  ExpeditionBlueprint,
  GridCoord,
  MissionType,
  TimedHazard,
} from '../replay/types.ts'
import {
  BLUEPRINT_VERSION_V2,
  ROOM_VERSION,
  RULES_VERSION,
} from '../replay/versions.ts'
import { ANGKOR_ROOM_01 } from './room01.ts'

export interface AngkorVariantDefinition {
  readonly name: string
  readonly description: string
  readonly goblins: readonly BlueprintGoblin[]
  readonly gems: readonly BlueprintGem[]
  readonly chests: readonly BlueprintChest[]
  readonly sword: GridCoord | null
  readonly potion: GridCoord | null
  readonly hazards: readonly BlueprintHazard[]
  readonly boulders: readonly BlueprintBoulder[]
  readonly key: GridCoord
  readonly gate: GridCoord
  readonly objective: GridCoord
  readonly timedHazards?: readonly TimedHazard[]
}

/**
 * 9 Canonical Angkor Room 01 Layout Variants
 * (3 per mission: Gem Runner, Chest Hunter, Vault Breaker)
 *
 * All coordinates strictly comply with Angkor Room 01 walkable geometry,
 * zero coordinate collision between any entities, non-empty walkable patrol routes,
 * and smart placement constraints.
 */
export const ANGKOR_CANONICAL_VARIANTS: Readonly<Record<MissionType, readonly [AngkorVariantDefinition, AngkorVariantDefinition, AngkorVariantDefinition]>> = {
  'gem-runner': [
    // Variant 1: Perimeter Sprint (2 Goblins: East lane + North lane)
    {
      name: 'Perimeter Sprint',
      description: 'Gems scattered around the outer corridors. Goblins patrol the East and North corridors.',
      goblins: [
        {
          id: 'gr1-goblin-1',
          spawn: { x: 7, y: 5 },
          patrolRoute: [{ x: 7, y: 5 }, { x: 7, y: 6 }, { x: 7, y: 7 }],
        },
        {
          id: 'gr1-goblin-2',
          spawn: { x: 5, y: 1 },
          patrolRoute: [{ x: 5, y: 1 }, { x: 4, y: 1 }, { x: 3, y: 1 }],
        },
      ],
      gems: [
        { id: 'gr1-gem-1', x: 1, y: 1 },
        { id: 'gr1-gem-2', x: 6, y: 1 },
        { id: 'gr1-gem-3', x: 1, y: 3 },
        { id: 'gr1-gem-4', x: 1, y: 5 },
        { id: 'gr1-gem-5', x: 1, y: 8 },
        { id: 'gr1-gem-6', x: 5, y: 8 },
        { id: 'gr1-gem-7', x: 7, y: 4 },
        { id: 'gr1-gem-8', x: 4, y: 5 },
      ],
      chests: [
        { id: 'gr1-chest-1', x: 2, y: 1, loot: 'GEMS' },
        { id: 'gr1-chest-2', x: 6, y: 3, loot: 'POTION' },
        { id: 'gr1-chest-3', x: 5, y: 5, loot: 'TRAP' },
        { id: 'gr1-chest-4', x: 10, y: 3, loot: 'SWORD' },
      ],
      sword: { x: 1, y: 7 },
      potion: { x: 2, y: 4 },
      hazards: [
        { x: 2, y: 2, type: 'SPIKES' },
        { x: 6, y: 6, type: 'POISON' },
      ],
      boulders: [{ id: 'gr1-boulder-1', x: 4, y: 7 }],
      key: { x: 3, y: 6 },
      gate: { x: 8, y: 3 },
      objective: { x: 9, y: 3 },
    },
    // Variant 2: Center Prowler (1 Goblin patrolling central ruins)
    {
      name: 'Center Prowler',
      description: 'Single high-pressure goblin sweeping the central ruins. Gems require navigating north and south corridors.',
      goblins: [
        {
          id: 'gr2-goblin-1',
          spawn: { x: 6, y: 5 },
          patrolRoute: [{ x: 6, y: 5 }, { x: 6, y: 6 }, { x: 6, y: 7 }, { x: 7, y: 7 }],
        },
      ],
      gems: [
        { id: 'gr2-gem-1', x: 2, y: 1 },
        { id: 'gr2-gem-2', x: 4, y: 1 },
        { id: 'gr2-gem-3', x: 7, y: 1 },
        { id: 'gr2-gem-4', x: 1, y: 4 },
        { id: 'gr2-gem-5', x: 2, y: 7 },
        { id: 'gr2-gem-6', x: 4, y: 8 },
        { id: 'gr2-gem-7', x: 7, y: 8 },
        { id: 'gr2-gem-8', x: 5, y: 4 },
      ],
      chests: [
        { id: 'gr2-chest-1', x: 1, y: 2, loot: 'POTION' },
        { id: 'gr2-chest-2', x: 7, y: 3, loot: 'GEMS' },
        { id: 'gr2-chest-3', x: 5, y: 6, loot: 'TRAP' },
        { id: 'gr2-chest-4', x: 9, y: 1, loot: 'SWORD' },
      ],
      sword: { x: 3, y: 6 },
      potion: { x: 6, y: 2 },
      hazards: [
        { x: 5, y: 1, type: 'SPIKES' },
        { x: 1, y: 6, type: 'POISON' },
      ],
      boulders: [{ id: 'gr2-boulder-1', x: 4, y: 6 }],
      key: { x: 1, y: 8 },
      gate: { x: 8, y: 3 },
      objective: { x: 10, y: 3 },
    },
    // Variant 3: Twin Patrols (2 Goblins: West vertical lane + South horizontal lane)
    {
      name: 'Twin Patrols',
      description: 'Goblins patrolling West and South corridors. Multiple route options through central halls.',
      goblins: [
        {
          id: 'gr3-goblin-1',
          spawn: { x: 2, y: 5 },
          patrolRoute: [{ x: 2, y: 5 }, { x: 2, y: 4 }, { x: 2, y: 3 }, { x: 2, y: 2 }],
        },
        {
          id: 'gr3-goblin-2',
          spawn: { x: 7, y: 6 },
          patrolRoute: [{ x: 7, y: 6 }, { x: 6, y: 6 }, { x: 5, y: 6 }, { x: 4, y: 6 }],
        },
      ],
      gems: [
        { id: 'gr3-gem-1', x: 1, y: 1 },
        { id: 'gr3-gem-2', x: 3, y: 1 },
        { id: 'gr3-gem-3', x: 6, y: 1 },
        { id: 'gr3-gem-4', x: 1, y: 7 },
        { id: 'gr3-gem-5', x: 3, y: 8 },
        { id: 'gr3-gem-6', x: 6, y: 8 },
        { id: 'gr3-gem-7', x: 5, y: 3 },
        { id: 'gr3-gem-8', x: 4, y: 5 },
      ],
      chests: [
        { id: 'gr3-chest-1', x: 1, y: 3, loot: 'SWORD' },
        { id: 'gr3-chest-2', x: 6, y: 2, loot: 'GEMS' },
        { id: 'gr3-chest-3', x: 3, y: 6, loot: 'TRAP' },
        { id: 'gr3-chest-4', x: 10, y: 4, loot: 'POTION' },
      ],
      sword: { x: 7, y: 1 },
      potion: { x: 6, y: 3 },
      hazards: [
        { x: 5, y: 1, type: 'SPIKES' },
        { x: 1, y: 5, type: 'POISON' },
      ],
      boulders: [{ id: 'gr3-boulder-1', x: 5, y: 7 }],
      key: { x: 1, y: 8 },
      gate: { x: 8, y: 3 },
      objective: { x: 9, y: 3 },
    },
  ],
  'chest-hunter': [
    // Variant 1: Four Corners (2 Goblins: East lane + West lane)
    {
      name: 'Four Corners',
      description: 'Four chests positioned in the four quadrants. Spikes guard the north-east chest.',
      goblins: [
        {
          id: 'ch1-goblin-1',
          spawn: { x: 7, y: 4 },
          patrolRoute: [{ x: 7, y: 4 }, { x: 7, y: 5 }, { x: 7, y: 6 }, { x: 7, y: 7 }],
        },
        {
          id: 'ch1-goblin-2',
          spawn: { x: 2, y: 4 },
          patrolRoute: [{ x: 2, y: 4 }, { x: 2, y: 3 }, { x: 2, y: 2 }],
        },
      ],
      gems: [
        { id: 'ch1-gem-1', x: 2, y: 1 },
        { id: 'ch1-gem-2', x: 6, y: 3 },
        { id: 'ch1-gem-3', x: 5, y: 8 },
        { id: 'ch1-gem-4', x: 10, y: 3 },
      ],
      chests: [
        { id: 'ch1-chest-1', x: 1, y: 1, loot: 'POTION' },
        { id: 'ch1-chest-2', x: 1, y: 8, loot: 'SWORD' },
        { id: 'ch1-chest-3', x: 6, y: 5, loot: 'GEMS' },
        { id: 'ch1-chest-4', x: 7, y: 1, loot: 'TRAP' },
      ],
      sword: { x: 1, y: 6 },
      potion: { x: 5, y: 2 },
      hazards: [
        { x: 5, y: 1, type: 'SPIKES' },
        { x: 4, y: 6, type: 'POISON' },
      ],
      boulders: [{ id: 'ch1-boulder-1', x: 4, y: 5 }],
      key: { x: 3, y: 6 },
      gate: { x: 8, y: 3 },
      objective: { x: 9, y: 3 },
    },
    // Variant 2: The Choke (2 Goblins: North hallway + East lane)
    {
      name: 'The Choke',
      description: 'Chests spread across sectors with goblins patrolling the connector routes.',
      goblins: [
        {
          id: 'ch2-goblin-1',
          spawn: { x: 5, y: 1 },
          patrolRoute: [{ x: 5, y: 1 }, { x: 4, y: 1 }, { x: 3, y: 1 }],
        },
        {
          id: 'ch2-goblin-2',
          spawn: { x: 7, y: 6 },
          patrolRoute: [{ x: 7, y: 6 }, { x: 7, y: 7 }, { x: 7, y: 8 }],
        },
      ],
      gems: [
        { id: 'ch2-gem-1', x: 2, y: 1 },
        { id: 'ch2-gem-2', x: 7, y: 1 },
        { id: 'ch2-gem-3', x: 7, y: 5 },
        { id: 'ch2-gem-4', x: 4, y: 8 },
      ],
      chests: [
        { id: 'ch2-chest-1', x: 1, y: 2, loot: 'SWORD' },
        { id: 'ch2-chest-2', x: 1, y: 7, loot: 'GEMS' },
        { id: 'ch2-chest-3', x: 7, y: 3, loot: 'POTION' },
        { id: 'ch2-chest-4', x: 5, y: 5, loot: 'TRAP' },
      ],
      sword: { x: 1, y: 5 },
      potion: { x: 6, y: 4 },
      hazards: [
        { x: 6, y: 2, type: 'SPIKES' },
        { x: 2, y: 5, type: 'POISON' },
      ],
      boulders: [{ id: 'ch2-boulder-1', x: 4, y: 6 }],
      key: { x: 2, y: 8 },
      gate: { x: 8, y: 3 },
      objective: { x: 10, y: 3 },
    },
    // Variant 3: Crossroads (2 Goblins: East gate lane + West lane)
    {
      name: 'Crossroads',
      description: 'A spread-out layout requiring full traversal of the ruins from NW to deep SE.',
      goblins: [
        {
          id: 'ch3-goblin-1',
          spawn: { x: 7, y: 4 },
          patrolRoute: [{ x: 7, y: 4 }, { x: 7, y: 5 }, { x: 7, y: 6 }],
        },
        {
          id: 'ch3-goblin-2',
          spawn: { x: 2, y: 4 },
          patrolRoute: [{ x: 2, y: 4 }, { x: 2, y: 3 }, { x: 2, y: 2 }],
        },
      ],
      gems: [
        { id: 'ch3-gem-1', x: 2, y: 1 },
        { id: 'ch3-gem-2', x: 4, y: 5 },
        { id: 'ch3-gem-3', x: 5, y: 8 },
        { id: 'ch3-gem-4', x: 10, y: 4 },
      ],
      chests: [
        { id: 'ch3-chest-1', x: 1, y: 1, loot: 'SWORD' },
        { id: 'ch3-chest-2', x: 5, y: 1, loot: 'POTION' },
        { id: 'ch3-chest-3', x: 1, y: 8, loot: 'TRAP' },
        { id: 'ch3-chest-4', x: 6, y: 7, loot: 'GEMS' },
      ],
      sword: { x: 1, y: 3 },
      potion: { x: 6, y: 6 },
      hazards: [
        { x: 6, y: 1, type: 'SPIKES' },
        { x: 5, y: 6, type: 'POISON' },
      ],
      boulders: [{ id: 'ch3-boulder-1', x: 4, y: 6 }],
      key: { x: 3, y: 6 },
      gate: { x: 8, y: 3 },
      objective: { x: 9, y: 3 },
    },
  ],
  'vault-breaker': [
    // Variant 1: The Gauntlet (3 Goblins: West route, East gate route, North corridor)
    {
      name: 'The Gauntlet',
      description: 'Triple-goblin fortress. Key is located deep in the South-West corner (1,8). Objective at (10,3).',
      goblins: [
        {
          id: 'vb1-goblin-1',
          spawn: { x: 2, y: 4 },
          patrolRoute: [{ x: 2, y: 4 }, { x: 2, y: 5 }, { x: 1, y: 5 }],
        },
        {
          id: 'vb1-goblin-2',
          spawn: { x: 7, y: 5 },
          patrolRoute: [{ x: 7, y: 5 }, { x: 7, y: 6 }, { x: 7, y: 7 }],
        },
        {
          id: 'vb1-goblin-3',
          spawn: { x: 5, y: 1 },
          patrolRoute: [{ x: 5, y: 1 }, { x: 6, y: 1 }, { x: 7, y: 1 }],
        },
      ],
      gems: [
        { id: 'vb1-gem-1', x: 1, y: 3 },
        { id: 'vb1-gem-2', x: 4, y: 1 },
        { id: 'vb1-gem-3', x: 5, y: 5 },
        { id: 'vb1-gem-4', x: 10, y: 7 },
      ],
      chests: [
        { id: 'vb1-chest-1', x: 2, y: 1, loot: 'POTION' },
        { id: 'vb1-chest-2', x: 3, y: 1, loot: 'GEMS' },
        { id: 'vb1-chest-3', x: 10, y: 1, loot: 'SWORD' },
        { id: 'vb1-chest-4', x: 9, y: 8, loot: 'EMPTY' },
      ],
      sword: { x: 1, y: 1 },
      potion: { x: 2, y: 7 },
      hazards: [
        { x: 5, y: 3, type: 'SPIKES' },
        { x: 6, y: 6, type: 'POISON' },
      ],
      boulders: [{ id: 'vb1-boulder-1', x: 4, y: 6 }],
      key: { x: 1, y: 8 },
      gate: { x: 8, y: 3 },
      objective: { x: 10, y: 3 },
      timedHazards: [
        {
          id: 'vb1-collapsing-boulder-1',
          x: 6,
          y: 2,
          type: 'COLLAPSING_BOULDER',
          trigger: 'REAL_TIME',
          delay: 4,
          warningTicks: 4,
          triggerCells: [{ x: 6, y: 1 }, { x: 5, y: 1 }],
        },
      ],
    },
    // Variant 2: The Infiltration (2 Goblins: East gate route + North hallway)
    {
      name: 'The Infiltration',
      description: 'Key hidden in the West pocket (1,7). Gate guarded by patrolling goblin. Inner vault objective at (9,2).',
      goblins: [
        {
          id: 'vb2-goblin-1',
          spawn: { x: 7, y: 4 },
          patrolRoute: [{ x: 7, y: 4 }, { x: 7, y: 5 }, { x: 7, y: 6 }],
        },
        {
          id: 'vb2-goblin-2',
          spawn: { x: 4, y: 1 },
          patrolRoute: [{ x: 4, y: 1 }, { x: 5, y: 1 }, { x: 6, y: 1 }],
        },
      ],
      gems: [
        { id: 'vb2-gem-1', x: 3, y: 1 },
        { id: 'vb2-gem-2', x: 6, y: 2 },
        { id: 'vb2-gem-3', x: 5, y: 7 },
        { id: 'vb2-gem-4', x: 10, y: 8 },
      ],
      chests: [
        { id: 'vb2-chest-1', x: 1, y: 1, loot: 'SWORD' },
        { id: 'vb2-chest-2', x: 7, y: 1, loot: 'POTION' },
        { id: 'vb2-chest-3', x: 1, y: 8, loot: 'GEMS' },
        { id: 'vb2-chest-4', x: 10, y: 4, loot: 'EMPTY' },
      ],
      sword: { x: 2, y: 1 },
      potion: { x: 5, y: 5 },
      hazards: [
        { x: 5, y: 3, type: 'SPIKES' },
        { x: 6, y: 3, type: 'POISON' },
      ],
      boulders: [{ id: 'vb2-boulder-1', x: 4, y: 6 }],
      key: { x: 1, y: 7 },
      gate: { x: 8, y: 3 },
      objective: { x: 9, y: 2 },
    },
    // Variant 3: Citadel Fortress (3 Goblins: Gate guard, West corridor, North hallway)
    {
      name: 'Citadel Fortress',
      description: 'Maximum pressure. Key in the South ruins (5,8), shrine deep in the lower vault (10,8).',
      goblins: [
        {
          id: 'vb3-goblin-1',
          spawn: { x: 7, y: 6 },
          patrolRoute: [{ x: 7, y: 6 }, { x: 7, y: 5 }, { x: 7, y: 4 }],
        },
        {
          id: 'vb3-goblin-2',
          spawn: { x: 2, y: 5 },
          patrolRoute: [{ x: 2, y: 5 }, { x: 2, y: 4 }, { x: 2, y: 3 }],
        },
        {
          id: 'vb3-goblin-3',
          spawn: { x: 5, y: 1 },
          patrolRoute: [{ x: 5, y: 1 }, { x: 4, y: 1 }, { x: 3, y: 1 }],
        },
      ],
      gems: [
        { id: 'vb3-gem-1', x: 2, y: 1 },
        { id: 'vb3-gem-2', x: 7, y: 1 },
        { id: 'vb3-gem-3', x: 3, y: 6 },
        { id: 'vb3-gem-4', x: 10, y: 3 },
      ],
      chests: [
        { id: 'vb3-chest-1', x: 1, y: 4, loot: 'POTION' },
        { id: 'vb3-chest-2', x: 6, y: 1, loot: 'GEMS' },
        { id: 'vb3-chest-3', x: 1, y: 8, loot: 'SWORD' },
        { id: 'vb3-chest-4', x: 9, y: 1, loot: 'EMPTY' },
      ],
      sword: { x: 1, y: 1 },
      potion: { x: 2, y: 8 },
      hazards: [
        { x: 4, y: 7, type: 'SPIKES' },
        { x: 6, y: 5, type: 'POISON' },
      ],
      boulders: [{ id: 'vb3-boulder-1', x: 4, y: 5 }],
      key: { x: 5, y: 8 },
      gate: { x: 8, y: 3 },
      objective: { x: 10, y: 8 },
    },
  ],
}

/**
 * Deterministic daily variant selection based on server-owned inputs:
 * dayKey + mission + world ('angkor') + room ('01') + version ('v2').
 * Returns index 0, 1, or 2.
 */
export function selectDailyVariantIndex(dayKey: string, mission: MissionType): number {
  const seed = `${dayKey}:${mission}:angkor:01:${BLUEPRINT_VERSION_V2}`
  let hash = 2166136261
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return Math.abs(hash) % 3
}

/**
 * Creates an authoritative ExpeditionBlueprint for Angkor Room 01 with V2 mission difficulty.
 */
export function createDailyAngkorBlueprint(
  dayKey: string,
  mission: MissionType,
  variantIndex = selectDailyVariantIndex(dayKey, mission),
  blueprintId = `angkor01-${dayKey}-${mission}-v${variantIndex + 1}`,
  hasher?: (bp: ExpeditionBlueprint) => string,
): ExpeditionBlueprint {
  const variants = ANGKOR_CANONICAL_VARIANTS[mission]
  const clampedIndex = ((variantIndex % variants.length) + variants.length) % variants.length
  const variant = variants[clampedIndex]!

  const unhashed: ExpeditionBlueprint = {
    rulesVersion: RULES_VERSION,
    roomVersion: ROOM_VERSION,
    blueprintVersion: BLUEPRINT_VERSION_V2,
    dayKey,
    mission,
    blueprintId,
    blueprintHash: '',
    status: 'VALIDATED',
    spawn: { ...ANGKOR_ROOM_01.playerStart },
    goblins: variant.goblins.map(g => ({
      id: g.id,
      spawn: { ...g.spawn },
      patrolRoute: g.patrolRoute.map(c => ({ ...c })),
    })),
    gems: variant.gems.map(g => ({ ...g })),
    chests: variant.chests.map(c => ({ ...c })),
    sword: variant.sword ? { ...variant.sword } : null,
    potion: variant.potion ? { ...variant.potion } : null,
    hazards: variant.hazards.map(h => ({ ...h })),
    boulders: variant.boulders.map(b => ({ ...b })),
    key: { ...variant.key },
    gate: { ...variant.gate },
    objective: { ...variant.objective },
    missionParameters: { gemTarget: 6, chestTarget: 4 },
    timedHazards: (variant.timedHazards ?? []).map(th => ({
      ...th,
      triggerCells: th.triggerCells ? th.triggerCells.map(tc => ({ ...tc })) : undefined,
    })),
  }

  return {
    ...unhashed,
    blueprintHash: hasher ? hasher(unhashed) : '',
  }
}

/**
 * Returns all 9 canonical variants instantiated for a reference dayKey.
 */
export function getAllCanonicalVariants(
  dayKey = '2026-09-17',
  hasher?: (bp: ExpeditionBlueprint) => string,
): readonly ExpeditionBlueprint[] {
  const missions: readonly MissionType[] = ['gem-runner', 'chest-hunter', 'vault-breaker']
  const result: ExpeditionBlueprint[] = []
  for (const mission of missions) {
    for (let variant = 0; variant < 3; variant += 1) {
      result.push(createDailyAngkorBlueprint(dayKey, mission, variant, undefined, hasher))
    }
  }
  return result
}
