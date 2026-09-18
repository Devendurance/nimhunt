# NimHunt - Left Off

> Updated: 2026-09-18 (False-concurrent fix + verified recovery PASS locally: 898 tests / lint / typechecks / build green; NOT pushed/deployed, migration 012 NOT applied to hosted DB)

## Current Objective

Fix false CONCURRENT_ACTIVE_RUN BLOCK (never-played stranded Starts) and recover verified run 2655df20's claim flow after refresh without a new expedition. Do not apply hosted migration, push, deploy, or mutate production.

## Completed (this slice)

- **Migration 012** (forward-only, 008 byte-untouched): concurrent predicate + gameplay_started_at NOT NULL + terminal NULL + unexpired; memory mirror countsAsConcurrentGameplayRun(); impossible-speed/install rules unchanged.
- **session/recover**: also mints for terminal-VERIFIED unexpired runs (active fetch still 409s; abandoned/failed/expired/foreign rejected).
- **Result endpoint**: GET /api/expeditions/result?runId=, VerifyExpeditionResult-only, dual auth, fail-closed 404/409, explicit rewrite.
- **Gate**: ACTIVE_RUN_UNAVAILABLE -> terminal restore -> verified panel + claim; SESSION BLOCK retry button; TIMING/ELIGIBILITY terminal.
- **Tests**: concurrentGameplayRisk (10: migration scope, A-E, production replay PREPARED, genuine-concurrency BLOCK, speed BLOCK) + expeditionResult (6: auth, cross-wallet, masquerade, session fallback, full recovery->PREPARED, zero attempts/runs) + reducer/retry/rewrite additions.
- **Verification**: 898 passed / 69 skipped (102 files); lint 0; typecheck:server 0; tsc -b 0; build ok; diff-check clean; `git diff -- server/payouts/ api/internal/payout-cycle.ts` empty.

## Changed paths

- New: server/ledger/sql/012_concurrent_gameplay_risk.sql, server/expeditions/concurrentGameplayRisk.test.ts, server/expeditions/expeditionResult.test.ts
- Modified: server/expeditions/{http,types,memoryProofStore,postgresProofStore,proofRuntime,riskGate}.ts, server/vercel/{productAdapter,deploymentRouting,monthlyHeroesRouting,productAdapter}.test.ts (+wildcardCapture), src/{domain,api}/expeditionProof.ts, src/components/play/{ProductExpeditionGate,productGateState,productRewardClaim,useProductRewardClaim,ProductRewardClaimOutcome}.tsx/ts (+tests), vercel.json, .agent-state/*
- Untouched: 008, gameplay/replay/checkpoint/verify, reward amounts/69 slots, treasury/payout/scheduler, parsers

## Verification results

- npm test: 102 files passed / 5 skipped; 898 passed / 69 skipped.
- npm run lint: 0 errors. npm run typecheck:server: 0 errors. npx tsc -b --force: 0 errors. npm run build: ok. git diff --check: clean.
- Payout diff: `git diff -- server/payouts/ api/internal/payout-cycle.ts` empty.

## Next action

- Owner: review diff, apply migration 012 to hosted DB, deploy manually (no auto-deploy), then verify 2655df20 via /play?run=gem-runner&runId=... -> verified panel -> Retry/Claim -> PREPARED. Do not abandon stranded runs, reset attempts, reserve manually, or start expeditions from here.
