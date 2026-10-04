# Vault Breaker V2 — Inner Vault

Branch: `feat/angkor-v2-vault-breaker-stage3`, based on approved `a426d6a14262fb3d8704581e614e0f6ebf46237c`. No merge or production integration.

## Play

Run `npm run dev`; open `/dev/angkor-v2-vault-breaker.html`. Start a fresh expedition, complete Temple Approach and Ancient Mechanism, Continue into Inner Vault. Arrows/WASD or the existing held-input D-pad. Debug starts OFF. Reset starts a new attempt; there is no boss skip/teleport/revive UI.

## Map and objective

32×26 logical tiles / 1024×832 world, square 32px grid and approved 145ms traversal.

- Inner Lock Vestibule: exact carry, safe entry, first optional Gem.
- Fractured Causeway: broken approach, one fixed horizontal dart guardian; optional Gem/potion and safe lower recess.
- Guardian Antechamber: dormant Golem visible from `(21,16)` before crossing the awakening threshold.
- Golem Chamber: three separated anchors and carved bait sockets; a fixed 2×2 guardian root occupies `(19..20,13..14)`.
- Broken Seal Passage: gate `(23,13)` opens only after all three anchors.
- Inner Vault: sealed door `(24,12)` and shrine `(28,11)`. The final door and Golem are visible together at mobile scale.

Anchors: west `(15,14)` / bait `(16,14)`, east `(26,17)` / bait `(26,16)`, south `(20,17)` / bait `(20,16)`. The player chooses the order. Every reachable anchor subset preserves remaining bait positions and escape routes. One 3×3 smash cannot overlap two anchors. The final bait is `(23,12)`, with escape through `(23,14)`.

Optional Gems: `(6,22)`, `(5,13)`, `(29,10)`; potion `(9,14)`. No Gem/chest quota. Potion uses established immediate +25 HP capped at100 and consumed-item semantics; no boundary healing.

## Golem authority and presentation

Phaser-free Stage III MOVE/TICK reducer. Fixed150ms ticks own every boss/guardian outcome. States: DORMANT → AWAKENING → READY → WINDUP → SMASH → RECOVER; final smash enters permanent STUNNED. Activation occurs once. READY waits outside the authored influence zone, allowing retreat and re-positioning. No RNG, pathfinding, attack button or boss HP.

Awakening10ticks/1.5s; READY pause4ticks/.6s. Phase tells14/12/10ticks =2.1/1.8/1.5s. Smash pose2ticks/.3s; recovery12ticks/1.8s. Final tell14ticks/2.1s. Target and3×3 footprint freeze when windup starts. Misses recover normally. Damage30HP, existing six-tick immunity. The causeway guardian warns8ticks, flight2, recovery16; dart damage16HP. Every reachable smash snapshot has a legal safe cell within three tile moves. No ordinary snakes/monkeys or added debris attacks.

Only a Golem smash breaks an anchor. Each breaks once. After three, the seal passage opens, but the boss remains active. A separate snapshotted smash intersecting the final door emits FINAL_VAULT_TELEGRAPH → GOLEM_FINAL_SMASH → VAULT_DOOR_BROKEN → GOLEM_STUNNED. Shrine entry completes Stage III and the expedition once. Failure preserves prior results and prevents completion.

The guardian is rooted: pose textures share128px display canvases and calibrated foot pivots, producing approximately105–120px visible height. Static Y/depth and existing alpha-aware actor occlusion remain in use. Derived subposes show final smash, recoil, then permanent stunned statue. Floor fractures connect the rooted fist impact to the authored target. Impact dust/stone, short camera shake and sound are presentation only; reduced motion suppresses shakes/tremor. A QA-discovered foreground-wall dust occlusion was corrected locally in this new scene.

## Art

Eleven original transparent assets; no existing PNG changed. Seven poses derived from one guardian identity, paired anchors and doors retain source canvas/display/footprint/anchor registration. Golem source art remains high-resolution; this is a dev playtest slice, not a production preload rollout. Stage-only load scope prevents these images from adding preload cost to Gem Runner, Chest Hunter or earlier Vault Breaker stages. Only the two new intact mechanisms join the shared presentation-only emphasis profile; existing profiles are unchanged.

