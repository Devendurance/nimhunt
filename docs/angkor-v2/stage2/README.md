# Stage II — Overgrown Temple

**READY_FOR_HUMAN_PLAYTEST.** Branch `feat/angkor-v2-stage2`, based directly on approved runtime commit `7ea4bb2000728598209bf8365847c1898288f8ff`. This is isolated development gameplay. Stage III remains a definition/contract screen; no Inner Sanctuary, Anaconda or Golem gameplay is included.

Play with `npm run dev` at `/dev/angkor-v2-gem-runner.html`. Start and complete Outer Ruins, then Continue deeper to enter the real Stage II scene. Debug starts off. Keyboard arrows/WASD and the existing held-input Dpad control the approved 145ms, cardinal, one-cell traversal.

## Map and objective

The authored **30×24** logical map is **960×768px**, with closed boundaries and six connected areas. The approved environment compiler derives separate collision and rendering layers from explicit map symbols. No PNG alpha grants walkability. Camera, Explorer anchoring, wall height, depth sorting and occlusion reuse the approved helpers unchanged.

| Area | Navigation and pressure |
| --- | --- |
| Vine Hall | Safe entry, one nearby Gem, tight vine-covered entrance and turning connector. |
| Serpent Gallery | Two narrow parallel galleries joined at their ends; two overlapping snake zones and a far Gem across the patrol lanes. |
| Sunken Court | Small branching chamber, guardian/broken pillars, a safer upper route and a spike-lined optional Gem route. |
| Boulder Cloister | Broken entrance, two required stone slides, then a third slide opening an optional alcove. |
| Monkey Gallery | Two separate perch sets, overlapping middle pressure, low masonry and a side spike. |
| Inner Seal | Narrow northern approach, fractured ceiling/rubble warning, final Gem and sealed passage. |

The floor mix favors moss/root damage; taller mossy/damaged masonry defines most sightlines. Foreground vines climb and wrap architecture, and a restrained jungle shade layer dims the world without altering simulation or collision. All art is reused from the approved V2 kit; there are no new asset families or renderer changes.

**10 available Gems / 7 required.** Coordinates are zero-based:

| Gem | Tile |
| --- | --- |
| Vine | 4,19 |
| Serpent near | 4,14 |
| Serpent far | 9,9 |
| Court | 4,4 |
| Court risk | 9,4 |
| Cloister | 15,11 |
| Cloister east | 18,12 |
| Cloister pocket | 18,8 |
| Monkey | 24,13 |
| Seal | 25,4 |

The exit at **25,3** is blocked below seven Stage Gems, unlocks exactly once at seven, and stays open while the optional eighth–tenth Gems remain collectible.

## Deterministic encounters

Three snakes start dormant, activate in authored zones, warn for three simulation ticks, then follow fixed cardinal routes every four ticks. West/east serpents share pressure across the gallery; their routes have 12 and 10 authored steps. The court serpent has six steps. No chasing, pathfinding or RNG is used. Contact retains Stage I's 12 damage; coiled/alert/slither/strike assets provide presentation.

Two monkeys use separate fixed perch lists. Both target the player's tile at the start of the tell, never retarget during it, and damage only if the player stays there on impact. North/south tells are eight/nine ticks (1.2/1.35 seconds), with 12/14 ticks of recovery and deterministic perch progression. Their zones partially overlap. Stage I's shared six-tick damage immunity also prevents overlapping impacts from stacking unfairly. Monkey damage remains 20.

Falling rubble is the only new hazard type. Entering the explicit Inner Seal trigger zone marks tiles **24,5 and 25,5**, warns for eight ticks, then applies **22 damage** if the player remains on either tile. Rocks and dust are visual only. Recovery lasts 16 ticks; it rearms only after the player leaves the trigger zone, so standing there cannot create repeated unannounced falls. Spikes retain Stage I's 18 damage. No global rebalance was made.

All timing uses recorded **TICK** actions at the existing 150ms simulation cadence. MOVE commits on tile arrival; suspension pauses simulation. No wall-clock-dependent outcomes enter the pure reducer. Reduced motion preserves logical timing and suppresses optional movement effects.

## Boulder safety

Three meaningful stones have visible one-cell tracks and parking recesses:

- First: **13,12 → 13,13**, pushed down from the western alcove; opens progress.
- Second: **16,12 → 16,13**, pushed down after reaching its northern alcove; opens the eastward connector.
- Optional: **18,9 → 19,9**, pushed right to open the Gem pocket.

