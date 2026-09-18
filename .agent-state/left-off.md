# NimHunt - Left Off

> Updated: 2026-09-18 (Wildcard-rewrite bugfix PASS locally: 879 tests / lint / typechecks / build green; NOT pushed/deployed, routing-only)

## Current Objective

Eliminate Vercel wildcard rewrite ambiguity (Active 400 + Treasure 400 with Start 200s on a4bbb2d) via explicit per-route rewrites. Preserve a4bbb2d session recovery. Do not deploy automatically.

## Completed (this slice)

- **Root cause confirmed**: reproduced against real handlers — clean Active 200 vs `path=active` leak 400 START_CHALLENGE_INVALID; Treasure/Monthly leak 400 MALFORMED_REQUEST. Capture key fires strict validators before auth; Start POSTs skip query validation (hence 200s); explicit-rewrite Monthly Heroes unaffected.
- **Explicit rewrites**: vercel.json enumerates all 23 owned routes (expeditions x10 incl. session/recover, rewards x3 + reserve, wallet x4, daily/wallet-daily/monthly-heroes, legacy complete/fail; plus /play). No `:`/`*` anywhere on /api entries. Unknown sub-paths match nothing (platform 404; adapter still JSON 404). Payout-cycle has no entry.
- **Router**: resolveRewriteDispatchPath unchanged (fail-closed); api/product.ts + productAdapter.ts comments updated (no wildcard shape).
- **Tests**: new server/vercel/wildcardCaptureRegression.test.ts (14: mechanism proof, zero-capture assertions, per-route query purity incl. claimId, recovery-through-rewritten-paths same-run resume, fail-closed + payout isolation); updated deployment/monthlyHeroes/treasureBank routing tests to explicit inventory.
- **Preserved**: a4bbb2d recovery endpoint/logic/client untouched (verified via git status + full suite).
- **Verification**: 879 passed / 69 skipped (100 files); lint 0; typecheck:server 0; tsc -b 0; build ok (chunk warning only); diff-check clean; `git diff -- server/payouts/ api/internal/payout-cycle.ts` empty.

## Changed paths

- Modified: vercel.json, api/product.ts (comment), server/vercel/productAdapter.ts (comment), server/vercel/{deploymentRouting,monthlyHeroesRouting,treasureBankRouting}.test.ts, .agent-state/*
- New: server/vercel/wildcardCaptureRegression.test.ts
- Untouched: session/gameplay/proof/reward/payout logic, SQL, payout-cycle, parsers (not weakened)

## Verification results

- npm test: 100 files passed / 5 skipped; 879 passed / 69 skipped.
- npm run lint: 0 errors. npm run typecheck:server: 0 errors. npx tsc -b --force: 0 errors. npm run build: ok. git diff --check: clean (LF/CRLF warnings only).
- Payout diff: `git diff -- server/payouts/ api/internal/payout-cycle.ts` empty.

## Next action

- Owner reviews diff, deploys manually (no auto-deploy), then runs non-mutating preflight BEFORE any Start: active?runId=test without auth -> 401 RUN_SESSION_INVALID; treasure-bank without auth -> 401; monthly-heroes -> 200. Only then attempt recovery of the existing STARTED run (no new Start).
