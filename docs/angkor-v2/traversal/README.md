# Angkor V2 traversal foundation

**READY_FOR_STAGE_1_GAMEPLAY: YES — reusable local traversal/camera/player foundation validated.** The environment is human approved. This slice adds no Gem Runner objectives, wildlife logic, stage progression or reward/proof/payout behavior. The new development map is not a final mission layout.

Run `npm run dev` and open **[/dev/angkor-v2-traversal.html](http://127.0.0.1:5174/dev/angkor-v2-traversal.html)**. Hold the P6 D-pad or arrows/WASD; Reset run returns to the development spawn. Debug is off by default and exposes collision cells, current camera frame and logical player coordinates. Existing `/play`, V1, mission/proof/checkpoint contracts and main are unchanged.

## Map and collision

The authored map is **30×24 logical tiles / 960×768 pixels**, with connected chambers, two-cell corridors, turns, a doorway, broken breach, tall/low/collapsed walls, solid pillars/guardians and a closed Temple Passage. It has **298 walkable cells and 422 blocked cells (58.6%)**; every walkable tile is reachable through legal cardinal moves. Camera edges can be reached by exploring the southern/eastern wings and returning west/north.

`TraversalMapTruth` contains explicit source symbols and occupied architecture cells. `compileTraversalMap` creates separate `EnvironmentMap` visual cells and `GridRoom` collision strings. For example, pillar/guardian cells render a floor plus sprite but are blocked logically; a doorway/breach renders architecture but remains walkable. The closed Temple's explicit 3×2 footprint includes its threshold floor cell. No PNG alpha or manifest collision suggestion determines movement permissions. Invalid symbols, ragged maps, open boundaries and invalid occupied cells fail validation.

All destinations delegate to the existing, unchanged **`calculateMove`**. Each accepted action moves one integer tile in UP/DOWN/LEFT/RIGHT. Local traversal actions include sequence/from/to/direction for QA; they are not sent to expedition, replay, checkpoint or proof endpoints.

## Held input and movement

`TileTraversal` schedules **145ms per tile** (V1 remains 160ms). It permits one in-flight move and one buffered direction. The latest newly pressed direction replaces the buffer, which can survive a short intentional tap released before the current step finishes. At completion, the buffered turn is tried first, then the latest held direction. An illegal buffered turn is consumed; an independently held legal direction may continue. A blocked hold emits no accepted MOVE and does not keep retrying each frame.

Keyboard ownership uses physical key IDs and the existing Arrow/WASD mapping; OS repeat does not enqueue additional turns. The D-pad adds optional `heldInput` callbacks with pointer capture/release/cancellation. Existing production and Practice callers do not pass this option, retaining P6 tap/click behavior. Multiple held sources have a stable latest-press priority. Pointer cancellation, blur, hidden pages and cleanup clear pending input while allowing an already accepted tile to finish.

Presentation interpolates a grounded foot linearly; animation never changes the logical destination or order. Ordinary frame overshoot carries at most 16ms into the next presentation so holds do not pause between tiles. A suspended/slow frame completes at most one existing tile and starts at most one next move; it cannot catch up through a burst of unseen logical steps.

## Player and animation

The old `explorer-walk-v2.png` is technically anchored but more frontal than the approved overhead pose. It remains unchanged and is not used here. Built-in GPT Image produced **one bounded corrected atlas**, referenced from the approved `explorer-gameplay-down-v2.png`; no environment family was regenerated.

New file: `public/assets/game/angkor-v2/player/explorer/explorer-traversal-walk-v2.png`, **1024×1024, 1,283,783 bytes**. It contains 4×4 square 256px frames, rows **DOWN, LEFT, RIGHT, UP**, true alpha, common foot pivot **(128,246)** and equal 232px visible source height. Delivery normalization crops only the generated atlas poses, retains high-resolution originals and aligns their feet. It extracts nothing from the approved master board.

Idle holds a consistent directional planted pose; walking uses four phases over a 290ms/two-tile gait. Display canvas is 25×29px, giving a **26.28px native visible silhouette** (approximately 23.9px on the narrow 320px view). Texture/frame origin, display size and floor foot remain constant. Upper-hat lateral variation within a walk row measures at most 0.35 native display pixels. All sixteen frame ground lines/heights are verified.

[Full prompt, source path/dimensions, normalization bounds, hash and rejection notes](animation.json). The manifest now has **82 records: 20 production, 62 provisional**, plus typed traversal animation metadata. All previous **81 PNGs are byte-identical** to their recorded hashes.

## Camera and moving depth

The camera uses a constant view chosen once when the page mounts:

- Standard: 384×320 world pixels / **12×10 tiles**.
- Narrow phones: 352px world width / **11 tiles**.
- Short screens: 288px world height / **9 tiles**, retaining reachable controls.

Desktop/tablet never expands the world view enough to reveal the map. Responsive CSS scales this chosen view without changing camera zoom during movement. A reload chooses a new view for a different screen size; there is no mid-move camera resize. Normal follow uses time-based exponential smoothing with a 38ms response and a **57.5% vertical foot target**, clamped to world bounds. It has roughly eight pixels of travel lag at full speed, without ordinary snapping or zoom pulses.

`TraversalPlayer` registers its sprite with the approved `AngkorV2Environment.trackActor`. Update order is controller → grounded sprite/frame → environment depth/readability → camera. Existing Y sorting and alpha-aware cutaways follow the moving foot, then restore opacity when clear. **No environment renderer source was changed.**

Reduced motion disables walking-frame cycling and camera trailing; necessary cardinal translation remains smooth at the same timing, and the camera follows the interpolated foot directly. No bump/flash/bounce is added.

Minimal opt-in integration:

```ts
// preload: shared production assets and any nature placements
preloadAngkorV2Environment(scene, natureKeys)
// create: explicit map truth; collision remains separate from environment visuals
const map = compileTraversalMap(authoredTruth)
const environment = new AngkorV2Environment(scene, map.visual)
map.structures.forEach(sprite => environment.addSprite(sprite))
const traversal = new TileTraversal(map.collision, acceptedLocalMove => {
  // local consumer only; no proof/checkpoint contract is introduced here
})
const player = new TraversalPlayer(scene, environment, traversal)
const unbind = bindTraversalKeyboard(traversal)
// update:
traversal.update(delta)
player.update(delta, reducedMotion)
environment.update(delta)
scroll = followCamera(scroll, traversal.foot, map.world, delta, reducedMotion, viewport)
// shutdown:
unbind()
player.destroy()
environment.destroy()
```

## QA evidence

[Recorded browser/check results](qa-results.json). All screenshots export CSS pixels, accounting for Windows device scaling. The logical viewport remains 384×320 or the documented narrower/shorter view; page screenshots show actual mobile control reach.

| Screenshot | Evidence |
| --- | --- |
| [Desktop · start](qa/traversal-desktop-start.png) | Large-world entry, original D-pad |
| [Desktop · chamber](qa/traversal-desktop-chamber.png) | Camera follows into a different chamber |
| [Start viewport](qa/traversal-world-start.png) | Dense architecture; whole map is not visible |
| [Chamber viewport](qa/traversal-world-chamber.png) | Explorer beside/behind pillar |
| [Tall-wall cutaway](qa/traversal-tall-wall.png) | Correct moving foreground relationship |
| [Closed Temple](qa/traversal-closed-temple.png) | Logical threshold blocks traversal |
| [Southeast edge](qa/traversal-southeast-edge.png) | Right/bottom bounds |
| [Southwest edge](qa/traversal-southwest-edge.png) | Left/bottom bounds |
| [Northwest edge](qa/traversal-northwest-edge.png) | Left/top bounds |
| [390px mobile · edge](qa/traversal-mobile-edge.png) | Actual phone scale |
| [390px viewport crop](qa/traversal-mobile-world.png) | Scrolling world at gameplay scale |
| [Mobile · touch hold](qa/traversal-mobile-touch.png) | Controls remain reachable |
| [320×568 phone](qa/traversal-mobile-320.png) | 11×9 view; every control in viewport |
| [Mobile debug](qa/traversal-mobile-debug.png) | Logical collision/camera/player annotation |
| [Reduced motion](qa/traversal-mobile-reduced-motion.png) | Static directional gait frame, same legal moves |

Browser QA checked three sequential keyboard-held moves, exact buffered UP→RIGHT order, wall stopping, two-finger touch turn buffering, touch-held repeats, and no scrolling/selection. At 390×844 and 320×568, document width matches viewport and all controls fit. The short-phone document height is exactly 568px. Touch was emulated in Chromium; physical iOS/Android feel remains a human device check, not a claimed hardware result.

A real-input route to the southeast emitted **44 legal, sequential single-tile actions**. Across **478 camera samples (396 moving)** there were zero outside-world views; **30 moving samples** showed active foreground cutaway. The tall-wall cutaway count changed 1→0 after moving clear. Further real inputs reached southwest and northwest. The chamber foot settled at 57.5% of the view height. Reduced-motion sampling used one directional frame, zero camera target errors and the same three accepted moves. Closed-Temple verification left MOVE count 17→17 when attempting the threshold. No console warnings/errors or uncaught exceptions were observed.

## Verification and boundaries

- Final focused tests: **40/40 passed**, eight files covering map/collision/reachability, sequential hold/buffer/cancellation, camera, PNG/frame grounding, keyboard ownership and unchanged V1 behavior.
- Full `npm test -- --testTimeout=120000`: **1,116 passed / 69 skipped**, 143 passed test files. The final closed-threshold correction was followed by all affected focused tests rather than repeating unrelated suites.
- `npm run build`: passed; existing large gameplay bundle warning only.
- `npm run lint`: passed after exporting the isolated dev component for Fast Refresh.
- `npm run typecheck:server`: passed.
- `npx tsc -b --force`: passed; final build also validates the final app source.
- Production import-graph and build checks exclude the new controller, renderer/atlas references and traversal HTML from production JavaScript/routes. Static PNGs are copied through Vite's normal public-directory behavior.
- Existing 81 V2 PNG hashes and the pre-work .agent-state binary diff remain identical. Unrelated local files/videos are preserved. No V1 movement/collision, replay/proof/checkpoint, mission rules, wildlife, Reward Week, payout/reward or main changes.

[Complete bounded changed-file list](files-changed.md). The only shared production component change is the optional D-pad hold API; default callers keep existing behavior. Renderer fixes: **none**. The closed Temple collision footprint was corrected in the development map truth, independently of its rendering.

**Stop point:** traversal foundation complete. Gem Runner Stage 1 gameplay has not begun.