Only the authored push direction from the initial cell into the empty recess is legal. A parked stone cannot move back into a lane, cover a Gem or pass a solid/other entity. The required route is never permanently softlocked. Tests exhaust every reachable player/stone arrangement, find exactly four reachable stone configurations, and prove each still has a legal route to the final approach.

## Runtime, carry and replay

`overgrownTempleAdapter` implements the existing generic stage contract. Entry preserves exact HP, cumulative expedition Gems and carried sword/potion consumption, resets Stage Gems/local entities, and creates no Stage I wildlife or puzzle objects. No automatic heal or restored item is granted.

The Stage II reducer and event state are Phaser-free. Explicit events include MOVE, GEM_COLLECTED, DAMAGE, SNAKE_ACTIVATED/MOVED, MONKEY_ATTACK_TELEGRAPH/ROCK_IMPACT, BOULDER_PUSH, RUBBLE_TELEGRAPH/IMPACT, EXIT_UNLOCKED and STAGE_COMPLETE. Stage actions append to the existing `angkor-v2-gem-runner/v1` envelope without changing its schema or any production replay/proof/checkpoint contract.

Entering the open seal returns a durable result and puts the expedition in TRANSITION. The overlay shows Stage II Gems, cumulative Gems, exact remaining HP and Stage III next. Continue advances to **STAGE III — INNER SANCTUARY / READY_FOR_STAGE_3 / NOT BUILT YET**, resets Stage Gems and destroys the Stage II scene. HP zero fails the attempt and blocks advancement while retaining Stage I's result. Completion cannot be applied twice.

Debug exposes stage/coordinate/HP/Gems, all wildlife, rubble and boulder state, stage event log, expedition events/results/carry, logical collision and camera bounds. It offers the existing envelope export, with no retry/revive control.

## Browser evidence

A real keyboard expedition completed Stage I (6 Gems, 100 HP), continued into Stage II, collected all 10 Gems, activated all three snakes, exercised both monkeys, pushed all three stones, took rubble damage and completed at **48 HP / 16 expedition Gems**. Continue preserved those exact totals at Stage III and reset Stage Gems to zero, with no canvas or fake room.

`qa/expedition-playthrough.json` contains **1,538 ordered entries / 1,530 stage actions**, including both boundaries and carry snapshots. The regression test replays it through both real adapters, reproduces the entire envelope/snapshot, and checks every encounter. A final visual pass after the shade/vine refinement also completed at 48 HP with all ten Gems.

Inspected screenshots use actual CSS-pixel gameplay scale (390×844 phone / 1280×900 desktop; desktop retains a bounded phone-like world crop):

- [Vine Hall](qa/mobile-vine-hall.png)
- [Boulder Cloister — mobile](qa/mobile-boulder-cloister.png) / [desktop](qa/desktop-boulder-cloister.png)
- [Rubble tell](qa/mobile-rubble-tell.png)
- [Stage II completion](qa/mobile-stage2-transition.png)
- [Stage III contract — mobile](qa/mobile-stage3-contract.png) / [desktop](qa/desktop-stage3-contract.png)
- [90-second gameplay recording](qa/stage2-gameplay.mp4) — cropped from the browser recording; includes exploration, puzzle pushes, wildlife pressure, rubble and completion.

## Verification and scope

- Targeted Stage II + Stage I + runtime + asset isolation tests: **46 passed** (14 Stage II tests).
- `npm test`: **1,154 passed / 69 skipped**, with one unchanged production daily-layout test hitting its existing **15-second timeout** under full-suite load. The single failed test passed when rerun with `--testTimeout=120000` (22.9-second isolated run). No production test or global timeout setting was modified, and the full suite was not repeatedly rerun.
- `npm run build`: passed, including root compilation; existing large-bundle warning remains.
- `npm run lint`: passed.
- `npx tsc -b`: passed.
- `npm run typecheck:server`: passed.
- Import-graph guards explicitly exclude the Stage II model, scene and adapter from production.

Changed code: added `src/game/stage2/{level,model,model.test,Stage2Scene}.ts` and `src/game/gemRunner/overgrownTempleAdapter.ts`; upgraded `src/dev/gemRunnerExpedition.tsx`; extended the existing asset production-isolation test. This report and QA artifacts are the remaining additions.

Stage I logic/maps/assets, traversal/rendering helpers, production `/play`, proof/checkpoint contracts, rewards/claims/payouts, V1 and main are untouched. Existing `.agent-state` and videos are preserved. Human playtest should assess difficulty from damaged Stage I carry and the denser sightlines. Stop here; Inner Sanctuary is not built.
