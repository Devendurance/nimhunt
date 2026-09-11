# NimHunt - Left Off

> Updated: 2026-09-11

## Current Objective

STOP. Static Room 01 bootstrap prevalidation is in. Do not begin checkpoint/replay work.

## Completed

- First proof-request BFS skip for the three immutable Room 01 bootstrap templates only.
- Runtime recomputes the frozen-day canonical template hash and skips BFS iff it exactly matches a checked-in constant.
- Tests still run `validateExpeditionBlueprint()` and replay stored winning sequences. Hash mismatch disables the fast path. Dynamic/invalid blueprints still cannot publish.
- Preview/production still cannot construct the memory backend.

## Changed Paths

- `server/expeditions/room01BootstrapPrevalidation.ts`
- `server/expeditions/room01BootstrapPrevalidation.test.ts`
- `server/expeditions/memoryProofStore.ts`
- `server/expeditions/blueprint.test.ts`
- `server/expeditions/blueprintBootstrap.ts`

## Verification

- Targeted blueprint/bootstrap tests: PASS — 4 files, 25 passed.
- `npm test`: PASS — 41 files passed + 1 skipped, 327 passed, 1 skipped.
- `npm run lint`: PASS.
- `npx tsc -b --force`: PASS.
- `npm run build`: PASS; existing large Phaser chunk warning remains.
- `git diff --check`: PASS; existing CRLF warnings only.
- Cold `npm run dev`: ready in 2739 ms / 2758 ms (earlier sample 1324 ms).
- First proof request (chest-hunter start-challenge, initializes memory backend): 395 ms / 322 ms (was ~21 s).
- Second proof request: 49 ms / 103 ms.

## Blockers / Gates

- None for this optimization. Next product gate remains checkpoint/replay, which must not start yet.

## Next Session

1. Do not implement checkpoints or replay.
2. No further general BFS redesign unless dynamic validation itself is unusable.
