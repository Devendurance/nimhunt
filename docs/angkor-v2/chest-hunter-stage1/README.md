# Chest Hunter V2 — Stage I / Lost Courtyard

Isolated dev slice based on approved `91fb118d29fb27278d31932e613cd61e2f15939e`. Branch: `feat/angkor-v2-chest-hunter-stage1`. Gem Runner, the Anaconda, V1, production /play, proof/checkpoints and reward systems are unchanged. Stage II is a named placeholder only.

## Playtest

Run `npm run dev -- --port 5174`, then open `/dev/angkor-v2-chest-hunter.html`.

Walk onto a chest to open it. Hold the existing D-pad or arrows/WASD; a pressed turn can buffer during the 145ms move. Reset is available throughout. Debug is off by default and shows logical collision/camera bounds, coordinates, HP, chest state, key/gate, boulders, wildlife and events; Export local replay downloads explicit actions and the result.

The 30×24 square-grid world is 960×768px. The camera retains the approved bounded, smoothed 384×320 viewport on phones and desktop (352px narrow-screen width / 288px short-screen height), fixed zoom and 57.5% vertical follow anchor. Rendering geometry and solid cells derive separately from explicit map symbols. The bronze gate and stone guide rails have additional logical rules, never alpha-derived collision.

## Areas and authored treasure

Coordinates below are zero-based logical cells. Six connected architectural spaces use narrow bends, ruined openings, low sightline walls, integrated roots and two treasure pockets.

| Area | Chest ID / cell | Fixed loot | Access |
| --- | --- | --- | --- |
| Arrival Court | arrival / (7,19) | GEMS: +2 | Safe first treasure; no immediate enemy |
| Vine Arcade | arcade / (7,10) | POTION: heal up to 25 HP | Visible over a low divider; route around its south end |
| Collapsed Archive | archive / (10,3) | EMPTY | Bronze key at (4,3); enter gate (9,5) to consume it and unlock permanently |
| Boulder Store | store / (15,4) | TRAP: 18 HP | Push stone from (15,5) right into its horizontal groove |
| Monkey Treasury | treasury / (25,14) | GEMS: +2 | Open under authored monkey pressure; optional once four others are open |
| Boulder Store, optional pocket | store-bonus / (19,6) | SWORD | Slide stone at (19,7) left from (20,7); sword is carry only, no new combat |

Six chests exist, any four unlock the Lower Vault Passage at (17,18). The archive is a genuine side room with one gated entrance; its key is not required to navigate the main connector. The optional fifth/sixth stay available after unlock. Passage entry, rather than chest count alone, completes the stage.

V1 inspection: `systems/chests.ts` already auto-opens on destination entry, resolves fixed GEMS/POTION/SWORD/TRAP/EMPTY loot, adds exactly two Gems and heals up to 25 HP immediately. This slice reuses its placement/instance types, `createChestStates`, `getChestAt` and Gems/heal constants. It deliberately does not call `openChest`, which also applies V1 automatic mission completion and 30 HP trap damage; those production semantics remain unchanged. The isolated trap uses the requested 18 HP. Potion ownership and consumption are recorded; consumed loot is not restored. Sword ownership carries without inventing attacks.

## Puzzles, pressure and HP

Two logical stones move one cardinal tile per push, only along carved grooves: main stone x=15..18 at y=5; optional stone x=18..20 at y=7. Solids, other stones, chests and snake patrol cells reject pushes. All 4×3 allowed configurations are tested: both pockets, all six chests and the exit remain reachable. No reset is needed to repair a puzzle.

Exactly one snake activates in the arcade zone, warns for three 150ms ticks, then steps around a four-cell authored loop every four ticks. Exactly one monkey alternates two fixed masonry perches; it locks the player's tile at tell, impacts after eight ticks, then recovers for ten ticks. Moving away dodges it. There is no pathfinding, randomness, theft or chasing.

Fresh HP is 100. Snake contact is 12, monkey rock 20, spikes 18 and trapped chest 18. Damage shares six explicit ticks of immunity (900ms); potion loot restores at most 25 up to 100. The one spike group occupies (24,12)/(25,12). Zero HP is terminal failure and produces no completion result.

## Domain / replay / result

`src/game/chestHunter/stage1/model.ts` is Phaser-free. MOVE and TICK are ordered local authority; RESET recreates the exact fresh state. State contains stage/expedition chest counts, fixed chest states, HP/immunity, Gems, carried sword/potion, local key/gate, stones and authored wildlife. Events are serializable sequence/tick-tagged MOVE, CHEST_OPENED, CHEST_LOOT_RESOLVED, DAMAGE, KEY_COLLECTED, GATE_UNLOCKED, SNAKE_ACTIVATED/MOVED, MONKEY_ATTACK_TELEGRAPH/ROCK_IMPACT, BOULDER_PUSH, EXIT_UNLOCKED and STAGE_COMPLETE.

The `angkor-chest-hunter-stage1/v1` envelope preserves stage ID, ordered actions and durable result. Result includes stage ID, stage/expedition chests, exact HP, expedition Gems, copied carried items, opened IDs and completion tick/action count. Keys, gate, stones and wildlife never enter carry. This envelope does not alter production transcripts or proof contracts.

