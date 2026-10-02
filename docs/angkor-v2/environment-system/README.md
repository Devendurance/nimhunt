# Angkor V2 reusable environment foundation

**Environment system: HUMAN APPROVED (owner, 2026-10-02).** This page records the original environment slice; the [traversal foundation](../traversal/README.md) builds on it and extends its player manifest. This slice implements the approved square-grid projection alongside V1. It contains no Stage 1 map, wildlife AI, movement engine, mission changes, expedition architecture or reward/proof/payout changes.

Run `npm run dev` and open **[/dev/angkor-v2-environment.html](http://127.0.0.1:5174/dev/angkor-v2-environment.html)**. The [approved prototype](../projection-test/README.md) and original provisional gallery remain available. No production route, entry or Vite configuration imports the new renderer.

## Assets and manifest

**19 production delivery PNGs, 3,436,570 bytes (3.28 MiB)**: 15 GPT Image refinements plus four exact promotions from the approved prototype. All original 62 PNGs remain byte-identical to [their recorded hashes](../inventory.json). The master board supplied identity and material direction; no reference board or video crops are shipped.

[Complete filename/dimension/file-size inventory](inventory.md), [machine-readable inventory](inventory.json), and [generation provenance, full prompts, original dimensions and rejection record](generation.json).

- Floors: six 256×256 clean, weathered, cracked, mossy, root-damaged and debris material maps.
- Walls: three 256×256 sandstone/moss/damaged cap maps and one 256×256 face map. These are opaque surface materials, clipped into transparent wall modules at runtime.
- Architecture: intact/broken pillars 256×384; guardian 384×384; fragment 256×256; closed/open Temple Passage 512×512. Tall objects anchor at their bottom contact point, accounting for clear padding.
- Roots: wall-climbing and corner-wrapping 256×256 transparent overlays. They attach to masonry rather than containing baked stone backgrounds.
- Explorer: approved overhead pose promoted exactly to `explorer-gameplay-down-v2.png`, 256×256. Display canvas 25×28px; measured visible silhouette 25.81px, foot anchor Y = 246/256. No animation sheet was regenerated.

[src/game/assets/angkorV2Manifest.ts](../../../src/game/assets/angkorV2Manifest.ts) now contains 81 records: 19 production and 62 provisional. Each retains key/path, delivered source dimensions, logical footprint, display dimensions, anchor, depth class, collidable suggestion and category. New `status` and `renderMode` distinguish the production subset and opaque surface maps from transparent sprites. High-resolution generation dimensions are recorded separately in generation.json. `ANGKOR_V2_PRODUCTION_MANIFEST`, `ANGKOR_V2_LEGACY_MANIFEST` and the measured Explorer projection metadata avoid ambiguous selection. The historical gallery explicitly uses the 62-record legacy subset.

Existing gem, boulder, spikes, potion, snake/monkey identities, floor roots, foliage and rubble remain reusable provisional assets. The new room exercises gem/boulder/spikes, crack roots, fern/moss and small rubble. Their logic and final animation approval are outside this slice. Earlier standalone wall PNGs and architecture remain historical concepts, superseded for environment construction by this system.

## Rendering and geometry

- `geometry.ts` validates caller-owned rectangular visual cells and compiles adjacency, exposed edges, corners, end caps and height differences. The input is read-only and never altered. Maps are bounded to 64×64 cells (maximum 2048px floor texture); larger-world/chunk architecture is outside scope.
- `surfaces.ts` samples real standalone materials in world coordinates. Reflected repeats join exactly at their edges. Floor variants blend through a shared six-pixel weathered margin; neighboring cap variants preserve shared stone edges. The delivered images need not pretend to be independently seamless tiles.
- Normal caps project 24px above their logical cell; tall walls 40px, low ruins 10px and collapsed stones 5px. South faces bridge elevated cap to the ground/next lower neighbor, with darker courses and contact shadows. Narrow lit west/dark east returns close side edges.
- Horizontal/vertical tops, straight runs, inside/outside corners and left/right end caps come from joined logical geometry using the same material coordinates. A doorway uses jambs and an elevated lintel with a genuinely transparent passage. A breach uses staggered fragments. Collapsed walls use separate fallen blocks; low walls have chipped rims.
- Each wall cell owns a small transparent texture/image, not one hardcoded room background. A floor plane is generated from the supplied map. An alternate original room proves the same builder composes different boundaries.
- `environment.ts` is an opt-in Phaser adapter: preload, construct, add manifest-driven static placements, register existing actors, update and destroy. Runtime textures/objects are owned per instance and disposed on destruction or scene shutdown. Shared source textures and caller-owned actors remain caller-owned. Static attachments should be placed once; rebuild when geometry/placements change.

Logical collision is deliberately separate. The visual cell schema, doorway opening and manifest collision hints establish **no** movement permissions, physics bodies, replay state or deterministic rules. Future gameplay must retain its own authoritative logical geometry.

## Depth and readability

Floor and floor overlays use depths 0 and 1. World depths use `1000 + floorFootY × 16 + classTie`: ground items, low props, actor, architecture, wall, foreground vegetation and effects have stable local ties. All these world classes interleave by Y; foreground foliage is not permanently above every actor. Caps/faces remain one height-aware module, sorted at the base of their logical cell.

Only registered actors recalculate depth when their foot changes. Static structures retain fixed depth. Readability tests run when actor position or registration/settings change; fading animation updates until settled.

Real texture alpha is sampled over the upper eight pixels of the actor silhouette. If foreground structures jointly cover over 55% of 15 head samples, only contributing structures fade; transparent gateway holes/root gaps do not count. Union coverage handles seams between wall cells. A single structure fades to 38% opacity; stacked contributors receive a lower individual alpha so their combined opacity stays at most 38%. Fade/restore uses a 100ms transition budget. Partial lower-body overlap remains opaque and reads naturally; a fully hidden head triggers cutaway. Unregistering an actor, disabling readability or moving clear restores structure alpha.

Minimal integration (future opt-in scene; not connected to /play):

```ts
// Scene.preload:
preloadAngkorV2Environment(this, ['fern-a-v2'])

// Scene.create: visualMap is caller-provided EnvironmentMap data.
const environment = new AngkorV2Environment(this, visualMap)
environment.addSprite({ key: 'pillar-intact-height-v2', x: 80, y: 160 })
const detach = environment.trackActor(existingPlayer, {
  foot: () => existingPlayerFloorFoot,
})

// Scene.update: this changes rendering only.
environment.update(deltaMs)
// Before removing a caller-owned actor:
detach()
// Scene shutdown destroys the environment automatically; explicit destroy is safe.
environment.destroy()
```

## Complete-room QA

The 12×12 primary fixture includes a two-cell corridor/turn, chamber, inside/outside corners, doorway, breach, low/collapsed/tall walls, two pillars, guardian/fragment, both passage states and roots attached to architecture. All eight poses use the same live Phaser environment, not separate scene paintings.

| Actual-scale screenshot | Check |
| --- | --- |
| [Complete room · chamber](qa/environment-room-chamber.png) | Recessed floor, connected masonry, integrated architecture |
| [In front](qa/environment-room-front.png) | Explorer draws in front of masonry; no fade |
| [Beside](qa/environment-room-beside.png) | Corridor wall does not cover the neighboring actor |
| [Partial overlap](qa/environment-room-partial.png) | Lower body occluded; visible head, no fade |
| [Tall-wall cutaway](qa/environment-room-tall.png) | One structure fades |
| [Wall/door seam cutaway](qa/environment-room-seam.png) | Two modules jointly fade |
| [Pillar cutaway](qa/environment-room-pillar.png) | Pillar and foreground masonry preserve head readability |
| [Door lintel](qa/environment-room-doorway.png) | Appropriate foreground cutaway under beam |
| [Cutaway disabled comparison](qa/environment-cutaway-disabled.png) | Demonstrates the obstruction being corrected |
| [Closed passage](qa/environment-passage-closed.png) | Closed/open variants share footprint and camera |
| [Alternate room](qa/environment-alternate.png) | Same assets/helper, different logical boundaries |
| [Logical grid](qa/environment-logical-grid.png) | 32px logical footprint remains independent of overhang |
| [Phone · chamber](qa/environment-phone-native.png) | 320×384 native-pixel crop |
| [Phone · cutaway](qa/environment-phone-cutaway.png) | Player readable at actual gameplay scale |
| [Desktop review page](qa/environment-desktop-page.png) | 1280px viewport |
| [Mobile review page](qa/environment-mobile-page.png) | 390px document, 320px phone canvas; no document overflow |

Room screenshots are 384×384 native game pixels; phone screenshots are 320×384 crops of the same rendered frame. The phone view keeps 1 game pixel = 1 CSS pixel; it never shrinks the logical grid. This is browser viewport QA, not physical-device performance certification.

Visual inspection: the complete room reads as a character inside dense sandstone ruins. Raised connected caps, dark faces and base shadows define chambers and corridors. Foreground overlap changes with foot Y. No rectangular sprite backdrops or obvious per-cell floor borders appeared. Vegetation stays restrained and attached to seams/corners.

One generated intact pillar was rejected because its diamond plinth implied isometric geometry. It was regenerated with an axis-aligned rectangular cap/base. The old flat wall/courtyard approach remains rejected. Other new materials/architecture passed this room review; all sprite deliveries have actual transparent padding. Gate previews show colored hidden RGB pixels in some fully transparent regions, but alpha inspection and the rendered scene confirm these are not baked backgrounds.

## Verification

- `npm run build`: passed; existing large gameplay chunk warning only.
- `npm run lint`: passed after replacing the dev scene's direct `this` alias with callback bindings.
- `npm run typecheck:server`: passed.
- `npx tsc -b --force`: passed (app and existing project references).
- Targeted Vitest: **29/29 passed** across manifest, geometry, Phaser lifecycle, original projection and existing Angkor scene tests. The final production-sprite four-corner alpha assertion was additionally checked with all six manifest tests passing.
- Production build contains no environment QA HTML or new renderer/material references in bundled JavaScript. Import-graph tests also confirm production isolation.
- Original 62 V2 PNG hashes match; `.agent-state` binary diff matches its saved pre-work hash. No V1/production route, movement/replay/proof/reward/payout or video edits.

Browser checks cover eight poses, five doorway-slider positions (one lintel fade, then restoration), alternate geometry, passage states and six repeated room rebuilds. Rebuilds keep 86 owned runtime textures and 108 display objects, without growth. All 26 required production/reused PNGs load; browser console has zero errors/warnings and no uncaught exceptions. A fresh reload after the lint fix also verified tall-wall fade and restoration.

The renderer is production code available for opt-in use, while its QA entry remains development-only. P1–P6, Reward Week, Angkor V1, movement/replay/proof/reward/payout, unrelated local changes, .agent-state and videos are preserved.

**Environment approval gate is closed.** The owner approved this environment and requested the separate traversal foundation. No Stage 1 implementation follows this environment slice.
