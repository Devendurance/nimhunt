# Angkor V2 Gem Runner expedition runtime

Status: **READY_FOR_STAGE_2** runtime foundation. Stage II and III have definitions/contracts only. Human playtest can use `/dev/angkor-v2-gem-runner.html` with `npm run dev`; this entry is excluded from the production import graph and build entry points.

Base: `a99803725dca8256b184cbd52cf1c139a75488b4`. Branch: `feat/angkor-v2-gem-runner-runtime`. Production `/play`, V1, rewards, claims, proof/replay/checkpoint contracts and main are unchanged.

## Lifecycle and contracts

`src/game/gemRunner/contracts.ts` defines the canonical Outer Ruins → Overgrown Temple → Inner Sanctuary order and the generic `StageAdapter<State, Action>` interface. An adapter owns initial local state, action validation, its pure reducer, and progress/completion reports. The expedition sees only explicit carry and durable results.

`model.ts` is a Phaser-free immutable reducer. State includes version/mission, PLAYING/TRANSITION/COMPLETE/FAILED, canonical stage ID and zero-based index, HP, stage/expedition Gems, carried items, stage entry carry, completed IDs/results and sequential expedition events. Completion enters TRANSITION; Continue derives exactly the next canonical stage. Final-stage completion becomes COMPLETE. Zero HP becomes FAILED, retains earlier results and blocks advancement. Terminal and duplicate completion actions are inert.

Carry is a whitelist: exact HP (no transition heal), cumulative expedition Gems, sword acquisition and potion acquisition/consumption. Stage Gems reset to zero on Continue. Consumed potion state cannot be restored. Keys, boulders, wildlife, hazards and puzzle objects stay stage-owned. The item contract supports future gameplay without granting items in Stage I.

`outerRuinsAdapter.ts` runs the approved Stage I reducer unchanged, except `initialStageState`/`replayStage` now accept optional HP/Gem carry. Fresh state and both approved recorded playthroughs remain identical. Durable results include stage ID, both Gem totals, HP, item carry, simulation tick and action count. `StageScene` accepts optional carry and a reducer callback; standalone Stage I retains its existing behavior. The expedition adapter excludes RESET/revive.

## Local transcript

`runtime.ts` attaches only the current stage adapter and records ordered stage-owned actions and explicit start/completion/failure/advance boundaries. The `angkor-v2-gem-runner/v1` envelope includes carry snapshots, durable results and the cumulative expedition snapshot. Export it from the dev page's Debug panel.

`replayEnvelope` replays actions through supplied real adapters and verifies each generated boundary, carry/result/action index and final snapshot. Unbuilt stages may have a start boundary but cannot replay gameplay actions. A STAGE_STARTED event prepares the next stage contract; it does not instantiate a scene. No RNG or wall-clock outcomes enter the domain; Stage I's existing presentation records explicit MOVE/TICK actions. This is a local future-integration format, not a production proof or claim payload.

## Dev QA

Start fresh expedition launches the existing 30×24 Outer Ruins scene with the approved movement, camera, occlusion and Dpad. The HUD shows stage Gems, expedition Gems and HP. Normal completion shows secured/total Gems, remaining HP and the next stage. Continue destroys the Stage I Phaser scene and displays **STAGE II — OVERGROWN TEMPLE / READY_FOR_STAGE_2 / NOT BUILT YET** with the carry and zero Stage Gems. There is no Stage II map, action adapter or retry/revive control. Debug defaults off and exposes carry, completed results, expedition events/state and envelope export.

Browser evidence, using actual keyboard input without changing gameplay state:

- Six Gems collected; Stage I entered TRANSITION at 100 HP, tick 230, 298 recorded actions. It did not advance automatically.
- Continue carried exactly 100 HP / 6 expedition Gems to Stage II, reset stage Gems to 0, and removed the canvas.
- Exported `qa/keyboard-expedition-envelope.json` replayed identically (303 ordered entries).
- Separate spike-death run reached FAILED at 0 HP with no Continue/reset/retry/revive control.
- 320×568 phone controls fit without horizontal overflow. 390×844 mobile and 1280×900 desktop boundary screenshots were inspected. No browser errors were logged.

Screenshots:

- [Mobile Stage I completion](qa/mobile-stage1-transition.png)
- [Mobile Stage II contract](qa/mobile-stage2-contract.png)
- [Desktop Stage I completion](qa/desktop-stage1-transition.png)
- [Desktop Stage II contract](qa/desktop-stage2-contract.png)
- [Small phone gameplay](qa/mobile-small-playing.png)
- [Failed expedition](qa/mobile-failed.png)

## Verification

- Targeted runtime + existing Stage I tests: **25 passed** (14 runtime tests, 11 existing Stage I tests).
- `npm test`: **1,141 passed / 69 skipped**, 145 test files passed / 5 skipped.
- `npm run build`: passed; existing large bundle warning remains.
- `npm run lint`: passed.
- `npx tsc -b` (root): passed.
- `npm run typecheck:server`: passed.
- Production import-graph guard now explicitly excludes the new dev page, runtime and model.

Tests cover fresh carry, exact approved Stage I replay, damaged HP carry, cumulative/reset Gem totals, item persistence/local-state exclusion, ordered advancement, failure/duplicate boundaries, three-stage lifecycle contracts, deterministic envelope replay and tamper rejection. Test-only later-stage result fixtures do not implement later-stage gameplay.

## Changed code

- Added `src/game/gemRunner/{contracts,model,runtime,outerRuinsAdapter,runtime.test}.ts`.
- Added `src/dev/gemRunnerExpedition.tsx`, `src/dev/gemRunnerExpedition.css`, `dev/angkor-v2-gem-runner.html`.
- Bounded carry/reducer hooks in `src/game/stage1/model.ts` and `StageScene.ts`.
- Extended `src/game/assets/angkorV2Manifest.test.ts` production isolation guard.
- Added this report and QA evidence. No asset, map, wildlife or environment renderer changes.

Next slice may implement Overgrown Temple against the same stage contract after human review. No Stage II/III gameplay or production integration is included here.
