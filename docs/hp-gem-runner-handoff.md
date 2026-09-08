# HP, hazards, gems, and Gem Runner — implementation handoff

Implemented only the development game at /play?dev=game. No gameplay entry was added to the normal shell.

## Files

Created:
- src/game/domain/runState.ts
- src/game/domain/mission.ts
- src/game/domain/runState.test.ts
- src/game/systems/hazards.ts
- src/game/systems/collectibles.ts
- src/game/systems/tileEntry.ts
- src/game/rendering/frameArtwork.ts
- src/game/entities/Player.test.ts

Changed:
- src/game/world/room01.ts — separate fixed contents; wall layout unchanged.
- src/game/events/gameEvents.ts — typed run HUD fields and shared initializer.
- src/game/events/gameEvents.test.ts — existing tests use the initializer.
- src/game/createNimHuntGame.ts — shared initial HUD.
- src/game/scenes/BootScene.ts — sapphire loading and runtime artwork framing.
- src/game/scenes/AngkorDevScene.ts — entry effects, object rendering, reset and owned-listener cleanup.
- src/game/entities/Player.ts — proportional framed sprite, hit flash, bump locking, callback invalidation.
- src/components/play/GameDevView.tsx and GameDevView.module.css — compact HUD, outcome UI, controls and debug disclosure.
- src/components/play/PlayShell.tsx — optional initial tab, defaulting to Hunt.
- src/routes/PlayPage.tsx — consume and clear the return-to-Missions navigation state.
- src/data/assets.ts — repair a pre-existing import pointing at a renamed file.

Verification artifacts:
- output/playwright/hp-check.js — browser interaction verification for the Playwright CLI.
- output/playwright/hp-game-{320,390,430,768,1440}.png
- output/playwright/hp-complete-390.png
- output/playwright/hp-failure-390.png
- output/playwright/hp-complete-short.png
- output/playwright/hp-{before,after}-{marketing,shell,nimiq}-{390,1440}.png

## Rules and architecture

Pure run state starts at 100 HP, zero gems, IN_PROGRESS / PLAYING, and a fresh collected-ID collection. HP clamps to 0–100. The scene retains the original calculateMove function, 160ms movement, 32px tiles, 12×10 grid and spawn (3,3).

A completed successful step is the sole tile-entry event. The pure resolver applies damage, collects an uncollected gem, and then evaluates mission state with death taking precedence. Blocked moves, stationary events and terminal runs do not apply effects.

Spikes remove 25 HP; poison removes 20 HP. Hazards are static, with no recurring timers. Leaving and re-entering damages again. Six gems while HP is positive completes the mission immediately; zero HP fails it. Both outcomes stop scene input and show the supplied development-only copy, Reset run and Return to missions. No reward eligibility or claim is created.

Reset recreates all eight gems, clears collected IDs, restores HP/spawn/facing/steps/status, cancels movement and flash tweens, and invalidates pending callbacks. Explicit shutdown removes owned command listeners. Unit tests exercise callbacks after reset/destroy and overlapping bump attempts.

The typed bridge adds hp, gemsCollected, gemTarget, missionStatus and runStatus; collected IDs remain internal to gameplay. React owns the HUD and terminal panel; Phaser renders objects and applies pure outcomes.

## Room and artwork

Eight fixed gems, zero-based coordinates:
(2,3), (1,1), (5,1), (9,1), (10,4), (7,6), (5,8), (1,8).

Spikes: (5,3). Poison: (6,6).

All eight gems are reachable from spawn even with both hazards treated as blocked. The room's original walls are unchanged.

The supplied sapphire PNG is isolated to its largest connected opaque component in a temporary runtime canvas, trimmed and proportionally rendered at 19 logical pixels high. The Explorer receives runtime alpha framing and proportional rendering at 24 logical pixels high (75% of a tile). Original PNG files are untouched. Missing images have simple development fallbacks. Spikes and poison use distinct generated geometric visuals and an on-screen damage legend. Hit feedback is a short sprite alpha flash, disabled for reduced motion; it cannot alter movement locks.

HUD shows Gem Runner, the six-gem objective, HP with a bar, and gem count. Coordinates, facing and steps are collapsed below the controls. Development styles remain scoped, with safe-area padding and 44px-or-larger controls.

## Regression repair

The existing assets configuration imported Angkor world standalone.png, which was absent. Angkor world environment.png matched the previously built standalone image exactly:
SHA256 AC79109ABBD19FEFAD44D50C2793AB6C4FF3DF5D2390329ED677EFD02CE64100.

Only that import was corrected. Baseline screenshots were captured after this repair so the existing routes could render. No marketing markup, styling or copy was edited.

## Verification

- npm test: 71 passing tests, including all original 53.
- npm run lint: passed.
- npx tsc -b: passed.
- npm run build: passed.
- Build warning: the lazy Phaser/game chunk remains larger than Vite's 500kB advisory threshold (approximately 1.39MB minified / 364kB gzip). It remains isolated from the normal route's initial chunk.

Browser verification passed at 320, 390, 430, 768 and 1440px: no horizontal overflow, one canvas, visible collectibles and readable controls. Also checked a 320×480 short viewport; terminal actions remain reachable by scrolling.

Exercised collection/re-entry, spikes, poison, repeated damage to death, six-gem completion, no movement after terminal states, reset during movement, reset during feedback, rapid blocked input, D-pad input without page scrolling, outcome focus, reset focus, return to Missions, reload to Hunt, and repeated mount/unmount.

Gameplay verification produced no page exceptions. Observed fetch/XHR requests were only the two local artwork PNGs requested by Phaser's loader; no backend, wallet, reward or payout requests occurred. Game source contains no SDK, wallet or service invocation.

Normal /play and /play?dev=nimiq screenshots match their before screenshots byte-for-byte at 390 and 1440px. Marketing before/after screenshots were visually reviewed; its existing animation means captures are not byte-identical. All three routes have no horizontal overflow and no Phaser canvas. Marketing CTA still opens its unavailable-launch dialog. Normal mission Start still opens its gameplay-coming-soon sheet.

Real-phone Nimiq Pay testing: not performed; no controllable physical phone was available. The supplied phone screenshot was used as a visibility reference, not treated as a test of this implementation.

## Deferred

Goblin, boulders, keys/gates, chests, other mission logic, healing, persistence, daily expedition consumption, Supabase, NIM eligibility, claims, payouts and deployment. No such work was started.
