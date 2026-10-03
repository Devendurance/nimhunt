/**
 * Approved V2 environment foundation plus retained provisional art.
 * Deliberately not imported by production gameplay yet.
 * Pixels use the existing 32px square grid; footprint units are logical tiles.
 * Anchors are normalized in the saved canvas; non-floor sprites are bottom-aligned.
 * Corners use calibrated front-wall ground pivots so their return geometry joins
 * straight modules. The inner corner overhangs its 2×2 authoring footprint.
 * Collidable means a suggested solid obstacle, not damage/interaction authority.
 * Walk-sheet display dimensions describe ONE frame, not the full texture.
 */
export const ANGKOR_V2_TILE_SIZE = 32
export type AngkorV2DepthClass = 'floor' | 'ground-detail' | 'hazard' | 'collectible' | 'architecture' | 'wall' | 'prop' | 'actor' | 'foreground' | 'effect'
export interface AngkorV2Asset {
  readonly key: string
  readonly path: string
  readonly sourceDimensions: { readonly width: number; readonly height: number }
  readonly logicalFootprint: { readonly width: number; readonly height: number }
  readonly displayDimensions: { readonly width: number; readonly height: number }
  readonly anchor: { readonly x: number; readonly y: number }
  readonly depthClass: AngkorV2DepthClass
  readonly collidable: boolean
  readonly category: string
  readonly renderMode: 'surface' | 'sprite'
  readonly status: 'production' | 'provisional'
}
// key, folder, source W/H, logical W/H, display W/H, anchor X/Y, depth, solid
const legacyDefinitions = [
  ["explorer-master-v2", "player/explorer", 512, 768, 0,0, 64,96, 0.5,1, 'actor', false],
  ["wall-straight-v2", "environment/walls", 384, 256, 2,1, 64,44, 0.5,1, 'architecture', true],
  ["floor-sandstone-clean-v2", "environment/floors", 256, 256, 1,1, 32,32, 0,0, 'floor', false],
  ["wall-straight-damaged-v2", "environment/walls", 384, 256, 2,1, 64,44, 0.5,1, 'architecture', true],
  ["wall-straight-mossy-v2", "environment/walls", 384, 256, 2,1, 64,44, 0.5,1, 'architecture', true],
  ["wall-broken-opening-v2", "environment/walls", 384, 256, 3,1, 96,64, 0.5,1, 'architecture', false],
  ["wall-low-ruined-v2", "environment/walls", 384, 256, 2,1, 64,28, 0.5,1, 'architecture', true],
  ["wall-corner-outer-v2", "environment/walls", 384, 256, 2,2, 64,48, 0.52,1, 'architecture', true],
  ["wall-corner-inner-v2", "environment/walls", 384, 256, 2,2, 76,56, 0.48,0.85, 'architecture', true],
  ["wall-end-left-v2", "environment/walls", 384, 256, 2,1, 64,52, 0.5,1, 'architecture', true],
  ["wall-end-right-v2", "environment/walls", 384, 256, 2,1, 64,52, 0.5,1, 'architecture', true],
  ["wall-collapsed-v2", "environment/walls", 384, 256, 2,1, 64,28, 0.5,1, 'architecture', true],
  ["floor-sandstone-weathered-v2", "environment/floors", 256, 256, 1,1, 32,32, 0,0, 'floor', false],
  ["floor-sandstone-cracked-v2", "environment/floors", 256, 256, 1,1, 32,32, 0,0, 'floor', false],
  ["floor-sandstone-mossy-v2", "environment/floors", 256, 256, 1,1, 32,32, 0,0, 'floor', false],
  ["floor-root-damaged-v2", "environment/floors", 256, 256, 1,1, 32,32, 0,0, 'floor', false],
  ["floor-debris-v2", "environment/floors", 256, 256, 1,1, 32,32, 0,0, 'floor', false],
  ["pillar-intact-v2", "environment/architecture", 256, 384, 1,1, 32,64, 0.5,1, 'architecture', true],
  ["pillar-broken-v2", "environment/architecture", 256, 384, 1,1, 32,42, 0.5,1, 'architecture', true],
  ["guardian-statue-v2", "environment/architecture", 256, 384, 1,1, 48,64, 0.5,1, 'architecture', true],
  ["statue-fragment-v2", "environment/architecture", 256, 384, 1,1, 40,32, 0.5,1, 'architecture', true],
  ["temple-passage-closed-v2", "props/stage-transitions", 512, 512, 3,2, 112,96, 0.5,1, 'architecture', false],
  ["temple-passage-open-v2", "props/stage-transitions", 512, 512, 3,2, 112,96, 0.5,1, 'architecture', false],
  ["root-floor-a-v2", "nature/roots", 256, 256, 1,1, 32,32, 0.5,1, 'ground-detail', false],
  ["root-floor-b-v2", "nature/roots", 256, 256, 1,1, 32,32, 0.5,1, 'ground-detail', false],
  ["root-wall-v2", "nature/roots", 256, 256, 1,1, 40,48, 0.5,1, 'architecture', false],
  ["root-heavy-v2", "nature/roots", 256, 256, 2,1, 64,64, 0.5,1, 'architecture', false],
  ["vine-hanging-v2", "nature/foliage", 256, 256, 1,1, 48,48, 0.5,1, 'foreground', false],
  ["fern-a-v2", "nature/foliage", 256, 256, 1,1, 32,32, 0.5,1, 'ground-detail', false],
  ["fern-b-v2", "nature/foliage", 256, 256, 1,1, 32,32, 0.5,1, 'ground-detail', false],
  ["broadleaf-a-v2", "nature/foliage", 256, 256, 1,1, 32,32, 0.5,1, 'ground-detail', false],
  ["grass-edge-v2", "nature/foliage", 256, 256, 1,1, 32,32, 0.5,1, 'ground-detail', false],
  ["moss-cluster-v2", "nature/foliage", 256, 256, 1,1, 32,32, 0.5,1, 'ground-detail', false],
  ["rubble-small-a-v2", "environment/rubble", 256, 256, 1,1, 28,24, 0.5,1, 'ground-detail', false],
  ["rubble-small-b-v2", "environment/rubble", 256, 256, 1,1, 28,24, 0.5,1, 'ground-detail', false],
  ["rubble-large-v2", "environment/rubble", 256, 256, 1,1, 48,32, 0.5,1, 'ground-detail', true],
  ["broken-stone-block-v2", "environment/rubble", 256, 256, 1,1, 28,24, 0.5,1, 'ground-detail', true],
  ["pushable-boulder-v2", "props/boulders", 256, 256, 1,1, 30,30, 0.5,1, 'prop', true],
  ["blue-gem-v2", "props/gems", 256, 256, 1,1, 18,24, 0.5,1, 'collectible', false],
  ["potion-v2", "props/gems", 256, 256, 1,1, 18,24, 0.5,1, 'collectible', false],
  ["spike-trap-idle-v2", "hazards/spikes", 256, 256, 1,1, 30,30, 0.5,1, 'hazard', false],
  ["spike-trap-active-v2", "hazards/spikes", 256, 256, 1,1, 30,30, 0.5,1, 'hazard', false],
  ["explorer-idle-down", "player/explorer", 256, 384, 1,1, 22,31, 0.5,1, 'actor', false],
  ["explorer-idle-up", "player/explorer", 256, 384, 1,1, 22,31, 0.5,1, 'actor', false],
  ["explorer-idle-left", "player/explorer", 256, 384, 1,1, 22,31, 0.5,1, 'actor', false],
  ["explorer-idle-right", "player/explorer", 256, 384, 1,1, 22,31, 0.5,1, 'actor', false],
  ["snake-coiled-v2", "wildlife/snake", 256, 256, 1,1, 30,28, 0.5,1, 'actor', false],
  ["snake-slither-a-v2", "wildlife/snake", 256, 256, 1,1, 30,28, 0.5,1, 'actor', false],
  ["snake-slither-b-v2", "wildlife/snake", 256, 256, 1,1, 30,28, 0.5,1, 'actor', false],
  ["snake-alert-v2", "wildlife/snake", 256, 256, 1,1, 30,28, 0.5,1, 'actor', false],
  ["snake-strike-v2", "wildlife/snake", 256, 256, 1,1, 30,28, 0.5,1, 'actor', false],
  ["monkey-perched-v2", "wildlife/monkey", 256, 256, 1,1, 32,32, 0.5,1, 'actor', false],
  ["monkey-alert-v2", "wildlife/monkey", 256, 256, 1,1, 32,32, 0.5,1, 'actor', false],
  ["monkey-jump-v2", "wildlife/monkey", 256, 256, 1,1, 32,32, 0.5,1, 'actor', false],
  ["monkey-throw-v2", "wildlife/monkey", 256, 256, 1,1, 32,32, 0.5,1, 'actor', false],
  ["monkey-rock-v2", "wildlife/monkey", 256, 256, 1,1, 10,10, 0.5,1, 'effect', false],
  ["dust-small-v2", "effects", 256, 256, 0,0, 28,28, 0.5,0.5, 'effect', false],
  ["dust-push-v2", "effects", 256, 256, 0,0, 40,24, 0.5,0.5, 'effect', false],
  ["rock-impact-v2", "effects", 256, 256, 0,0, 28,28, 0.5,0.5, 'effect', false],
  ["gem-sparkle-v2", "effects", 256, 256, 0,0, 28,28, 0.5,0.5, 'effect', false],
  ["leaf-particles-v2", "effects", 256, 256, 0,0, 28,28, 0.5,0.5, 'effect', false],
  ["explorer-walk-v2", "player/explorer", 512, 768, 1,1, 22,31, 0.5,1, 'actor', false],
] as const
const productionDefinitions = [
  ['silver-archive-key-v2', 'props/keys', 256,256, 1,1, 18,24, .5,248/256, 'collectible', false],
  ['pressure-plate-v2', 'props/mechanisms', 256,256, 1,1, 30,30, .5,248/256, 'ground-detail', false],
  ['chest-closed-v2', 'props/chests', 512,512, 1,1, 32,36, .5,500/512, 'prop', false],
  ['chest-open-v2', 'props/chests', 512,512, 1,1, 32,36, .5,500/512, 'prop', false],
  ['bronze-temple-key-v2', 'props/keys', 256,256, 1,1, 18,24, .5,248/256, 'collectible', false],
  ['side-gate-locked-v2', 'environment/architecture', 256,384, 1,1, 64,64, .5,376/384, 'architecture', true],
  ['side-gate-open-v2', 'environment/architecture', 256,384, 1,1, 64,64, .5,376/384, 'architecture', false],
  ['anaconda-pit-peek-v3', 'wildlife/anaconda', 512,768, 1,1, 64,112, .5,752/768, 'architecture', false],
  ['anaconda-emerge-v3', 'wildlife/anaconda', 512,768, 1,1, 64,112, .5,752/768, 'architecture', false],
  ['anaconda-upright-v3', 'wildlife/anaconda', 512,768, 1,1, 64,112, .5,752/768, 'architecture', false],
  ['anaconda-attack-v3', 'wildlife/anaconda', 512,768, 1,1, 64,112, .5,752/768, 'architecture', false],
  ['anaconda-hit-v3', 'wildlife/anaconda', 512,768, 1,1, 64,112, .5,752/768, 'architecture', false],
  ['anaconda-retract-v3', 'wildlife/anaconda', 512,768, 1,1, 64,112, .5,752/768, 'architecture', false],
  ['serpent-pit-v2', 'environment/architecture', 512,384, 1,1, 64,40, .5,.5, 'prop', true],
  ['anaconda-coiled-v2', 'wildlife/anaconda', 512,512, 3,2, 112,112, .5,504/512, 'architecture', true],
  ['anaconda-rise-v2', 'wildlife/anaconda', 512,512, 3,2, 112,112, .5,504/512, 'architecture', true],
  ['anaconda-strike-v2', 'wildlife/anaconda', 512,512, 3,2, 112,112, .5,504/512, 'architecture', true],
  ['anaconda-retreat-v2', 'wildlife/anaconda', 512,512, 3,2, 112,112, .5,504/512, 'architecture', true],
  ['anaconda-body-v2', 'wildlife/anaconda', 512,256, 2,1, 64,32, .5,248/256, 'architecture', false],
  ['guardian-monument-v2', 'environment/architecture', 384,384, 2,2, 80,96, .5,376/384, 'architecture', true],
  ['floor-clean-height-v2', 'environment/floors', 256,256, 1,1, 32,32, 0,0, 'floor', false],
  ['floor-weathered-height-v2', 'environment/floors', 256,256, 1,1, 32,32, 0,0, 'floor', false],
  ['floor-cracked-height-v2', 'environment/floors', 256,256, 1,1, 32,32, 0,0, 'floor', false],
  ['floor-mossy-height-v2', 'environment/floors', 256,256, 1,1, 32,32, 0,0, 'floor', false],
  ['floor-root-damaged-height-v2', 'environment/floors', 256,256, 1,1, 32,32, 0,0, 'floor', false],
  ['floor-debris-height-v2', 'environment/floors', 256,256, 1,1, 32,32, 0,0, 'floor', false],
  ['wall-cap-sandstone-height-v2', 'environment/walls', 256,256, 1,1, 32,32, 0,0, 'wall', true],
  ['wall-cap-moss-height-v2', 'environment/walls', 256,256, 1,1, 32,32, 0,0, 'wall', true],
  ['wall-cap-damaged-height-v2', 'environment/walls', 256,256, 1,1, 32,32, 0,0, 'wall', true],
  ['wall-face-sandstone-height-v2', 'environment/walls', 256,256, 1,1, 32,24, 0,0, 'wall', true],
  ['pillar-intact-height-v2', 'environment/architecture', 256,384, 1,1, 32,56, .5,376/384, 'architecture', true],
  ['pillar-broken-height-v2', 'environment/architecture', 256,384, 1,1, 32,36, .5,376/384, 'architecture', true],
  ['guardian-statue-height-v2', 'environment/architecture', 384,384, 1,1, 40,48, .5,376/384, 'architecture', true],
  ['statue-fragment-height-v2', 'environment/architecture', 256,256, 1,1, 32,28, .5,248/256, 'prop', true],
  ['temple-passage-closed-height-v2', 'props/stage-transitions', 512,512, 3,2, 96,80, .5,504/512, 'architecture', false],
  ['temple-passage-open-height-v2', 'props/stage-transitions', 512,512, 3,2, 96,80, .5,504/512, 'architecture', false],
  ['root-wall-climb-height-v2', 'nature/roots', 256,256, 1,1, 36,48, .5,248/256, 'foreground', false],
  ['root-corner-wrap-height-v2', 'nature/roots', 256,256, 1,1, 40,44, .5,248/256, 'foreground', false],
  ['explorer-gameplay-down-v2', 'player/explorer', 256,256, 1,1, 25,28, .5,246/256, 'actor', false],
  ['explorer-traversal-walk-v2', 'player/explorer', 1024,1024, 1,1, 25,29, .5,246/256, 'actor', false],
] as const
const definitions = [...legacyDefinitions, ...productionDefinitions] as const
export type AngkorV2AssetKey = typeof definitions[number][0]
export const ANGKOR_V2_MANIFEST: readonly AngkorV2Asset[] = definitions.map(
  ([key, category, sw, sh, fw, fh, dw, dh, ax, ay, depthClass, collidable]) => ({
    key, path: `/assets/game/angkor-v2/${category}/${key}.png`,
    sourceDimensions: { width: sw, height: sh },
    logicalFootprint: { width: fw, height: fh },
    displayDimensions: { width: dw, height: dh },
    anchor: { x: ax, y: key.startsWith('explorer-idle') || key === 'explorer-walk-v2' ? 190 / 192 : ay }, depthClass, collidable, category,
    renderMode: depthClass === 'floor' || depthClass === 'wall' ? 'surface' : 'sprite',
    status: productionDefinitions.some(entry => entry[0] === key) ? 'production' : 'provisional',
  }),
)
export const ANGKOR_V2_BY_KEY = Object.fromEntries(ANGKOR_V2_MANIFEST.map(asset => [asset.key, asset])) as Record<AngkorV2AssetKey, AngkorV2Asset>
export const ANGKOR_V2_PRODUCTION_MANIFEST = ANGKOR_V2_MANIFEST.filter(asset => asset.status === 'production')
export const ANGKOR_V2_LEGACY_MANIFEST = ANGKOR_V2_MANIFEST.filter(asset => asset.status === 'provisional')
export const ANGKOR_V2_EXPLORER_GAMEPLAY = {
  key: 'explorer-gameplay-down-v2' as const,
  visibleSourceHeight: 236,
  visibleDisplayHeight: 28 * 236 / 256,
}
export const ANGKOR_V2_TRAVERSAL_ANIMATION = {
  key: 'explorer-traversal-walk-v2' as const,
  columns: 4, rows: 4, frameWidth: 256, frameHeight: 256,
  directions: ['DOWN', 'LEFT', 'RIGHT', 'UP'] as const,
  footAnchor: { x: 128, y: 246 }, visibleSourceHeight: 232,
  // One four-phase gait spans two tile steps; no idle/moving camera switch.
  stepCycleMs: 290, idleColumn: 1,
} as const
export const ANGKOR_V2_EXPLORER_WALK = {
  key: 'explorer-walk-v2', columns: 4, rows: 4,
  frameWidth: 128, frameHeight: 192,
  directions: ['DOWN', 'LEFT', 'RIGHT', 'UP'],
  framesPerDirection: 4, framesPerSecond: 6,
  footAnchor: { x: 64, y: 190 },
} as const
