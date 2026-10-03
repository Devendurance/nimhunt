# Angkor V2 Chest Hunter — Stage III: Royal Treasury

Bounded isolated/dev slice on `feat/angkor-v2-chest-hunter-stage3`, from approved Stage II `b3f607808ded736711bbddc0ed1c0535954fad7a`. Completes Lost Courtyard → Forgotten Galleries → Royal Treasury → Chest Hunter Complete. No merge or production integration.

## Play

Run `npm run dev -- --port 5174`, open `/dev/angkor-v2-chest-hunter.html`, Start fresh expedition. Arrow keys/WASD or existing mobile D-pad; hold repeats sequential moves, buffered turns remain supported. Walk onto a chest to open it. Debug defaults OFF; its state, collision and event log include both plates, darts, keys/gates, wildlife, carry and all stage results. Reset starts a fresh entire expedition.

Movement remains 145ms/cardinal tile. Rendering/camera/depth/occlusion are reused unchanged. Viewport remains approximately 12×10 tiles on desktop/mobile; the 32×26 world is not revealed at once. Stage-local simulation uses explicit 150ms TICK actions; MOVE commits at logical arrival. Tweens, discovery glints, camera and dart flight interpolation are presentation only.

## Six areas / geometry

32×26 logical cells, 1,024×832 world pixels. Spawn (3,23), final exit (12,17).

| Area | Bounds (x,y,w,h) | Access/identity |
|---|---|---|
| Treasury Approach | 2,21,14,4 | Monumental entry; ordinary treasure and Royal Cache visible across low masonry, initially inaccessible |
| Gilded Archives | 2,2,11,7 | Carved alcoves and root-broken partitions; route around their ends for the Royal Seal Key |
| Twin Seal Hall | 17,17,7,8 | Key-controlled entry, two separate guided stone tracks, distant vault link |
| Guardian Corridor | 2,10,7,8 | Orthogonal authored dart lanes; adjacent safe recesses |
| Plunder Chambers | 19,2,11,12 | Connected treasure pockets, sightline breaks, one snake and one monkey |
| Royal Vault | 7,15,8,6 | Enclosed carved boundary, one dual-pressure entrance, special cache and escape doorway |

Logical walls/solids, low walls and tall architectural cells derive from explicit authored map truth via the approved map compiler. Collision does not come from asset pixels. Key entrance (15,23) and vault entrance (10,21) have no alternate bypass; tests flood the map with each entry blocked. Root/foliage/broken-statue decor and a restrained Stage-III-only shadow tint give deeper sandstone/treasury atmosphere without a new art style.

## Ten fixed chests

Six opened chests AND Royal Cache are required. Opening any chest is once-only and deterministic. Optional treasure remains available until entering the exit.

| ID | Cell | Loot |
|---|---|---|
| approach-cache | 4,19 | GEMS +2 |
| archive-heal | 4,3 | POTION |
| archive-dust | 6,6 | EMPTY |
| plunder-trap | 25,11 | TRAP, 18 damage |
| archive-far | 12,3 | GEMS +2 |
| twin-blade | 20,18 | SWORD |
| plunder-high | 27,4 | GEMS +2 |
| vault-heal | 12,20 | POTION |
| guardian-cache | 7,12 | EMPTY |
| royal-cache | 10,19 | GEMS +2, Royal Cache secured |

Exactly one trapped chest follows the explicit Plunder requirement; the ninth suggested ordinary trap is authored EMPTY instead. Existing isolated loot semantics remain: Gems +2, potion immediately heals up to25/clamped100 and records owned/consumed, sword sets ownership. Already-owned sword has no duplicate or bonus. No random loot or new production loot type.

Royal Cache uses the same domain GEMS semantics and chest footprint. Only its closed/open art, restrained glint and secured notice are special. Count alone cannot unlock; Cache alone below six cannot unlock. `ROYAL_CACHE_OPENED` precedes `EXIT_UNLOCKED` once both requirements hold. It stays secured while collecting optional chests.

## Royal Seal / twin pressure puzzle

Stage-local Royal Seal Key at (10,3), picked up once, consumed by the one permanent seal door at (15,23). Key state is excluded from carry and final result.

- Stone A: x18, initial y20, legal y20–22; its plate (18,21).
- Stone B: x21, initial y20, legal y20–22; its plate (21,21).
- Control positions y19/y23 are reachable. Visible guide grooves/end stops explain one-tile vertical pushes; sideways/off-track pushes are illegal.
- Royal Vault gate (10,21) opens iff **both matching authored stones** occupy their plates. Player or wrong stone does not substitute.
- Moving either stone off its plate emits independent release and closes the gate. Restoring it reopens the gate.