Phaser only presents the approved environment/traversal/player classes and state events. MOVE commits on tile arrival. Explicit 150ms ticks pause when the page is hidden/unfocused; suspension cannot burst unseen attacks. Chest front art extends below its interaction cell, but sorts at logical contact Y so the open lid cannot hide the Explorer. No approved renderer changes were needed.

Completion shows Stage I / Lost Courtyard, chests X/6 and exact HP. Continue preserves that result and shows Stage II — Forgotten Galleries / READY_FOR_STAGE_2 / NOT BUILT YET. No fake Stage II map or runtime is instantiated.

## New art and manifest

Only five standalone RGBA assets were generated with the built-in GPT Image tool. Full prompt set and source provenance are in `art-prompts.json`. Technical exports use uniform whole-canvas resizing/padding, not reference-board crops or independently fitted state images.

| Asset | Category | Source | Display | Anchor | Bytes |
| --- | --- | --- | --- | --- | --- |
| chest-closed-v2 | props/chests | 512×512 | 32×36 | .5,500/512 | 306640 |
| chest-open-v2 | props/chests | 512×512 | 32×36 | .5,500/512 | 389131 |
| bronze-temple-key-v2 | props/keys | 256×256 | 18×24 | .5,248/256 | 44435 |
| side-gate-locked-v2 | environment/architecture | 256×384 | 64×64 | .5,376/384 | 154926 |
| side-gate-open-v2 | environment/architecture | 256×384 | 64×64 | .5,376/384 | 109188 |

All use 1×1 logical interaction footprints; gate side jambs coincide with authored neighbouring solids. The manifest documents dimensions/anchors/categories/depth and the locked/open collision hint. Authority still uses explicit map/gate state. Paired states share identical canvases, display sizes, anchors and alignment; measured bottoms differ by at most one source pixel (<.2 gameplay px). The open gate has genuine transparent interior. Existing V2/V1 assets remain intact. No generated assets were rejected or regenerated; the chest depth error was corrected in presentation.

## Evidence and verification

`qa/lost-courtyard-full-playthrough.mp4` is the full real-input mobile run at 390×844, with no state injection or gameplay skips. It includes held touch movement, a buffered keyboard turn, all six chests, a blocked gate attempt, key/unlock, both pushes, the snake, monkey attacks, deliberate spike/trap damage, the fourth-chest unlock, optional sword/Gems, completion and the future-stage placeholder. Initial recording setup idle time is trimmed; gameplay is not cut or sped up. Recording is silent; the playable page includes optional synthetic loot/unlock/damage feedback.

The exported browser transcript is `qa/lost-courtyard-local-replay.json`; the focused test replays it twice and compares the exact durable result. Final result: 6 chests, 4 loot Gems, **24 HP**, sword owned, potion consumed. Deliberate hits: trap 18, two monkey rocks at 20 each, spikes 18. Inputs never skip/diagonalize cells. All stage-local/puzzle/wildlife event families occur.

Screenshots at actual mobile scale:
- `qa/mobile-arrival-open-chest.png`
- `qa/mobile-vine-arcade.png`
- `qa/mobile-locked-archive.png` / `qa/mobile-open-archive.png`
- `qa/mobile-boulder-store.png` / `qa/mobile-four-chests-unlocked.png`
- `qa/mobile-monkey-treasury.png` / `qa/mobile-six-chests.png`
- `qa/mobile-completion.png` / `qa/mobile-ready-for-stage2.png`

Desktop retains the same gameplay viewport: `qa/desktop-locked-archive.png` and `qa/desktop-arrival-reset.png`. Browser reset also verifies 100 HP, zero chests, fresh positions/key/gate and closed treasure.

Checks passed:
- Targeted stage/manifest/render/traversal/Gem Runner suite: **110 tests / 13 files**.
- Full `npm test -- --testTimeout=120000`: **1193 passed / 69 skipped** (149 files passed / 5 skipped).
- `npm run build`, `npm run lint`, `npx tsc -b`, `npm run typecheck:server`: passed. Build retains the existing >500KB production-chunk warning.
- Manifest paths/dimensions, actual transparency, paired alignment and production-import isolation pass.
- Real browser touch hold, buffered turn, gate blocking/unlock, all treasure/puzzles/hazards, completion/placeholder and UI reset pass. Desktop/mobile screenshots were inspected; no runtime console errors.

Changed files: the new dev HTML and React/CSS entry; `game/chestHunter/stage1/{level,model,model.test,ChestHunterScene}.ts`; five PNGs; additive manifest/asset-test updates; and this directory's documentation, prompts, screenshots, video and replay fixture. No environment/traversal/Gem Runner/V1/server/production files were modified. Unrelated `.agent-state` and `videos/` work remains untouched.

CHEST_HUNTER_STAGE_1 is ready for human playtest. Human review should assess treasure readability, the route-around arcade/locked archive, groove-push clarity and treasury fairness on touch. No production integration or Stage II work is included.
