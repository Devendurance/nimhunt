# Gem Runner — Stage I: Outer Ruins

Status: **STAGE_1_GAMEPLAY ready for human playtest**. Local development slice;
production approval/integration remains a future decision.

Branch: `feat/angkor-v2-stage1`, based exactly on approved traversal
`a9b9d478fbea1076e536e5282947be73e6ea52b0`. Main remains
`2541c19e26f66c88683a8ac5ce73bcfa24439bb9`.

## Play

Run `npm run dev`, then open `/dev/angkor-v2-stage1.html` (the existing local
server uses port 5174). Start exploration; hold the existing D-pad or arrows/WASD.
Reset run / Play again restores the initial stage. Debug is off by default;
enable it for collision cells, camera frame, player coordinate, both Gem totals,
wildlife states and the last 12 deterministic events. Export local replay saves
the complete action transcript. Sound is optional. Hidden/unfocused tabs freeze
simulation and clear held input. Reduced motion keeps the approved grounded
idle gait during movement and suppresses the damage flash.

## Original authored layout

30×24 logical cells, 960×768 pixels. All coordinates below are zero-based.
Six connected spaces occupy a closed architectural world:

| Area | Purpose / route |
| --- | --- |
| Entry Terrace | Safe spawn (3,20), two visible Gems, jungle roots and broken entrance. |
| Root Court | Guardian and pillar landmark, first coiled snake, moss/root intrusion, first spike group. |
| Broken Gallery | Tall/low masonry divider hides the direct route to a visible Gem; turn around its south end. |
| Boulder Garden | Three stones, a pushable breach shortcut, a small recoverable optional Gem alcove; second snake. |
| Monkey Ledge | Raised solid perches, tell/target/rock encounter, second spike group, final main-route Gem. |
| Temple Passage | Narrow turning approach; closed threshold (24,3) opens at 6 Gems. |

| Gem | Tile | Role |
| --- | --- | --- |
| terrace-a | (4,19) | Main |
| terrace-b | (7,18) | Main |
| root-court | (4,11) | Main |
| root-bonus | (8,10) | Optional |
| gallery | (10,3) | Main, detour around masonry |
| garden | (18,13) | Main |
| garden-bonus | (14,14) | Optional boulder alcove |
| ledge | (24,14) | Main, monkey encounter |

Eight available, six required. Each Gem is keyed and collected once. The HUD
shows `GEMS X / 6`, including 7/6 and 8/6. `stageGems` and `expeditionGems` are
separate state fields and currently increase together.

## Gameplay rules

- Movement reuses `TileTraversal`, V1 `calculateMove`, the 145ms presentation,
  held input / single buffered turn, Explorer atlas, bounded camera and
  `AngkorV2Environment.trackActor/update`. Arrival commits exactly one cardinal
  MOVE. Default traversal behavior is unchanged; optional hooks supply Stage I
  legality and arrival commits. No environment renderer changes were needed.
- Collision is compiled from explicit authored map cells/solid pillars and
  guardians. Stage state adds boulders and the locked passage. PNG alpha never
  supplies collision. Rendering and logical movement remain separate.
- Snakes: exactly two, one-cell footprints. Roots trigger zone is x5–8/y9–11;
  garden zone x17–20/y12–15. Activation gives a 3-tick (450ms) alert, then a
  cardinal authored patrol step every 4 ticks (600ms). Roots cycle (6,10),
  (7,10), (7,11), (6,11); garden cycle (18,14), (19,14), (19,15), (18,15).
  Presentation interpolates each step. No pathfinding or alternate route.
- Monkey: one encounter in x23–27/y10–18, perches (26,10)/(27,15). The tell locks
  the player's committed tile; a visible marked tile/countdown lasts 8 ticks
  (1.2s). A visual rock arc lands there, and only a player still on that tile
  takes damage. Perches alternate after impact; recovery is 10 ticks (1.5s).
  The monkey's visual foot is raised by the renderer's tall-wall height and
  drawn above its own perch cap.
- Boulders start at (11,12), (14,12), (18,11). Push one tile, never chain-push.
  Walls/solid architecture, other stones, uncollected Gems, spikes, the passage
  and authored snake patrol lanes reject pushes. The breach stone opens a
  shortcut between Root Court and Boulder Garden; the north/gallery route
  remains available. The optional alcove has side recovery space so a legal
  south push cannot permanently trap its Gem. Dust and tweening are visual.
- Spikes: two groups, (8,12)/(9,12) and (24,16)/(25,16). Always visibly extended.
- HP starts at 100. Snake contact 12, spikes 18, monkey rock 20. Damage grants
  6 ticks (900ms) global invulnerability, covering persistent contact and
  preventing multiple stacked hits. Remaining on a hazard can hurt again.
  Zero HP ends the local run; reset starts fresh. No poison subsystem added.