All nine possible legal track configurations are tested using actual reducer moves: each recovers both seals, reaches every chest and completes the final exit. Gate bypass tests and constrained tracks prevent permanent mandatory softlocks. This slice introduces no Sokoban framework.

## Dart Guardians / wildlife / damage

Two statue emitters implement one new defense mechanic. West guardian (2,12) shoots horizontally through x3–7/y12 when the player enters x3–7/y11–13. North guardian (6,10) shoots vertically through x6/y11–16 when the player enters x5–7/y13–15.

Each snapshots its fixed authored lane: eight warning ticks (1.2s), two flight ticks (300ms), impact, sixteen recovery ticks (2.4s). Amber tile warnings and subtle eyes precede a small dart rendered with Phaser graphics; existing dust supplies impact. No extra projectile raster needed. Damage only when the logical player cell is in that lane at impact, not a moving-target chase. Each trigger zone has legal floor outside the union of both lanes; safe recesses include (4,14)/(5,13).

Exactly one ordinary snake: plunder-serpent, activation x21–26/y6–9, path (23,7),(24,7),(24,8),(23,8). Existing three-tick alert, four-tick authored patrol steps, no pathfinding.

Exactly one monkey: activation x24–29/y3–12, fixed perches (27,2)/(28,9). Targets a logical cell at tell, eight ticks to impact, ten recovery ticks, then authored perch progression. No stealing/chasing/random targeting.

Damage: darts16, snake12, monkey20, trapped chest18. Existing six-tick/900ms immunity. No spike group, new healing rule or Stage I/II balance changes.

## Carry / expedition / replay

Royal Treasury starts from exact Stage II HP, cumulative chests/Gems and copied sword/potion state. No automatic boundary healing. Local chest count, chests, key/gate, plates, stones, darts, snake and monkey initialize fresh.

The existing generic Chest Hunter runtime attaches `royalTreasuryAdapter`. Final Stage III result contains its ten opened IDs, local count, cumulative counts/Gems, exact remaining HP, items and completion tick/action count. Local mechanics stay local. Royal Cache is additionally required when validating a final runtime result. Zero HP fails the expedition; terminal state cannot advance or complete twice. No Stage IV.

The existing `angkor-v2-chest-hunter/v1` isolated envelope is reused unchanged: start/carry, ordered stage actions, stage results/carry-out and Continue boundaries. Final Stage III completion derives one `EXPEDITION_COMPLETED` lifecycle event and COMPLETE snapshot. Production transcripts/proof/checkpoint/claim contracts are unchanged.

Explicit local events include MOVE, CHEST_OPENED/LOOT_RESOLVED, DAMAGE, KEY_COLLECTED/GATE_UNLOCKED, BOULDER_PUSH, each plate's ACTIVATED/RELEASED, ROYAL_VAULT_GATE_OPENED/CLOSED, DART_GUARDIAN_TELEGRAPH/IMPACT, SNAKE_ACTIVATED/MOVED, MONKEY_ATTACK_TELEGRAPH/ROCK_IMPACT, ROYAL_CACHE_OPENED, EXIT_UNLOCKED, STAGE_COMPLETE. No Math.random or wall-clock outcome authority.

[Full real-input replay envelope](qa/chest-hunter-full-expedition-replay.json): 1,732 ordered entries. A permanent test replays it twice through all real adapters, compares both complete envelopes and all three local states, and asserts plate release/reactivation, six Stage III pushes, darts, wildlife, Cache, optional treasure and unique completion.

Recorded run:
- Stage I: 6/6, 4 Gems, 82 HP.
- Stage II receives exactly82 HP; ends 8/8, cumulative14 chests/10 Gems, 100 HP from its potion loot.
- Stage III receives exactly100 HP/14 chests/10 Gems, stage count0. All10 opened, four Gem chests +8; both seals activated/released/restored. Six ordinary chests did NOT unlock the passage; the eighth chest (Royal Cache) unlocked it, then two optional chests opened.
- Final: COMPLETE, all3 durable stage results, 24 chests/18 Gems/100 HP, sword owned and potion owned/consumed. Healing is chest loot, never a stage boundary.

## Assets

Only three original GPT Image assets added; no reference-board crop, unrelated regeneration or asset replacement. Existing ordinary chests/gates/plates/statues/effects are reused.

