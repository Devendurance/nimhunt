# Stage III — Inner Sanctuary

Isolated Gem Runner completion slice on `feat/angkor-v2-stage3`, based directly on approved Stage II commit `02e85810f26b0ae73c38ec34e2edf393f476c956`. Play with `npm run dev` at `/dev/angkor-v2-gem-runner.html`: complete Outer Ruins, Continue into Overgrown Temple, then Continue into Inner Sanctuary. The final escape completes the expedition; there is no fourth stage.

## Map and objective

The original **30×24** map is **960×768px** on the approved 32px grid. Explicit map symbols and occupied architecture cells compile separate rendering and collision layers. The approved environment, camera, alpha-aware occlusion, Explorer and 145ms cardinal traversal are reused unchanged.

| Area | Navigation and pressure |
| --- | --- |
| Sanctuary Threshold | Safe entrance, nearby Gem, vine-covered monumental boundaries. |
| Coil Gallery | Turning parallel galleries, two ordinary snakes, a giant body glimpse behind masonry. |
| Ritual Court | Branching chamber, monumental dormant guardian, pillars, rubble and optional monkey/spike pressure. The statue has no Golem gameplay. |
| Serpent Passage | Two lanes around a solid carved spine. The Anaconda emerges along the masonry, warns along a fixed lane, then temporarily coils across one bypass. |
| Anaconda Sanctum | Larger ritual chamber, six-cell solid plinth, massive serpent, horizontal strike lanes, temporary coils and final Gem cluster. |
| Escape Passage | Narrow northern approach and sealed passage. It opens only after both encounter and Gem conditions. |

Floors favor roots, moss, cracks and debris. Tall mossy/damaged masonry, integrated roots, carved guardian imagery and a restrained darker jungle shade establish the deepest temple. Blue Gems and warm danger markers remain readable. The boss plinth remains a solid architectural boundary after retreat; PNG alpha never supplies collision.

**12 Gems available / 8 required**, with separate stage and cumulative expedition counts. Coordinates are zero-based:

| Gem | Tile |
| --- | --- |
| Threshold | 4,19 |
| Coil near / far | 4,14 / 9,10 |
| Ritual / ritual risk | 4,4 / 9,4 |
| Passage west / east | 13,8 / 17,12 |
| Sanctum west / south | 21,10 / 21,16 |
| Sanctum risk / east | 27,15 / 26,11 |
| Escape | 25,4 |

## Environmental Anaconda

The encounter objective is **three resolved strikes while the player remains in an encounter area, including at least one resolved in the Sanctum**. A survived hit counts; a lethal hit does not. Waiting outside the encounter cannot progress the objective. There is no combat, enemy HP bar, chasing, pathfinding or randomness.

All timing uses recorded 150ms `TICK` actions:

- **Presence:** entering Serpent Passage or Sanctum activates once and grants eight safe ticks (1.2 seconds). A visible body section rises along the solid passage spine; reduced motion keeps it static.
- **Tell:** eight ticks (1.2 seconds), with marked tiles and countdown rings. Passage strikes use three cells along the player's column; Sanctum strikes use three cells along the player's row. Targets snapshot authoritative coordinates and exclude solid cells. They never chase the player during the tell.
- **Strike:** only a player remaining on a marked cell takes damage. The large strike pose and dust are presentation only.
- **Coil:** one authored two-cell gate blocks for twelve ticks (1.8 seconds), followed by eight recovery ticks. Passage gates alternate left/right; the Sanctum gate blocks part of its southern route. Every blocked configuration leaves all walkable floor connected.
- **Retreat:** three resolved strikes, one Sanctum resolution, and at least eight Stage Gems cause one retreat, clear every temporary block/target and unlock the Escape Passage at **25,3**. Optional ninth–twelfth Gems remain collectible.

New blocks reserve the player's logical cell **and all four adjacent cells**, protecting every possible in-flight one-tile destination without coupling the reducer to presentation. Coils release on their recorded deadline even if the player leaves the encounter. Exhaustive tests cover every subset produced by the reservation rule and prove routes to all Gems and the exit from every remaining walkable cell.