- Exit: entering the threshold is illegal while locked. The sixth Gem emits
  EXIT_UNLOCKED exactly once, changes to the open Passage asset, updates HUD
  feedback and plays a short chime when sound is enabled. Optional Gems remain
  available. Entering the open passage freezes gameplay and reports secured
  Gems, expedition Gems and final HP. The completion overlay stops at Stage I.

## Determinism / ownership

`src/game/stage1/model.ts` is an immutable, Phaser-free reducer. Actions are
`MOVE(direction)`, explicit `TICK`, and `RESET`. Each tick represents 150ms of
active local simulation; deadlines and immunity use integer ticks. The adapter
records all MOVE/TICK actions in order. Rendering time, audio, tweens and camera
never determine gameplay results. A delayed frame advances at most one tick;
tab suspension does not fast-forward hidden attacks. MOVE commits before any
tick scheduled in that frame, and that ordering is included in the transcript.
Reproduction requires the entire local action transcript, including TICKs.

Serializable events carry monotonic sequence and tick: MOVE, GEM_COLLECTED,
DAMAGE, SNAKE_ACTIVATED, SNAKE_MOVED, MONKEY_ATTACK_TELEGRAPH,
MONKEY_ROCK_IMPACT, BOULDER_PUSH, EXIT_UNLOCKED and STAGE_COMPLETE.
`replayStage` reproduces the model from initial state. There is no RNG, wall
clock or production replay/checkpoint authority in the reducer.

`StageScene.ts` owns only the local scene adapter. Approved environment/player/
camera components are reused. Temporary effects, input bindings, audio and
Phaser resources are cleaned up, including hot reload. Production entry/import
graph exclusion is tested. No production `/play`, V1 assets, replay/proof
contracts, rewards, claims, payouts, Reward Week, P7 or Stage II changed.

## QA evidence

Screenshots are CSS-pixel captures at actual gameplay scale, with debug off.

- Desktop: `qa/desktop-entry.png`, `desktop-root-court.png`,
  `desktop-gallery.png`, `desktop-boulder-garden.png`,
  `desktop-passage-open.png`, `desktop-complete.png`.
- Mobile 390×844: `qa/mobile-entry.png`, `mobile-gallery.png`,
  `mobile-boulder-garden.png`, `mobile-monkey-telegraph.png`,
  `mobile-passage-open.png`, `mobile-complete.png`.
- Short phone: `qa/mobile-320x568.png`; no horizontal scroll, Down control
  bottom at 513px inside a 568px viewport.
- `qa/stage1-gameplay.webm`: 34-second corrected mobile monkey encounter,
  evasion, passage approach and completion recording.
- `qa/keyboard-playthrough.json`: 1,127 actions, exact state/event reproduction,
  all 8 Gems, final HP 26. Exercises spike/monkey damage, both snakes and pushes.
- `qa/touch-playthrough.json`: 1,031 actions, exact state/event reproduction,
  all 8 Gems, final HP 64. Real CDP touch input on the P6 D-pad, both snakes,
  four stone pushes, spike damage, monkey evasion and completion.
- Touch hold verified three sequential UP tiles, no scroll. A separate
  two-touch buffered-turn test committed UP then RIGHT after releasing both.
  Keyboard and reduced-motion compatibility inherit the focused traversal tests.
- Debug toggle/event view and local replay export exercised in the browser.

Rejected during QA: the first alcove could trap an optional Gem after a legal
push (side recovery geometry added and regression tested); initial perch depth
hid the monkey behind its own wall (height/depth corrected). Hot reload could
duplicate the React/Phaser root (dispose cleanup added). Early screenshots and
recordings of those passes were excluded. No art was generated, replaced or
promoted; approved production environment and existing provisional wildlife,
props and effects remain available unchanged.

## Verification

- Focused domain/traversal/camera/map/V1 movement: 35 passing tests, including
  11 new domain tests. Covers 8/6 quota, one-time collection, locked/unlocked
  completion, exact reset/result, cardinal moves, held/buffered order, snake
  patrol/activation, monkey tell/impact, damage, collision and alcove recovery.
- Final `npm test`: 144 files passed, 5 skipped; **1,127 passed, 69 skipped**.
- `npm run build` / root project typecheck (`tsc -b`): passed.
- `npm run lint`: passed.
- `npm run typecheck:server`: passed.
- Existing large production gameplay bundle warning remains unchanged; Stage I
  is absent from the production import graph and build output.
- Branch remains separate from main. `.agent-state`, unrelated worktree changes
  and the user's untracked videos are preserved.

Human playtest should judge route discovery, wildlife tell readability,
difficulty, camera feel and optional puzzle clarity. No Stage II or production
proof/reward integration is authorized by this slice.

## Changed code

New: `dev/angkor-v2-stage1.html`, `src/dev/angkorV2Stage1.tsx`, its CSS,
`src/game/stage1/level.ts`, `model.ts`, `model.test.ts`, `StageScene.ts`, and this
report/QA evidence. Modified: traversal movement opt-in hooks and manifest test
production-graph guards. Existing asset binaries and manifest records unchanged.
