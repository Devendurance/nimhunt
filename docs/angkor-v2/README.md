# Angkor Ruins V2 · Stage 1 asset kit

> **Historical provisional kit.** The owner rejected this pass's wall rendering, courtyard composition, perspective consistency and standalone architecture. All 62 originals and historical QA below are retained. The owner subsequently approved the [projection prototype](projection-test/README.md); the [production environment foundation](environment-system/README.md) now implements that projection alongside this kit. No Stage 1 implementation is authorized until review of the new environment QA.

62 original GPT Image PNGs, **10,013,571 bytes / 9.55 MiB** total. This slice adds art beside V1, authoring metadata and an isolated visual review. It adds no gameplay, stage architecture, proof, reward or payout behavior. The approved master board supplied the visual language; no board crops are shipped.

The [complete inventory](inventory.md) lists every filename, delivery dimensions, original generation dimensions and exact file size. [inventory.json](inventory.json) also records SHA-256 hashes, alpha, footprints, display dimensions, anchors, depth, category and collision suggestions. [generation.json](generation.json) records generation prompts, local original filenames and revisions. High-resolution generated originals remain in this chat's generated-images directory; the delivery PNGs are lossless, stripped of unnecessary metadata and ready for web use.

## Manifest

[angkorV2Manifest.ts](../../src/game/assets/angkorV2Manifest.ts) records all 62 files. The grid remains **32×32**, footprints are in logical tiles and display dimensions are in pixels. Most architecture anchors at bottom-center. Inner/outer corner pivots are calibrated to the front-wall ground line; the inner corner has a small visual overhang. These are authoring suggestions, not gameplay collision or interaction rules. Nothing imports this manifest from the production entry.

Floors are opaque 256×256. Modular sprites have actual transparent surroundings, including the broken opening. Walls use 384×256 canvases; tall architecture and directional idles use 256×384; passages use 512×512; Explorer master and walk sheet use 512×768. The sheet is **4 columns × 4 rows**, rows **DOWN, LEFT, RIGHT, UP**, each frame **128×192**, common foot anchor **(64,190)**, suggested playback **6 fps**. At the 22×31 display size the visible character is approximately 29.7px high.

## Dev visual review

Run `npm run dev`, then open **`/dev/angkor-v2.html`**. The standalone HTML entry loads the actual PNGs, not substitutes. It is excluded from the normal Vite production build and does not change `/play`. Controls expose native/2×/3× scale, logical grid, open/closed passage, four Explorer directions, manual frames and animation. Motion stops when the scene is offscreen, the document is hidden or reduced motion is requested.

The scene contains floor variants, wall, broken opening, pillar, guardian, roots, foliage, passage, Explorer, snake, monkey, gem, boulder and active spikes. Separate panels expose straight/corner wall joins, mixed floor seams, all sixteen anchored walk frames, and every individual file on a light alpha checker. The dark checker screenshot was captured by changing only the browser review swatch background.

## Rendered QA

Inspected the native 320×320 scene, enlarged composition, both passage states, straight and corner joins, frame sheet, and light/dark transparency catalogues. Material, upper-left lighting and illustrated identities read as one set. Floor accents avoid a periodic diagonal crack pattern; the seam strip has no visible hard rectangular edge. All sixteen manual frames were rendered in the browser, and live playback changed the scene canvas without changing the character identity. Saved PNG alpha was checked independently of the generation preview.

| Screenshot | Review |
| --- | --- |
| [Native scene](qa/angkor-scene-native.png) | Actual 32px grid and approximately 30px Explorer |
| [2× scene](qa/angkor-scene-2x.png) | Material, silhouettes and composition |
| [Closed passage](qa/angkor-scene-closed-native.png) | Closed state alongside the same scene |
| [Mobile viewport](qa/angkor-mobile-page.png) | 390×844 viewport |
| [Wall joins and floor seams](qa/angkor-joins-final.png) | Straight variants, end posts and both corner types |
| [Explorer frames](qa/angkor-walk-final.png) | All sixteen frames with common foot guides |
| [Light transparency catalogue](qa/angkor-catalogue-light.png) | All 62 files |
| [Dark transparency catalogue](qa/angkor-catalogue-dark.png) | Edges, particles and glow |

## Rejected / regenerated

- Dust small: first generation included architecture; replaced with a particle-only prompt.
- Outer/inner corners: initial diagonal V silhouettes conflicted with the square-grid camera; regenerated with horizontal front walls and calibrated join pivots.
- Damaged/mossy straight walls: the first rendered strip showed stepped profiles; regenerated as edits of the same base geometry.
- Low ruined wall: initial full-height form looked compressed at its low display size; replaced with fewer stone courses and a jagged top.
- Snake coiled/alert/strike: initial poses overlapped visually; replaced with calm closed-mouth idle, upright closed-mouth alert and a horizontal open-mouth lunge.
- Snake slither B: initial coil was replaced with an extended pose, then the extended pose was rejected for thin mobile readability; final compact reversed S retains a readable head.
- Explorer walk: initial repeated strides were replaced with clearer stride/passing frames; the rear-view row received a dedicated four-pose generation and was assembled into the sheet with the same frame canvas and ground line.
- Early mossy-wall and opening previews raised backdrop concerns and prompted replacements. Later inspection confirmed that preview appearance alone is not evidence of opacity; the final saved files pass actual-alpha checks.

## Verification

- `npm run build` — passed; Vite reported its large-chunk warning (>500kB).
- `npm run lint` — passed. Targeted lint also passed after test typing fixes.
- `npm run typecheck:server` — passed.
- `npm test -- src/game/assets/angkorV2Manifest.test.ts src/game/scenes/AngkorDevScene.test.ts server/adventurer/adventurerAssets.test.ts` — **17 tests passed in 3 files**.
- New checks cover complete paths, PNG dimensions, real modular alpha, opaque floors, valid grid metadata, all sixteen frame boundaries/ground lines, and production import isolation.
- Build-output inspection found no dev review HTML or showcase/manifest code in production HTML/JS.
- Final browser console: **0 errors, 0 warnings**. All 62 image decodes succeeded.
- Initial build attempts exposed Node typing and recursive-directory overload issues in the new inspection test. Both were corrected; the final build passes.

**Human visual approval remains:** approve the generated set's likeness to the supplied board, native mobile readability and the four-direction walking feel before any later gameplay integration. The PNG checks and agent visual review do not substitute for the art owner's acceptance.

Production baseline: `2541c19e26f66c88683a8ac5ce73bcfa24439bb9`. V1 art and production application files are untouched. Pre-existing `.agent-state` edits and untracked videos are preserved and excluded from this slice.
