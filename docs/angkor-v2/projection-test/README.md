# Angkor V2 · 12×12 projection experiment

**Approved projection source of truth.** The owner approved this room's spatial/depth language on 2026-10-02. Its original four GPT Image outputs and development-only renderer remain available. The [reusable environment foundation](../environment-system/README.md) productionizes this projection alongside the retained prototype. The generation record and results below describe the original experiment.

Run `npm run dev` and open **`/dev/angkor-v2-projection.html`** (currently `http://127.0.0.1:5174/dev/angkor-v2-projection.html`). No production route or Vite entry configuration changed. The existing `/dev/angkor-v2.html` gallery remains available as the previous provisional pass.

## Generated files

All four delivery files live in `public/assets/game/angkor-v2/projection-test/`. Total **604,099 bytes / 589.94 KiB**. Originals remain in the Codex generated-images directory. [generation.json](generation.json) records each complete prompt, original path/dimensions, delivery dimensions, file size, SHA-256 and alpha audit. Tool: built-in GPT Image. Nothing was extracted from the approved board or Diamond Rush footage.

| File | Original | Delivery | Bytes | Use |
| --- | --- | --- | ---: | --- |
| `wall-top-stone-test.png` | 1254×1254 | 256×256 | 179,983 | Shared overhead cap surface |
| `wall-face-courses-test.png` | 1254×1254 | 256×256 | 178,272 | Shared vertical masonry courses |
| `floor-weathered-moss-test.png` | 1254×1254 | 256×256 | 154,579 | Quiet olive sandstone floor plane |
| `explorer-camera-test.png` | 1211×1299 | 256×256 | 91,265 | One overhead Explorer pose with true alpha |

The first three images are opaque **material maps**, clipped to the mesh, rather than standalone wall sprites with rectangular backgrounds. The Explorer has four transparent corners and clear padding; its alpha silhouette is **25.81px high** at the 28px canvas display height. Lossless PNG normalization preserves generated alpha. No walk sheet or full asset family was regenerated.

## Height and depth model

- Original square grid: **32×32**, 12×12 cells; 83/144 cells (57.6%) are masonry. A two-cell corridor turns into a hall and a six-cell-wide chamber. Doorway and broken breach are traversable floor gaps. The layout is original.
- Floor: `(x×32, y×32)` at visual height zero. A continuous texture pattern crosses logical tile boundaries, avoiding separately framed floor PNGs.
- Wall cap: the same square footprint shifted **24px upward** in screen Y. Shared world-aligned texture coordinates join horizontal and vertical runs. Exposed edges produce connected inner/outer corners; the pier between doorway and breach demonstrates an end cap with both returns.
- South face: extends from the cap's south edge to the original ground line; course texture, darker lower shading and a contact shadow establish height. Narrow east/west return bevels close exposed side edges. This camera looks along Y, so it uses no diagonal diamond grid or full isometric side plane.
- Doorway: two textured jambs and an elevated lintel leave a real floor opening; the beam occludes Explorer above the opening. Broken opening: staggered low fragments and reused rubble leave a second floor gap.
- Depth: a stable list sorts by **ground/base Y**, with masonry after Explorer on equal Y. The cap may project into a floor cell above its collision footprint. A character above the foreground wall therefore loses its lower body behind its cap/face; a character below it draws in front. Height changes visual coverage only.
- Collision annotation: cyan is the original 32px cell, yellow its raised visual cap. The mask is explanatory data for this preview, not connected to the deterministic production movement system.

Position selector: chamber, front, beside, behind, doorway. Door slider moves only a preview foot point along the connected floor path; there is no new movement engine, input system or gameplay simulation. Every view uses the same renderer and actual PNG files. The annotated view fixes Explorer behind the foreground wall; the plain room and phone follow the selector.

Reused assets: `root-wall-v2`, `fern-a-v2`, `moss-cluster-v2`, `rubble-small-a-v2`, `guardian-statue-v2`. Roots attach to masonry seams and the breach, vegetation grows from cap joints, and the guardian occupies a wall-adjacent niche. They are not scattered across an open field. The guardian remains a provisional concept pending camera-specific architectural art.