| Asset | Source | Display | Bytes |
| --- | --- | --- | --- |
| inner-vault-door-broken-v2 | 1254×1254 | 96×96 | 2,326,300 |
| inner-vault-door-sealed-v2 | 1254×1254 | 96×96 | 2,495,898 |
| vault-anchor-broken-v2 | 1254×1254 | 44×56 | 1,372,229 |
| vault-anchor-intact-v2 | 1254×1254 | 44×56 | 1,814,685 |
| golem-awaken-v2 | 1254×1254 | 128×128 | 1,817,710 |
| golem-dormant-v2 | 1254×1254 | 128×128 | 2,597,554 |
| golem-idle-v2 | 1254×1254 | 128×128 | 2,302,994 |
| golem-recoil-v2 | 1254×1254 | 128×128 | 1,784,880 |
| golem-smash-v2 | 1254×1254 | 128×128 | 2,646,559 |
| golem-stunned-v2 | 1254×1254 | 128×128 | 2,397,334 |
| golem-windup-v2 | 1254×1254 | 128×128 | 2,069,660 |

Rejected/regenerated: awakening fists clipped the canvas; recoil crown clipped the top; the original sealed door had an opaque corner pixel. Regenerated clean-margin versions and the matching broken door passed the existing RGBA transparency checks. Unrelated art was retained.

## Runtime and replay

Adds only the Inner Vault contract/adapter and final lifecycle completion. Results carry exact HP/items plus ordered broken-anchor IDs, final STUNNED state, shrine/access objectives, optional Gems and action/tick metadata. Stage-local defenses/objectives reset on entry. Existing v1 contract-only boundary snapshots remain compatible; previous StageI/II recording tests still pass. Production transcripts, proof/checkpoints and economics are untouched.

`qa/vault-breaker-stage3-replay.json` is exported from actual legal mobile keyboard input, not injected state. Its132-test relevant verification includes byte-identical full envelope replay, per-stage carry, local guardian event/target replay, final state and all results. Recorded stage HP: 78 → 100 → 100; all three stages secured3optional Gems each (9total). Boss anchor order south → west → east; three anchors and one final door smash, no boss damage taken.

## Evidence

All phone PNGs and videos are390×844 CSS-pixel captures, with384×320 gameplay viewport (32px tiles). Debug is OFF in gameplay screenshots.

- Dormant: `qa/mobile-dormant-golem.png`
- Awakening: `qa/mobile-awakening.png`
- Phase1tell: `qa/mobile-phase-1-windup.png`
- First anchor impact/broken: `qa/mobile-anchor-1-impact.png`, `qa/mobile-anchor-1-broken.png`
- Later phases: `qa/mobile-phase-2-windup.png`, `qa/mobile-phase-3-windup.png`
- Final vault tell/smash: `qa/mobile-final-vault-telegraph.png`, `qa/mobile-final-vault-smash.png`
- Broken vault: `qa/mobile-broken-vault.png`
- Completion: `qa/mobile-expedition-complete.png`, `qa/desktop-expedition-complete.png`
- Boss-only: `qa/golem-boss-only.mp4` (37s)
- Full StageIII: `qa/inner-vault-golem.mp4` (54s)
- Full expedition: `qa/full-vault-breaker-expedition.mp4` (4m34s)

Recordings are H.264,25fps, mobile scale, from the same completed attempt. Only boundary/end waiting and the debug-export tail were trimmed; no gameplay was sped up or fabricated. StageIII is a continuous recording. Full expedition joins its real StageI/II recording at the existing StageIII entry. Original recordings/scratch are archived outside the repository. Reproducible legal browser automation: `qa/enter-stage3.txt`, `qa/boss-play.txt`.

## Verification

- Final relevant suite:132passed,20files (Vault Breaker, Chest Hunter, Gem Runner runtime, rendering, manifest and real three-stage recording).
- Full `npm test`:1277passed/69skipped; two existing production solvability timeouts at90s/75s. Both original failures passed serially (room bootstrap and Chest Hunter variant2). Serial run exposed a separate existing V1 goblin test exceeding its15s timeout; focused rerun still timed out. No production tests or timeout thresholds were changed. Full-suite status is therefore not green.
- Build/root TypeScript, lint and server typecheck passed. Existing >500KB bundle warning persists.
- Asset dimensions/real alpha/state registration, all anchor subsets, frozen targets, legal escapes, exact damage, terminal states and full runtime replay verified.
- Production /play and production contracts unchanged; main not merged. User .agent-state files/videos preserved.

## Files

New `src/game/vaultBreaker/stage3/{level,model,InnerVaultScene,presentation,testRoutes}.ts` and model/runtime/presentation/actual-recording tests; new `src/dev/vaultBreakerStage3.tsx`; bounded changes to Vault Breaker contracts/model/adapters and existing dev launcher. Asset manifest/count tests updated; shared environment preload gains opt-in stage scope with coverage; new-key-only emphasis profiles. Eleven new PNGs and this report/QA evidence.

READY_FOR_HUMAN_PLAYTEST: playable full Vault Breaker V2, deterministic result/replay proven. Human review still owns boss readability, impact feel and mobile fairness. The unrelated full-suite timeout limitation is disclosed above. No production release/merge or further mission work.
