# Anaconda environmental boss rework

Bounded development slice from `ae53a50`; production `/play`, V1, proof/checkpoints and economics are untouched. Stage I/II and non-boss Stage III map/actors are unchanged. The 30×24 Sanctuary retains 12 Gems / 8 required. Only its east Sanctum Gem moves from (26,11) to (27,11), freeing the right cradle.

## Room and rules

Three explicit solid serpent pits at (22,13), (24,13), (26,13), with boulders at matching X / Y11. Stand north at Y10 and push DOWN one tile to Y12. Captive release rails permit the final push only while their own pit is vulnerable. Wrong directions/pits cannot strand stones. Pit order is CENTER → LEFT → RIGHT.

| Phase | Vulnerability | Slam warning | Dangerous rows | Replacement delay |
|---|---:|---:|---|---:|
| 1 | 80 ticks / 12s | 16 / 2.4s | 11 | 16 / 2.4s |
| 2 | 64 / 9.6s | 16 / 2.4s | 11,12 | 14 / 2.1s |
| 3 | 48 / 7.2s | 18 / 2.7s | 10,11,12 | 12 / 1.8s |

One explicit tick is 150ms; approved traversal stays 145ms. Emergence is 12 ticks / 1.8s; rock flight 4 / .6s. The final two ticks of a window reserve movement arrival; an accepted drop finishes even if the deadline passes during its flight. Misses retain the stone and repeat the same phase after retaliation/recovery. North row9 and south row14 recesses always remain safe. Successful phases advance only after retaliation, recovery and replacement readiness. Hit three interrupts the next slam, emits DEFEATED once and collapses into the pit over 14 ticks / 2.1s. Its replacement still lands, but no fourth phase exists.

Retaliation keeps 26 damage; replacement impact is explicitly 24. Existing six-tick immunity applies. Replacement warnings begin after the retaliation impact, keeping the two hazards separate. Replacement impact happens at the authored deadline; usable readiness waits until the player and one-step movement halo clear its cell. This prevents a new solid appearing in an animating destination. Move away to release a landed replacement. No coil block events remain active.

Defeat persists with fewer than eight Gems. Exit unlock requires three hits, finished defeat/replacement sequence AND eight Stage Gems. Optional Gems remain collectible. No automatic healing or completion: enter the open Escape Passage to finish the expedition.

## Model, presentation and replay

`src/game/stage3/model.ts` remains Phaser-free with version2 local state. Modes: DORMANT, EMERGING, VULNERABLE, RETALIATING, RECOVERING, DEFEATED. It records phase/pit/hits/deadlines/drop/replacement/targets and explicit serializable boss events. All authority remains ordered MOVE/TICK actions. Stage carry and expedition envelope use existing isolated adapters; production replay types are unchanged. Historical Stage III passive-boss recordings are superseded by this directory's rework transcript, not silently reinterpreted as the new boss rules.

Presentation reuses approved Anaconda poses and body traces, Explorer/traversal/camera, raised broken-pillar cradles, boulder and rock/dust effects. New pit: `public/assets/game/angkor-v2/environment/architecture/serpent-pit-v2.png`, 512×384 RGBA; display64×40. Transparent rim and opaque dark recessed interior. The initial source was refined for tighter exterior cutout; no other art family was regenerated. Dynamic boss uses the existing alpha-aware readability helper for player occlusion; the environment renderer itself is unchanged. Reduced motion removes camera shake and emergence wobble.

Built-in GPT Image prompt: one empty sandstone serpent emergence pit, top-down 2.5D square-grid camera, thick low broken warm Khmer-inspired stone rim, dark olive inner vertical faces, subtle moss and carved scale motifs, soft upper-left daylight, transparent exterior, no text/UI/floor rectangle. Refinement: retain the exact pit, remove exterior glow/backdrop, keep opaque dark interior and clean alpha boundary. Delivery only resizes/pads generated art; no reference-board cropping.

## QA

Route: `/dev/angkor-v2-gem-runner.html`. Play I → II → III normally. Debug exposes boss mode/phase/pit/window/danger lanes, logical stones, replacement and events; off by default. Export the complete local expedition envelope via Debug.

Final real-input playthrough: Stage I 7 Gems → Stage II 10 → Stage III 12 = 29 total; final HP52. It deliberately misses an initial window, retries with a touch push, lands all three rocks in CENTER/LEFT/RIGHT order, dodges slams and deliberately takes24 replacement damage. Boss defeat at seven Stage Gems leaves the exit locked; the eighth Gem unlocks it and all optional Gems remain collectible. Complete recorded envelope: 1,619 entries / 1,610 actions, including1,109 Stage III actions; pure replay reproduces the complete envelope and every boss event/result/stone state exactly.

Screenshots in `qa/`: phone390×844, desktop1280×900, compact320×568. Controls end at Y547.85 on the compact viewport. Final fresh-navigation playthrough has no runtime console errors. `qa-summary.json` records carry/results and encounter assertions; `boss-proof.json` records the deterministic boss proof; `full-expedition-envelope.json` preserves the actual complete run. The historical earlier passive-boss fixtures remain available unchanged.

Presentation rejected during QA: an overly high rock offset obscured the Explorer at the push cell; it was lowered while retaining the raised cradle. Retaliation/replacement warnings originally overlapped; they now run sequentially. Existing Anaconda pose family, foliage and environmental art were reused. Human approval of encounter feel/difficulty remains pending.

## Verification and delivery

- Targeted Stage I/II/III, runtime and manifest/isolation: **64 passed**.
- `npm test -- --testTimeout=120000`: **1,173 passed / 69 skipped**, 147 files passed / 5 skipped. Full suite ran once; per-run timeout accommodates the existing slow layout test.
- `npm run build`, `npm run lint`, `npx tsc -b`, `npm run typecheck:server`: passed. Existing >500KB bundle warning remains; no production bundle refactor included.
- Complete golden browser-envelope replay checks the full snapshot, three results, exact carry, HP52/Gems29, every boss event and final boulder state.
- No production import/route, renderer/traversal, Stage I/II, reward/proof/claim/payout or V1 changes. Unrelated state files/videos preserved.

[Full boss recording](qa/full-boss.mp4): **86 seconds**, emergence, missed window/retry, touch push, three hits, slams, sequential replacements, deliberate landing damage, final collapse, Gems/unlock and expedition completion. Framed to278×600 from the800×600 browser capture; the brief desktop viewport check uses a matching crop so no gameplay frames are removed. Original uncropped recording is archived outside the repository.

Changed source: `src/game/stage3/{level,model,model.test,Stage3Scene}.ts`, `src/dev/gemRunnerExpedition.tsx`, `src/game/assets/angkorV2Manifest.ts` and its test. One new PNG plus this report, screenshots, transcript/proof/QA summary and recording. Branch `feat/angkor-v2-anaconda-rework`; no main merge.

**ANACONDA_BOSS_V2: READY_FOR_HUMAN_PLAYTEST.** Human approval still needs to assess mobile push readability, phase timing, retaliation/replacement damage and collapse satisfaction with lower HP carry. Stop after this encounter rework; no production integration or other mission work.