Exactly two ordinary snakes use fixed 10/8-step cardinal patrols with the existing three-tick alert and four-tick movement interval. One monkey guards the optional Ritual Court route with fixed perches, nine-tick tell, fourteen-tick recovery and snapshot target. Two small spike groups and the existing telegraphed rubble hazard provide restrained support pressure. No new hazard type beyond the Anaconda is added.

## Assets

Five original GPT Image sprites were generated from one new giant master, using the approved small snake only as an identity/style reference. No board assets were cropped or small snake sprites enlarged. Derived poses retain olive/khaki diamond scales, cream belly, amber eyes, massive coils, upper-left light and the approved 2.5D camera.

Delivery files are under `public/assets/game/angkor-v2/wildlife/anaconda/`:

| File | Source canvas | Delivery | Display | Bytes |
| --- | --- | --- | --- | --- |
| anaconda-coiled-v2.png | 1254×1254 | 512×512 | 112×112 | 385,550 |
| anaconda-rise-v2.png | 1254×1254 | 512×512 | 112×112 | 404,329 |
| anaconda-strike-v2.png | 1254×1254 | 512×512 | 112×112 | 389,954 |
| anaconda-retreat-v2.png | 1254×1254 | 512×512 | 112×112 | 390,591 |
| anaconda-body-v2.png | 1774×887 | 512×256 | 64×32 | 134,953 |

Generated source canvases remain in the Codex generated-images directory. Technical RGBA export uniformly resamples full poses and aligns their own visible silhouette to a common source ground line at y=504. Body segments use y=248; transparent margins are tested. The manifest adds source/delivery dimensions, display size, footprint, anchor, depth, collision suggestion and category. Full poses suggest a 3×2 logical footprint; the level explicitly owns the actual occupied cells. Gate presentation reveals calibrated halves of one continuous two-cell segment; halo-reserved cells stay visibly clear.

`guardian-monument-v2.png` duplicates the approved 384×384 guardian artwork, displayed at 80×96 with a declared 2×2 footprint. It is scenery, not a Golem enemy. Existing V1/V2 assets remain intact.

The first visual pass rejected the passage presentation because a strike warning could arrive before the serpent was visible. A body emergence along the central masonry corrected that. No generated pose needed artistic regeneration; delivery canvases were aligned and optimized. Human review should still assess the giant pose family, perceived scale and final-stage difficulty from damaged carry-in.

## Carry, completion and replay

`innerSanctuaryAdapter` implements the existing stage contract. Entry preserves exact HP, cumulative Gems, sword ownership and potion consumption, resets Stage Gems and creates fresh local wildlife/Anaconda/hazard state. There is no healing, revive or restored consumable.

Damage retains the earlier baseline: snake **12**, spikes **18**, monkey **20**, rubble **22**. Anaconda damage is the new explicit constant **26**. Shared six-tick (0.9-second) immunity prevents stacked impacts. HP clamps to zero and fails the expedition, retaining prior stage results; failed attempts cannot unlock, advance or complete.

The Phaser-free reducer adds serializable `ANACONDA_ACTIVATED`, `ANACONDA_TELEGRAPH`, `ANACONDA_STRIKE`, `ANACONDA_COIL_BLOCKED`, `ANACONDA_COIL_RELEASED` and `ANACONDA_RETREATED` events alongside the existing local gameplay events. Ordered `MOVE`/`TICK` actions append to the existing `angkor-v2-gem-runner/v1` envelope with each stage boundary, carry snapshot and result. No schema or production proof/checkpoint contract changed.

Entering the open Escape Passage emits `STAGE_COMPLETE` and returns a durable Stage III result. The existing runtime emits `STAGE_COMPLETED` and its canonical `EXPEDITION_COMPLETED` event, records all three results, enters terminal `COMPLETE`, and preserves exact HP/Gems/items. Further actions/Continue cannot duplicate completion. The overlay shows each stage's Gems, total Gems, HP and **GEM RUNNER COMPLETE / ANGKOR RUINS / EXPEDITION COMPLETE**, with no next-stage button.