## Complete-room screenshots and visual review

All room images are **384×384 native game pixels**, not isolated asset cards. The phone image is a **320×384** center crop with 32px tiles, not a scaled-down room.

| Screenshot | Review |
| --- | --- |
| [Complete room · chamber](qa/projection-room-chamber.png) | Recessed corridor/chamber, connected caps and shaded faces |
| [Complete room · front](qa/projection-room-front.png) | Explorer fully in front of masonry |
| [Complete room · beside](qa/projection-room-beside.png) | Explorer beside the vertical corridor wall |
| [Complete room · behind](qa/projection-room-behind.png) | Foreground cap covers the lower character; hat remains visible |
| [Complete room · doorway](qa/projection-room-doorway.png) | Explorer passes under the lintel, feet on the floor |
| [Annotated room](qa/projection-annotated.png) | Top, face, floor, foreground occlusion, collision, corners and openings |
| [Native phone crop](qa/projection-phone-native.png) | 1 game pixel = 1 CSS pixel; no tile shrink |
| [390px review page](qa/projection-mobile-page.png) | No document overflow; larger canvases have local horizontal scrolling |

Inspected all five rendered positions, the phone crop and annotations. Architecture now defines the space rather than sitting as disconnected props on terrain. Cap runs join, floor remains visibly lower, and foreground overlap changes with foot Y. The textures retain warm sandstone and olive jungle shading. No obvious rectangular floor tile borders or opaque sprite backgrounds appeared in this room. This is a **projection candidate**, not a claim that final architectural art or all production adjacency combinations are approved.

Reference study used owner-supplied Diamond Rush Angkor videos: part 00 at 00:18, 00:48, 01:25, 02:05; part 03 at 00:10, 00:45, 01:25, 02:05. Spatial observations: dense masonry, lighter caps over shaded faces, corridors recessed into architecture, and foreground obstruction. No reference art/map was copied into the experiment.

## Reusable direction and work after approval

All **62 existing V2 PNGs are byte-identical** to their recorded SHA-256 values. The manifest remains unchanged and unwired. Snake, monkey, gem, boulder, potion, spikes, roots/foliage/rubble style and Explorer identity remain provisional reusable direction. Guardian and Temple Passage remain reusable concepts.

After camera/geometry approval, regenerate the final connected wall surfaces/edge treatments and architecture for this projection; rework pillars, guardian niches and Temple Passage so their height and floor entrances agree with the mesh. Then derive consistent Explorer directions/walk frames from the approved overhead camera. Validate nature and creatures against that camera and stress-test floor seams across larger layouts before accepting a final environment kit. Those tasks are **not started** here.

No generated candidate needed replacement during this small pass. The previous wall approach and open-courtyard composition remain rejected as final. Two renderer issues were corrected during QA: the bottom boundary exposed a false floor strip, and the original front-test position sat behind another wall. Annotation labels were expanded to avoid clipping, and Explorer canvas padding was normalized to the requested visible height.

## Verification and boundary

- `npm run build`: passed, including app TypeScript; existing large gameplay chunk warning only.
- `npm run lint`: passed.
- `npm run typecheck:server`: passed.
- Targeted Vitest: **9/9 passed** (`angkorV2ProjectionModel.test.ts`, `angkorV2Manifest.test.ts`). Checks cover connected room geometry, exposed edges, stable depth ties, valid floor positions, foreground coverage, PNG dimensions/paths and production import isolation.
- Browser: 9 PNGs decode; five poses and five door-slider positions checked; no console errors or uncaught exceptions. At 390px, document width is 390px; phone canvas remains 320px wide.
- Production build contains no projection HTML/renderer entry. Static experimental PNGs are copied by Vite's normal public-directory behavior; nothing references them from production gameplay.
- `git diff --check`: clean. No changes to production routes, V1, deterministic movement, replay/proof/reward/payout, `.agent-state`, or existing untracked videos. Only the existing manifest **test** now excludes the experimental subdirectory and checks preview import isolation.

The original projection approval gate is closed. Human visual review of the new reusable [environment QA scene](../environment-system/README.md) is required before Stage 1 implementation.
