# Vault Breaker V2 — Stage I: Temple Approach

READY_FOR_HUMAN_PLAYTEST. Isolated development slice; Stage II/III are contracts only.

Base: `e3e92179cbec9408a0f44351fff89649a47befde`.
Branch: `feat/angkor-v2-vault-breaker-stage1`. No main merge.

## Play

Run `npm run dev`, then `/dev/angkor-v2-vault-breaker.html` (current server: http://127.0.0.1:5174/dev/angkor-v2-vault-breaker.html).
Start/reset the expedition. Hold the existing DirectionalDpad, arrows or WASD; one buffered turn, 145ms per tile. Debug is OFF by default. Debug exposes coordinates, HP, objectives/key/seal, boulders, plate/gate, rubble, wildlife, ordered events and transcript export.

There is no Gem/chest quota. Find access → manipulate mechanisms → breach the seal → survive defenses → enter the inner passage.

## Map / access

32×24 square logical tiles; world 1024×768px. Fixed scrolling camera approximately 12×10 tiles, same bounded smoothing, Y sorting and alpha-aware cutaway as the approved foundation. No renderer changes.

| Area | Authored space / role |
| --- | --- |
| Jungle Causeway | Safe southwest entry (3,20); sealed monumental facade visible ahead. Its masonry is solid; the route circles through the Broken Watch. |
| Broken Watch | Broken connector, ruined sightlines, one snake and small spike pair. Optional potion in a western recess. |
| Key Court | Bronze Vault Key (16,5) visible inside a walled alcove. The sole entrance (13,6) is blocked by a guided stone. Push UP from (13,7) to park it at (13,5). |
| Outer Seal | Keyed threshold (20,9) is the ONLY eastward connection. Enter with key to permanently unlock; key is consumed. Low ruined foreground sill reveals the door while remaining logically solid. |
| Collapsing Passage | Two-wide defensive corridor. Three west-lane cells (22,9–11) receive falling rocks; the continuous east lane (23,9–11) remains safe. |
| Mechanism Gate | Stone at (27,10), reversible rail y10–12. Push onto plate (27,11) to open gate (27,7); exit at (28,4), beyond the gate. |

The objective history is sequential: `bronzeKeyCollected` → `outerSealUnlocked` → `mechanismActivated` → final passage. Physical plate/gate occupancy is separate and reversible. Release the plate and the gate closes; the recorded activation objective remains true. Completion still requires the gate to be held open.

Exactly two boulders. Key stone is constrained to one UP push into a permanent parking recess. Mechanism stone can move UP/DOWN within its three-cell rail; both approach ends are reachable. No side/diagonal pushes, entity overlap or pushing through solids. All SIX intended key-stone/plate-stone configurations are tested through legal moves to completion, including zero optional pickups. Flood tests prove the key, seal and final passage cannot be bypassed.

## Defenses / optional pickups

- Exactly one snake: explicit Broken Watch activation zone, 3-tick alert, fixed authored one-cell patrol every 4 ticks; contact 12 HP. No pathfinding/random AI.
- Exactly one monkey: two masonry perches, snapshots the player's tile, 8-tick/1.2s tell, impact 20 HP only if still on that cell, 10-tick recovery, fixed perch progression.
- Small spikes at (5,12)/(6,12):18 HP.
- Falling rubble: fixed10-tick/1.5s warning, simultaneous authored lane impact22 HP, 14-tick/2.1s recovery; rearms after leaving the trigger zone. A continuous safe lane is always available.
- Damage immunity uses the established6-tick/900ms pattern; HP 0 fails the attempt and freezes stage actions. No revive.
- Three optional blue Gems: (6,20), (9,12), (24,5). Collect once; never unlock anything. Counts are retained in the durable stage result rather than added to the carry whitelist.
- One optional potion at (2,12): immediate use, heals at most 25 HP/caps 100 using existing isolated chest-potion semantics/constants. Records acquired+consumed; never replenishes inventory at a boundary. No sword pickup invented, but an existing sword can carry through the contract.

## Runtime / transcript

`src/game/vaultBreaker/` is Phaser-free except its dedicated scene.

Canonical stages: `temple-approach`, `ancient-mechanism`, `inner-vault`.
State: version/mission, PLAYING|TRANSITION|COMPLETE|FAILED, current stage/index, exact HP, carried items, current objective history/optional Gems, carry-in snapshot, completed stage results and ordered expedition events.

Carry whitelist: HP, sword, potion owned/consumed only. No keys/gates/plates/rocks/wildlife/local mechanisms carry. Fresh expedition 100 HP; no boundary healing. Future Stage II/III implementations must supply their real adapters/objective contracts; there are no fake maps or gameplay actions for them here.

Temple Approach result includes stage ID, exact HP/items, three objective booleans, optionalGemCount and completion tick/action count. Completing enters TRANSITION once. Continue advances exactly to Stage II, clears local objectives, retains completed result and exact carry, displays READY_FOR_STAGE_2 / NOT BUILT YET. Another Continue cannot skip Stage II. Failure blocks advancement.

Local envelope: `angkor-v2-vault-breaker/v1`, mission `vault-breaker`. Ordered MOVE/TICK actions, stage ID/action index, start/completion/failure/advance boundaries, carry snapshots, objective/result and expedition snapshot. Replay regenerates and checks every boundary and the final snapshot. It rejects mutated carry, missing adapters, out-of-order boundaries and reset/revive actions. No production ExpeditionTranscript/ReplayAction/checkpoint/proof contracts changed.

Explicit local events cover MOVE, DAMAGE, GEM_COLLECTED, POTION_CONSUMED, KEY_COLLECTED, OUTER_SEAL_UNLOCKED, BOULDER_PUSH, RUBBLE_TELEGRAPH/IMPACT, MECHANISM_PLATE_ACTIVATED/RELEASED, MECHANISM_GATE_OPENED/CLOSED, SNAKE_ACTIVATED/MOVED, MONKEY_ATTACK_TELEGRAPH/ROCK_IMPACT, EXIT_UNLOCKED and STAGE_COMPLETE. Expedition events record starts, results, transition-ready, advancement, failure and eventual completion. No Math.random or hidden wall-clock outcomes. Presentation freezes when unfocused; explicit simulation ticks remain replay authority.

## Art / presentation

No new PNGs or broad art regeneration. Bronze Vault Key uses the approved `bronze-temple-key-v2` artwork under the stage-local `bronze-vault-key` domain ID; displayed 24×32 instead of the source manifest 18×24, with a tiny presentation-only periodic glint (disabled for reduced motion). Existing locked/open gates, plate, boulder, Gem, potion, snake/monkey, effects and monumental passage art are reused. Paired-state canvases/anchors unchanged. Pressure plate engages with a restrained tint; rockfall shows marked lanes, descending stones, impact/dust. Closed/open passage and gate swaps, sound cues and injury flash use existing patterns; reduced-motion preference respected.

Production manifest/assets, shared renderer/traversal and both completed missions remain unchanged. The newer item-readability branch was not cherry-picked: this slice starts from the exact requested Chest Hunter III base.

## QA evidence

All screenshots are real composed scenes, Debug OFF, with native 390×844 mobile page captures (canvas384×320 logical pixels) plus fresh 320×640 and 1280×900 desktop captures. The automation uses legal keyboard/touch input, reads state for navigation, and never injects coordinates or puzzle state.

- `qa/mobile-jungle-causeway.png`, `qa/desktop-jungle-causeway.png`
- `qa/mobile-320-controls.png` — native short-screen mount; reset stays accessible
- `qa/mobile-key-stone.png`, `qa/mobile-bronze-vault-key.png`
- `qa/mobile-outer-seal-locked.png`, `qa/mobile-outer-seal-open.png`
- `qa/mobile-rubble-tell.png`, `qa/mobile-rubble-impact.png`, `qa/mobile-rubble-safe-lane.png`
- `qa/mobile-mechanism-inactive.png`, `qa/mobile-mechanism-active.png`, `qa/mobile-mechanism-released.png`
- `qa/mobile-monkey-tell.png`, `qa/mobile-final-mechanism-gate.png`
- `qa/mobile-stage1-transition.png`, `qa/mobile-stage2-contract.png`
- `qa/temple-approach-playthrough.mp4` — full native 390×844, 25fps gameplay/transition recording, 64.76s. Browser recording has no audio track; live sound is available.
- `qa/vault-breaker-stage1-replay.json` — actual recorded envelope, 486 entries: 481 actions (133 MOVE +348 TICK), completed at tick 348 with 58 HP, 3 optional Gems, consumed potion, key/seal/mechanism satisfied. Continues into Stage II with the SAME 58 HP. Replayed byte-equivalent envelope/state via real adapter in a focused test.

## Verification

- Targeted mission/environment/manifest/traversal suite: 160 tests passed (19 files).
- Full `npm test -- --testTimeout=120000`: 1,243 passed, 69 existing skips; 155 passed files, 5 skipped.
- `npm run build`:PASS (existing chunk-size/plugin timing notices).
- `npm run lint`:PASS.
- Root `npx tsc -b --pretty false`:PASS.
- `npm run typecheck:server`:PASS.
- Production import-graph isolation:PASS.
- Actual mobile touch hold / buffered turn / all optional pickups / key consumption / rubble damage + safe lane / monkey tell + impact / plate open-close-recovery / completion → Stage II carry:PASS.

## Changed paths / boundary

Added only `src/game/vaultBreaker/{contracts,model,runtime,adapters,isolation.test,runtime.test}.ts`, `src/game/vaultBreaker/stage1/{level,model,model.test,testRoutes,TempleApproachScene}.ts`, `src/dev/vaultBreakerStage1.{tsx,css}`, `dev/angkor-v2-vault-breaker.html`, and this report/QA directory.

No Gem Runner/Chest Hunter/Anaconda/V1/production-play/reward/claim/payout/proof/Reward Week/P7 changes. Existing dirty `.agent-state` and `videos/` preserved and excluded from commit. No renderer fixes or new environment system. No Stage II/III gameplay. No main merge.

Human review remains: route/key discovery, fortified-room readability, access puzzle clarity and defense pacing on a real touch device. Automated solvability/replay and recorded completion are verified; visual/gameplay taste still needs human playtest.
