# Chest Hunter — Forgotten Galleries

Ready for human playtest. Isolated Stage I → Stage II → Stage III contract. Royal Treasury is not built. No production integration or merge.

Base: `7f6c0e033911092db28875b773188ae7f096e130`.
Branch: `feat/angkor-v2-chest-hunter-stage2`.

## Play

Run `npm run dev -- --port 5174`; open `/dev/angkor-v2-chest-hunter.html`.
Start fresh expedition, complete Lost Courtyard, then Continue deeper into Forgotten Galleries. Hold arrows/WASD or the existing directional pad. Walk onto treasure to open it. Debug is off by default. Reset expedition creates a new attempt; it does not revive or rewind the active stage.

At Stage II completion, Continue enters `royal-treasury` with `READY_FOR_STAGE_3 / NOT BUILT YET`. No map, gameplay adapter or actions exist for that stage.

## Runtime and carry

Phaser-free contracts/model/runtime live under `src/game/chestHunter/`; stage-owned reducers retain ordered MOVE/TICK actions. The runtime attaches only the current canonical adapter, validates progress/results, records boundaries and advances one stage per Continue. Status is PLAYING, TRANSITION, COMPLETE or FAILED. Failure at zero HP freezes advancement and preserves completed results.

Carry is an explicit whitelist: exact HP, cumulative opened-chest count, cumulative chest-loot Gems, sword boolean and potion ownership/consumption. Stage counts reset to zero. Keys, gates, pressure state, stones, wildlife, immunity and hazard state are local. There is no boundary heal. Stage I's only changes are optional carry-in and a reducer injection hook; its fresh initial state, level, mechanics and original recorded replay remain identical.

Potion loot retains immediate Stage I use: heal up to 25 HP, clamp at 100, mark owned/consumed. A newly found potion can heal; the old consumed item is never restored. Opening the sword chest with a carried sword preserves `true`, counts the chest once and emits `swordAlreadyOwned: true`; there is no invented bonus or duplicate item.

## Stage II world

32×24 logical tiles, 1024×768 world. Approved 32px grid, 145ms movement, held direction/buffer, bounded camera and alpha-aware occlusion are reused unchanged. Static map truth compiles separate visual/collision geometry; closed gates and stones add stage-local logical restrictions. Authority never reads image alpha.

| Area | Purpose |
|---|---|
| Descent Hall | Safe entry; treasure visible over a low divider but gated from the east |
| Twin Archives | Silver Key opens the western room; its rear breach reaches the eastern room |
| Pressure Gallery | Three-position guided stone, boulder-only plate, carved pillars and blade cache |
| Serpent Stacks | Two authored patrol zones split by a low divider; safe approach around the lanes |
| Plunder Hall | Two treasure alcoves, fixed monkey perches, one small spike section |
| Sealed Treasury Passage | Exit opens at five chests; optional treasure remains available |

Floors emphasize weathered, mossy, root-damaged and cracked variants. Enclosed galleries, tall partitions, repeated pillars and climbing roots define access. Small 4px discovery glints last 170ms every 5.2s with staggered chest offsets. They are presentation-only, depth-sorted at chest contact Y, and disabled for reduced motion.

## Eight authored chests

Coordinates are zero-based logical cells. Required: **5 of 8**.

| ID | Cell | Fixed result |
|---|---|---|
| descent-cache | 7,18 | GEMS +2; pressure gate grants access |
| archive-west | 4,3 | POTION; Silver Key gate |
| archive-east | 9,3 | EMPTY; rear breach from western archive |
| stack-trap | 9,11 | TRAP, 18 damage subject to shared immunity |
| stack-cache | 3,11 | GEMS +2 |
| plate-cache | 20,11 | SWORD; idempotent if already held |
| plunder-low | 27,12 | GEMS +2 |
| plunder-high | 27,4 | POTION |

Every chest resolves once. Optional sixth through eighth remain available after unlock. Stage II contributes six Gems if all treasure is opened.

## Key and pressure access

Silver Archive Key: 12,7. Permanent gate: 4,5. Pickup occurs once; entry consumes the key and permanently opens that gate. Both archive chests are inaccessible before the unlock. No key carries forward.

Weight plate: 18,13; linked Descent cache gate: 9,20. Stone starts at 18,12 and moves vertically only among 18,12 / 18,13 / 18,14. Visible guide grooves and end stops communicate its constrained motion. Boulder on plate opens the gate; leaving closes it. Player weight alone has no effect. Activation/release and gate open/close each emit explicit ordered events.

All three legal stone positions can be restored to the plate using accessible opposing push cells at 18,11 and 18,15. Tests solve every chest and the exit from all positions, plus from inside the legally open cache. A single player cannot simultaneously occupy the remote cache and push the stone off its plate, so closing cannot trap the player inside. No diagonal, off-guide, solid, chest, stone or snake-lane pushes are allowed. Neither gate infers state from rendering.

## Wildlife and damage

Exactly two snakes. West route: (4,12),(5,12),(5,13),(4,13). East route: (8,12),(9,12),(10,12),(10,13),(9,13),(8,13). Authored activation zones, three-tick alert, then one fixed patrol step every four ticks. No random behavior or pathfinding.