| Asset | PNG source | Gameplay display | Anchor | Bytes |
|---|---|---|---|---:|
| royal-cache-closed-v2 | 512×512 RGBA | 36×40 | .5,500/512 | 309,056 |
| royal-cache-open-v2 | 512×512 RGBA | 36×40 | .5,500/512 | 379,919 |
| royal-seal-key-v2 | 256×256 RGBA | 18×24 | .5,248/256 | 62,099 |

Cache pair shares identical canvas, footprint1×1, display and contact anchor. Open pose was an edit of the generated closed chest preserving the lower box/feet, adding the raised lid into reserved transparent space. Both full1254px canvases resampled together to512 with the same technical translation; no object recrop/state movement. The key uses a256px padded standalone export. Manifest records all metadata and category/depth; now105 assets /43 production records. Pair alpha-contact alignment is tested. No rejected/regenerated poses were needed.

Source generation files (outside repo): `exec-e82753ba-3d9b-4100-bc0a-26d90213cf1e.png` closed, `exec-36f9ee6e-7f76-4836-9353-d720e6afd863.png` open, `exec-18c82a81-5ef8-4ed0-9ceb-0cf68733fa72.png` key.

Art prompts used approved existing chest/key references: original carved wooden treasury chest with restrained weathered gold fittings, teal patina/moss, square-grid 2.5D upper-left light, transparent canvas; open edit preserves the exact grounded lower box and reveals small blue treasure; Royal Seal Key uses an engraved regal seal head, aged warm bronze/gold with restrained patina and chunky mobile-readable teeth. No text/UI/photorealism.

## Visual / input evidence

[Full Chest Hunter recording](qa/full-expedition.mp4): 218s,390×844, silent capture, chronological real keyboard/touch inputs; startup/end idle only trimmed, no internal cuts or authority injection. Includes Stage I/II transitions, full Royal Treasury puzzle, all treasure, and final overlay. Last encoded frame inspected to confirm completion. Live Sound remains available.

- [Treasury Approach / inaccessible treasure](qa/mobile-treasury-approach.png)
- [Guardian tell](qa/mobile-guardian-tell.png), [dart flight](qa/mobile-guardian-flight.png)
- [Royal Seal Key](qa/mobile-royal-seal-key.png)
- [Twin Hall](qa/mobile-twin-seal-hall.png), [one seal](qa/mobile-one-seal-held.png), [both seals](qa/mobile-both-seals-held.png), [released seal](qa/mobile-seal-released.png)
- [Royal Cache closed](qa/mobile-royal-cache-closed.png), [open + exit unlocked](qa/mobile-royal-cache-open.png)
- [Optional treasure after unlock](qa/mobile-optional-plunder.png)
- [Stage I transition](qa/mobile-stage1-transition.png), [Stage II transition](qa/mobile-stage2-transition.png)
- [Mobile final expedition](qa/mobile-expedition-complete.png), [desktop final expedition](qa/desktop-expedition-complete.png)

Mobile screenshots390×844; desktop1440×900. Inspected composed rooms, Cache state swap, floor grounding, player readability and final overlay. Real touch hold and buffered direction input exercised. Browser console had no errors. Debug remained off for gameplay/screenshots; enabled only to export the envelope, then restored off.

## Verification

- Targeted Chest Hunter, manifest, approved environment/traversal and generic Gem Runner contracts/runtime: **94 pass,12 files**.
- Full `npm test -- --testTimeout=120000`: **1,225 pass,69 existing skips;152 passing/5 skipped files**.
- `npm run lint`: pass; corrected test fixture also independently linted.
- `npm run build`: pass (existing large-chunk warning only).
- `npx tsc -b`: pass.
- `npm run typecheck:server`: pass.

Initial build found a duplicate `id` spread in a test fixture. Fixed the fixture to provide explicit x/y so the wrong-stone check is meaningful; all11 Stage III tests pass afterward. No gameplay behavior changed and no repeated full verification loop was needed.

Changed scope: new Stage III level/model/scene/tests/test-only solver; own Chest Hunter adapter/contracts/result validation/runtime tests; existing Chest Hunter dev entry;3 assets/manifest+tests; this report and QA evidence. Stage I/II gameplay files, Gem Runner/Anaconda, renderer/traversal, V1, production routes/server/proof/economics are unchanged. Unrelated .agent-state/videos are preserved and excluded.

Human playtest remains the next approval step: assess treasure visibility/access reasoning, dual-seal link clarity, guardian warning readability, mobile routing and potion placement. **CHEST_HUNTER_V2 READY_FOR_HUMAN_PLAYTEST** Technical and visual QA passed; human approval remains next.