Debug defaults off and exposes coordinates, HP, stage/expedition Gems, Anaconda phase/counters/targets/blocked cells, wildlife, rubble, logical collision/camera bounds, local events, carry/results and the expedition envelope export.

## QA and verification

The full real-input browser expedition and boss-transition proof are saved in `qa/full-expedition-envelope.json` and `qa/anaconda-proof.json`. Regression tests replay all three actual adapters, compare the complete envelope/snapshot, and separately compare every Anaconda event, final state and result. Prior Stage I/II recorded fixtures remain unchanged.

The final real keyboard/touch run finished at **76 HP / 29 expedition Gems**: Stage I **7 Gems / 100 HP**, Stage II **10 Gems / 88 HP**, Stage III **12 Gems / 76 HP**. Every boundary preserved exact carry. Both Stage III snakes and its monkey activated, rubble triggered, the Anaconda resolved three strikes (two in the Sanctum), temporary gates blocked/released, all twelve Stage Gems were collected and the final escape completed once.

The committed envelope contains **832 ordered entries / 823 stage actions**. Its complete replay reproduces all three stage results, HP, Gems, inventory, completion events and each Anaconda transition. A native Chromium touch hold moved RIGHT three times, then buffered UP while the last tile finished: **3,20 → 6,19**, with no further movement after release. Small-phone QA at **320×568** kept the bottom control at y=548, inside the viewport, with no page scroll or selection. No browser console errors or warnings were observed.

Inspected captures at actual CSS-pixel gameplay scale (**390×844 phone / 1280×900 desktop**, with the same bounded world crop):

- [Threshold](qa/mobile-threshold.png), [Ritual Court](qa/mobile-ritual-court.png), [Serpent Passage emergence](qa/mobile-serpent-passage.png)
- [Anaconda tell](qa/mobile-anaconda-tell.png), [continuous coil gate](qa/mobile-anaconda-coil.png), [retreat](qa/mobile-anaconda-retreat.png)
- [Desktop Sanctum](qa/desktop-sanctum.png)
- [Stage I transition](qa/mobile-stage1-transition.png), [Stage II transition](qa/mobile-stage2-transition.png)
- [Final completion — phone](qa/mobile-expedition-complete.png), [desktop](qa/desktop-expedition-complete.png), [320×568](qa/mobile-320-complete.png)
- [Full Gem Runner gameplay recording](qa/full-gem-runner.mp4) — 104 seconds, all three stages, touch hold/turn, boss warnings/coils and completion. Cropped from the browser recording; brief desktop viewport changes remain at screenshot moments. The raw recording is preserved outside the repository.

Verification:

- Targeted Stage I/II/III, runtime and asset/isolation tests: **61 passed**.
- Full suite: **1,170 passed / 69 skipped** (`npm test -- --testTimeout=120000`). The per-run timeout accommodates the existing slow production layout test; no global timeout or production test changed. The full suite ran once.
- `npm run build`: passed, including root compilation; the existing large-bundle warning remains.
- `npm run lint`: passed.
- `npx tsc -b`: passed.
- `npm run typecheck:server`: passed.
- Production import-graph guards exclude the new model, scene and adapter.

**GEM_RUNNER_V2: READY_FOR_HUMAN_PLAYTEST.** Human review should assess Anaconda art/scale and difficulty with lower HP carry. This is not approval for production integration.

## Scope

New code: `src/game/stage3/{level,model,model.test,Stage3Scene}.ts` and `src/game/gemRunner/innerSanctuaryAdapter.ts`. Updated code: isolated dev expedition entry/CSS and V2 manifest/tests. Added art/report/QA artifacts are the remaining changes.

Stage I/II reducers/maps, approved traversal/rendering helpers, production `/play`, replay/proof/checkpoints, rewards/claims/payouts, Reward Week, V1, P7 and main are untouched. No Golem, Chest Hunter or Vault Breaker gameplay is included. Unrelated `.agent-state` and videos remain preserved. Stop after Gem Runner; production integration requires a separate human-approved slice.