Exactly one monkey. Perches: 27,2 and 28,9; zone x24–29/y3–13. Targets the authoritative player cell, tells for eight ticks (1.2s), impacts that cell, recovers ten ticks (1.5s), then advances its fixed perch. Moving away avoids damage. No stealing or chasing.

One spike group: 24,11 and 25,11. Existing damage constants remain snake 12, monkey 20, spikes 18, chest trap 18. Shared six-tick immunity (900ms). Simulation tick is 150ms; recorded explicit TICK order owns all outcomes. Presentation time owns only glints, tweens and camera.

## Transcript and evidence

Envelope: `angkor-v2-chest-hunter/v1`. It stores fresh start, canonical stage start/carry, ordered stage actions with indices, completed result/carry-out, and Continue boundaries. Replay runs real adapters and checks every generated boundary and final snapshot. Royal Treasury has only its start boundary.

[Real-input mobile envelope](qa/chest-hunter-expedition-replay.json) is covered by a permanent replay test. It reproduces both local worlds, chest states, key/gates, three plate pushes, activation/release/reactivation, wildlife, damage, items, completed results and final cumulative state.

Recorded run: Stage I 6/6 chests, 4 Gems, 82 HP → Stage II entry exactly 82 HP / 0 stage chests / 6 expedition chests / 4 Gems. Stage II 8/8, final 100 HP, total 14 chests / 10 Gems. Stage II trap dealt 18; its two potion chests supplied the healing. Fifth chest unlocked the exit before the last three optional chests. Both snakes patrolled and monkey telegraphs/impacts occurred; the player dodged its rocks.

- [Full two-stage recording](qa/full-expedition.mp4): 100 seconds, 390×844, chronological real touch/keyboard input, no state injection; only startup/end idle trimmed, no internal cuts. Silent capture; live synthesized effects remain available through Sound.
- [Mobile entry/carry](qa/mobile-descent-hall.png)
- [Mobile archives](qa/mobile-twin-archives.png)
- [Mobile plate held](qa/mobile-pressure-active.png), [released](qa/mobile-pressure-released.png)
- [Mobile monkey tell](qa/mobile-monkey-gallery.png)
- [Stage II completion](qa/mobile-stage2-transition.png)
- [Royal Treasury contract](qa/mobile-ready-for-stage3.png)
- [Desktop pressure gallery](qa/desktop-pressure-gallery.png), [archives](qa/desktop-twin-archives.png)

All screenshots use the live standalone assets. Mobile page: 390×844; desktop: 1440×900. Both retain an approximately 12×10-tile gameplay viewport rather than revealing the map.

## New art

Only two assets generated with GPT Image, using existing approved bronze-key/floor assets as references. No reference-board crop or unrelated regeneration.

| Asset | Source | Display | PNG bytes | Anchor |
|---|---|---|---:|---|
| silver-archive-key-v2 | 256×256 RGBA | 18×24 | 62,533 | .5,248/256 |
| pressure-plate-v2 | 256×256 RGBA | 30×30 | 134,900 | .5,248/256 |

Silver Key prompt: original tarnished silver archive key, chunky arched head/three grooves/teeth, approved painterly 2.5D camera and upper-left light, transparent modular game prop. Source generation `exec-fd6b46b1-29c0-44bf-a4b8-33ac104c8bf6.png`.

Plate prompt: square-grid overhead sandstone rim and inset bronze weight slab, four rivets, three pressure grooves, shallow south bevel/contact shadow, approved moss/weathering/light, transparent outside frame, no boulder or UI. Source generation `exec-76915a6f-de72-41ff-bd6f-6e3218544920.png`.

Generated source canvases were 1254×1254. Technical export trimmed their transparent margins, resampled the entire standalone asset and padded to the common 256px canvas/contact anchor. No art was extracted from the approved board. Manifest now contains 102 assets, 40 production records. Gate/chest state-swap assets are reused unchanged. No rejected/regenerated assets were needed in this slice.

## Verification

- Targeted Chest Hunter, manifest, environment, traversal and generic Gem Runner contracts/runtime: **80 tests pass** across 11 files.
- Full `npm test -- --testTimeout=120000`: **1,211 pass, 69 skipped**, 151 passing/5 skipped files.
- `npm run lint`: pass.
- `npm run build`: pass (existing large-chunk warning only).
- `npx tsc -b`: pass.
- `npm run typecheck:server`: pass.
- Production import-graph test excludes both Chest Hunter stages, runtime and dev page. Protected-path diff is empty for Gem Runner/Anaconda, approved renderer/traversal, production scenes/server/main/App.

Changed scope: own Chest Hunter contracts/model/runtime/adapters/tests; new Stage II level/reducer/scene/tests/test-only solver; minimal Stage I carry/reducer hooks; existing Chest Hunter dev entry/CSS/HTML; two assets and manifest/test; this report and QA evidence. Unrelated `.agent-state` files and `videos/` are preserved and excluded from the commit.

Human playtest should assess treasure discovery, the clarity of the remote plate/cache link, patrol timing, mobile pressure and potion placement. Technical/visual QA passed; human approval is still the next step. **CHEST_HUNTER_STAGE_2 READY_FOR_HUMAN_PLAYTEST.**
