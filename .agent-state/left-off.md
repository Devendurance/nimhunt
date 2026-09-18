# NimHunt - Left Off

> Updated: 2026-09-18 (World entrance one-shot PASS locally: 908 tests / lint / typechecks / build green; NOT pushed/deployed, audio-only)

## Current Objective

Make world tracks one-shot entrance themes (main loops, worlds play once then silence+SFX), with no replay after natural end and fresh play on re-entry. Done.

## Completed (this slice)

- **Config**: BGM_TRACK_CONFIG (main loop, worlds one-shot); ManagedAudio.ended (+ real el.ended getter); ended-first guard in same-track playBgm; visibility/mute/unlock all funnel through it.
- **Tests**: audio suite 44 pass (10 new: config flags, no-replay x10 rerenders/gestures, mid-play resume, post-end silence for hide/show + mute, exit->main loop, re-entry fresh one-shot, SFX-after-end).
- **Verification**: 908 passed / 69 skipped (102 files); lint 0; typecheck:server 0; tsc -b 0; build ok (exit 0); diff-check clean; `git diff -- server/ api/ src/game/` empty.

## Changed paths

- Modified: src/audio/nimhuntAudio.ts, src/audio/nimhuntAudio.test.ts, .agent-state/*
- Untouched: gameplay/replay/server/reward/payout/DB/migrations, hooks, SFX

## Verification results

- npm test: 102 files passed / 5 skipped; 908 passed / 69 skipped.
- npm run lint: 0 errors. npm run typecheck:server: 0 errors. npx tsc -b --force: 0 errors. npm run build: exit 0. git diff --check: clean.
- Gameplay/server proof: `git diff -- server/ api/ src/game/` empty.

## Next action

- Owner reviews diff, pushes/deploys manually (no auto-deploy). Optional real-device listen: shell loop, Angkor once-then-silence, exit->main, re-entry replays once.
